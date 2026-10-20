// =============================================================================
// lib/hub/estimate.ts — one stored BoQ's headline, the way every summary
// surface reads it (K5a hub, K8 Projects home, K8 owner Overview).
// SERVER-ONLY: tierOf() reaches the provenance module.
//
// Every figure is a stored one. Each line's amount mark comes from tierOf();
// the counted lines (everything but the D4 to-be-priced ones) sum to the
// counted subtotal, grouped by mark for "Basis of this number"; the headline's
// mark is the weakest counted input (R1); "≈" when that mark is derived or the
// plan is a draft.
// =============================================================================

import { sumMoney } from "@/lib/boq/money";
import { programmeOf } from "@/lib/timeline/programme";
import { assignRefs } from "@/lib/boq/refs";
import type { RevisionBoq } from "@/lib/boq/revision-diff";
import { sortSections } from "@/lib/boq/section-order";
import { boqDerivedInfo, isUnpricedLine } from "@/lib/documents/boq-derived";
import { curateBoq } from "@/lib/identity/curation";
import type { ProvLine } from "@/lib/provenance/boq";
import { tierOf, weakest, type ProvTier, type TierContext } from "@/lib/provenance/tier";

export interface BasisRow {
  tier: ProvTier;
  lines: number;
  amount: number | null;
  share: number | null;
}

export interface StoredEstimate {
  /** The counted subtotal (Σ counted line amounts). */
  counted: number;
  countedLines: number;
  /** "≈": the weakest counted mark is derived, or the plan is a draft. */
  estimate: boolean;
  /** The weakest counted mark (R1) — null for a BoQ with no counted line. */
  tier: ProvTier | null;
  /** D4: the lines still to be priced, named. */
  excluded: { ref: string; description: string }[];
  grand: number;
  contingencyPct: number;
  vatPct: number;
  chain: { subtotal: number; ohp: number; contingency: number; vat: number };
  basis: BasisRow[];
  /** The indicative programme's total days, when the BoQ carries one. */
  programmeDays: number | null;
}

const ORDER: ProvTier[] = ["measured", "validated", "market", "derived"];

export function estimateOf(sections: RevisionBoq, ctx: { withheldNames: string[]; qsValidated: TierContext["qsValidated"] }): StoredEstimate {
  const boq = curateBoq(sections, ctx.withheldNames) as RevisionBoq & { programme?: { total_days: number } | null };
  const counted: { tier: ProvTier; amount: number }[] = [];
  const excluded: { ref: string; description: string }[] = [];
  const tiers: ProvTier[] = [];
  const sorted = sortSections(boq.sections);
  const refs = assignRefs(sorted);
  for (const s of sorted) {
    s.lines.forEach((l, idx) => {
      const t = tierOf(l as ProvLine, s.work_section, { qsValidated: ctx.qsValidated });
      tiers.push(t.amount);
      if (isUnpricedLine(l)) excluded.push({ ref: refs[`${s.work_section}-${idx}`] ?? s.work_section, description: l.description.replace(/\s*\([^)]*\)\s*$/, "") });
      else counted.push({ tier: t.amount, amount: l.total_aed });
    });
  }
  const countedTotal = sumMoney(counted.map((c) => c.amount));
  const basis: BasisRow[] = ORDER.map((tier) => {
    const rows = counted.filter((c) => c.tier === tier);
    const amount = sumMoney(rows.map((r) => r.amount));
    return { tier, lines: rows.length, amount, share: countedTotal ? Math.round((amount / countedTotal) * 1000) / 10 : null };
  }).filter((b) => b.lines > 0);
  if (excluded.length) basis.push({ tier: "unpriced", lines: excluded.length, amount: null, share: null });
  const info = boqDerivedInfo(boq as Parameters<typeof boqDerivedInfo>[0]);
  const head = tiers.length ? weakest(tiers) : null;
  return {
    counted: countedTotal,
    countedLines: counted.length,
    estimate: head === "derived" || info.draft,
    tier: head,
    excluded,
    grand: boq.grand_total_aed,
    contingencyPct: boq.contingency_pct,
    vatPct: boq.vat_pct,
    chain: { subtotal: boq.subtotal_aed, ohp: boq.ohp_aed ?? 0, contingency: boq.contingency_aed, vat: boq.vat_aed },
    basis,
    // C4: THE programme's number (programmeOf), never a stored figure.
    programmeDays: programmeOf(boq as never)?.total_days ?? null,
  };
}
