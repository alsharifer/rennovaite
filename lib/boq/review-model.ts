// =============================================================================
// lib/boq/review-model.ts — the stored BoQ → the BoQ & Review screen's data
// (K3, R7 §3.2). SERVER-ONLY (tierOf reaches the I4 provenance module, which
// curates identity); pure given its inputs, so the J3 figures are unit-tested
// on the Arabella fixture.
//
// Nothing here prices or rounds: every figure is the STORED one (the BoQ the
// engine wrote — H7 rounding already applied at generation). The marks are
// tierOf()'s; the weakest-link roll-ups (R1) are tier-vocab's `weakest`; the
// chains are the provenance builder's, built from the same curated document.
// =============================================================================

import { boqDerivedInfo, derivedLineNote, isUnpricedLine } from "@/lib/documents/boq-derived";
import type { ProposalGateVerdict, ReferenceBasis, ReferenceBasisAcceptance } from "@/lib/documents/reference-basis-types";
import { REFERENCE_BASIS_BANNER } from "@/lib/documents/reference-basis-types";
import { headlineSpokenText } from "@/lib/format/aed";
import { lineItemKey, type ProvLine } from "@/lib/provenance/boq";
import { tierOf, weakest, type Persona, type ProvTier, type TierContext } from "@/lib/provenance/tier";
import type { BoqProvenance } from "@/lib/provenance/types";

import { sumMoney } from "./money";
import { assignRefs, sectionCode } from "./refs";
import type { ExcludedLine, ReviewLine, ReviewModel, ReviewSection } from "./review-types";
import { sortSections } from "./section-order";

export interface ReviewBoq {
  sections: { work_section: string; lines: (ProvLine & { item_key?: string })[]; section_total_aed: number }[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
  ohp_pct?: number;
  ohp_aed?: number;
  garden?: {
    draft: { draft: boolean; derived?: string[]; note: string | null; statement: string | null };
    derived_lines?: number;
    kept?: unknown[];
    removals?: unknown[];
    undecided?: unknown[];
  } | null;
  programme?: ReviewModel["programme"];
}

export interface ReviewInputs {
  projectId: string;
  boqId: string;
  rev: number;
  revDate: string;
  persona: Persona;
  boq: ReviewBoq;
  provenance: BoqProvenance | null;
  tierCtx: TierContext;
  /** The project's firm — present when the project is firm-attached. */
  firm: { id: string; brand: string; bookItemKeys: ReadonlySet<string>; vocabulary: (itemKey: string) => { unit: string | null } | null } | null;
  /** The project is firm-attached (whoever is looking) — the notice's status follows the PROJECT. */
  projectHasFirm?: boolean;
  /** L4: the reference-basis gate's facts for this revision (best-effort; null = unknown). */
  basis: { basis: ReferenceBasis; verdict: ProposalGateVerdict; acceptance: ReferenceBasisAcceptance | null; bookReviewed: boolean } | null;
  /** findComponentDuplicates() findings, already worded. */
  duplicates: { label: string; detail: string }[];
  /** The client's own budget — owner projects only (H7: never a platform default, never on a firm project). */
  budget: number | null;
}

// "(no reference rate — QS to price)" / "(absorbed at no charge … — QS to confirm)":
// the provenance aside a stored description carries. The title drops it; the
// excluded-lines list and the inspector say it.
const ASIDE = /\s*\(([^()]*\bQS to (?:price|confirm)\b[^()]*)\)\s*$/;

export function splitAside(description: string): { title: string; aside: string | null } {
  const m = ASIDE.exec(description);
  if (!m) return { title: description, aside: null };
  const aside = m[1]!.replace(/\s+—\s+QS to price$/, "").replace(/\s+—\s+/g, "; ");
  return { title: description.slice(0, m.index).trim(), aside };
}

/** The draft statement → its notice key and sentence ("DRAFT FOR REVIEW" / "Quantities derived …"). */
function draftNotice(statement: string): { key: string; sentence: string } {
  const i = statement.indexOf(" — ");
  if (i < 0) return { key: "Draft for review", sentence: statement };
  const rest = statement.slice(i + 3).trim();
  return { key: statement.slice(0, i), sentence: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

export function buildReviewModel(i: ReviewInputs): ReviewModel {
  const sorted = sortSections(i.boq.sections);
  const refs = assignRefs(sorted);
  const excluded: ExcludedLine[] = [];
  const allAmountTiers: ProvTier[] = [];
  const counted: { tier: ProvTier; amount: number }[] = [];

  const sections: ReviewSection[] = sorted.map((s) => {
    const lines: ReviewLine[] = s.lines.map((l, idx) => {
      const key = `${s.work_section}-${idx}`;
      const ref = refs[key]!;
      const tiers = tierOf(l, s.work_section, i.tierCtx);
      const unpriced = isUnpricedLine(l);
      const { title, aside } = splitAside(l.description);
      const itemKey = lineItemKey(l);
      allAmountTiers.push(tiers.amount);
      if (unpriced) excluded.push({ ref, description: title, quantity: l.quantity, unit: l.unit, reason: aside ?? "no rate in any book" });
      else counted.push({ tier: tiers.amount, amount: l.total_aed });
      let book: ReviewLine["book"] = null;
      if (i.firm && i.persona === "firm") {
        const vocab = itemKey ? i.firm.vocabulary(itemKey) : null;
        book = { hasEntry: !!itemKey && i.firm.bookItemKeys.has(itemKey), canAdd: !!vocab, unit: vocab?.unit ?? null };
      }
      return {
        key,
        ref,
        section: s.work_section,
        description: title,
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate_aed,
        amount: l.total_aed,
        tiers,
        unpriced,
        derivedNote: derivedLineNote(l),
        itemKey,
        elementRefs: l.element_refs ?? [],
        unpricedReason: unpriced ? (aside ?? "no rate in any book") : null,
        prov: i.provenance?.lines[key] ?? null,
        book,
      };
    });
    return {
      name: s.work_section,
      code: refs[`${s.work_section}-0`]?.replace(/-\d+$/, "") ?? sectionCode(s.work_section),
      lines,
      subtotal: s.section_total_aed,
      tier: weakest(lines.map((l) => l.tiers.amount)),
      tbp: lines.filter((l) => l.unpriced).length,
      prov: i.provenance?.sections[s.work_section] ?? null,
    };
  });

  // Basis of the subtotal: counted lines by their AMOUNT mark (R1), strongest first.
  const ORDER: ProvTier[] = ["measured", "validated", "market", "derived"];
  const basis = ORDER.map((tier) => {
    const rows = counted.filter((c) => c.tier === tier);
    return { tier, lines: rows.length, amount: sumMoney(rows.map((r) => r.amount)) };
  }).filter((b) => b.lines > 0);
  if (excluded.length > 0) basis.push({ tier: "unpriced", lines: excluded.length, amount: 0 });

  const headTier = weakest(allAmountTiers);
  const info = boqDerivedInfo(i.boq as Parameters<typeof boqDerivedInfo>[0]);
  const estimate = headTier === "derived" || info.draft;
  const b = i.boq;
  const ohpPct = b.ohp_pct && b.ohp_pct > 0 ? b.ohp_pct : 0;
  const ohpAed = b.ohp_aed ?? 0;
  const contingencyBase = b.subtotal_aed + ohpAed;
  const vatBase = contingencyBase + b.contingency_aed;

  const garden = b.garden ?? null;
  const draft = garden?.draft?.draft ? draftNotice(garden.draft.statement ?? info.statement ?? "") : null;
  const ref = i.basis;
  const reference =
    ref && ref.basis.reference_lines > 0
      ? {
          key: REFERENCE_BASIS_BANNER.split(" — ")[0]!,
          referenceLines: ref.basis.reference_lines,
          totalLines: ref.basis.total_lines,
          firmLines: ref.basis.firm_lines,
          status: !(i.projectHasFirm ?? !!i.firm) ? ("no_firm" as const) : ref.bookReviewed ? ("book_reviewed" as const) : ref.acceptance ? ("accepted" as const) : ("open" as const),
          acceptedOn: ref.acceptance?.created_at.slice(0, 10) ?? null,
          acceptedNote: ref.acceptance?.note ?? null,
        }
      : null;

  return {
    projectId: i.projectId,
    boqId: i.boqId,
    rev: i.rev,
    revDate: i.revDate,
    persona: i.persona,
    firm: i.firm ? { id: i.firm.id, brand: i.firm.brand } : null,
    sections,
    headline: {
      total: b.grand_total_aed,
      estimate,
      tier: headTier,
      excluded,
      spoken: headlineSpokenText(b.grand_total_aed, { estimate, excludedLines: excluded.length }),
    },
    basis,
    counted: counted.length,
    totalLines: counted.length + excluded.length,
    chain: {
      subtotal: b.subtotal_aed,
      subtotalTier: weakest(counted.map((c) => c.tier)),
      ohp: ohpPct > 0 ? { pct: ohpPct, base: b.subtotal_aed, amount: ohpAed, prov: i.provenance?.summary.ohp ?? null } : null,
      ohpNote: ohpPct > 0 ? null : i.firm ? "0% in your book" : "no firm book on this project",
      contingency: { pct: b.contingency_pct, base: contingencyBase, amount: b.contingency_aed, prov: i.provenance?.summary.contingency ?? null },
      vat: { pct: b.vat_pct, base: vatBase, amount: b.vat_aed, prov: i.provenance?.summary.vat ?? null },
      grand: b.grand_total_aed,
      subtotalProv: i.provenance?.summary.subtotal ?? null,
      grandProv: i.provenance?.summary.grand ?? null,
    },
    notices: {
      draft: draft ? { ...draft, derivedLines: info.derivedLines, note: garden?.draft?.note ?? null } : null,
      reference,
      duplicates: i.duplicates,
      garden: garden && ((garden.kept?.length ?? 0) > 0 || (garden.removals?.length ?? 0) > 0 || (garden.undecided?.length ?? 0) > 0)
        ? { kept: garden.kept?.length ?? 0, removed: garden.removals?.length ?? 0, undecided: garden.undecided?.length ?? 0 }
        : null,
    },
    budget: i.persona === "owner" ? i.budget : null,
    programme: b.programme ?? null,
  };
}
