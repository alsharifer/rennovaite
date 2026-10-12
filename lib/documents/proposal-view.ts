// =============================================================================
// lib/documents/proposal-view.ts — 08 Proposal, as the screen reads it (K4,
// R7 §3.7, Figma 23:689). Server-only.
//
// The same gate the export runs (loadProposalGate), the setup (053), the
// firm's branding, and — from the gate's BoQ revision, curated — the price
// summary the client would receive (section totals in canonical order, the
// stored chain, the D4 exclusions) and the seven sections of the document.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { sortSections } from "@/lib/boq/section-order";
import type { BoqPdfInput } from "@/lib/documents/boq-pdf";
import { boqDerivedInfo, derivedTotal, isUnpricedLine } from "@/lib/documents/boq-derived";
import { loadProposalGate, type ProposalGate } from "@/lib/documents/proposal-gate";
import { loadProposalSetup, type ProposalSetup } from "@/lib/documents/proposal-setup";
import { loadBookAttention } from "@/lib/firms/book-view";
import { curateBoq, loadWithheldNames } from "@/lib/identity/curation";

export interface ProposalPriceRow {
  section: string;
  /** null = every line in it is to be priced. */
  total: number | null;
}

export interface ProposalView {
  projectId: string;
  gate: { ok: boolean; refusal: string | null; reason: string | null; noFirm: boolean; noBoq: boolean };
  firm: { id: string; name: string; displayName: string | null; brand: string; logo: boolean; termsSet: boolean; ohpPct: number | null } | null;
  setup: ProposalSetup | null;
  rev: number | null;
  revDate: string | null;
  bookOpen: { conflicts: number; outliers: number } | null;
  basis: { referenceLines: number; firmLines: number; totalLines: number } | null;
  receives: { n: string; title: string; detail: string }[];
  price: {
    rows: ProposalPriceRow[];
    subtotal: number;
    ohp: { pct: number; amount: number } | null;
    contingency: { pct: number; amount: number };
    vat: { pct: number; amount: number };
    totalText: string;
    excludes: string | null;
    /** "Prices are rev 4; regenerate after reviewing your book to apply your rates and OH&P 8%." */
    note: string | null;
  } | null;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });

export async function loadProposalView(db: SupabaseClient, projectId: string): Promise<ProposalView> {
  const gate: ProposalGate = await loadProposalGate(db, projectId);
  const firmId = gate.firm?.firm_id ?? null;
  const [setup, boqRow, revCount, book, attention, withheld] = await Promise.all([
    loadProposalSetup(db, projectId),
    gate.boq ? db.from("boqs").select("created_at, sections").eq("id", gate.boq.id).maybeSingle<{ created_at: string; sections: BoqPdfInput["boq"] }>() : Promise.resolve({ data: null }),
    db.from("boqs").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    firmId ? db.from("firm_rate_books").select("ohp_pct").eq("firm_id", firmId).maybeSingle<{ ohp_pct: number | null }>() : Promise.resolve({ data: null }),
    firmId ? loadBookAttention(db, firmId).catch(() => null) : Promise.resolve(null),
    loadWithheldNames(db, projectId),
  ]);
  const ohpPct = book.data?.ohp_pct != null ? Number(book.data.ohp_pct) : null;
  const rev = gate.boq ? revCount.count || null : null;

  let price: ProposalView["price"] = null;
  const receives: ProposalView["receives"] = [];
  if (boqRow.data) {
    const boq = curateBoq(boqRow.data.sections, withheld);
    const info = boqDerivedInfo(boq);
    const total = derivedTotal(boq.grand_total_aed, info);
    const sections = sortSections(boq.sections);
    const reference = gate.boq?.basis.reference_lines ?? 0;
    const ohpMissing = !!ohpPct && ohpPct > 0 && !(boq.ohp_aed && boq.ohp_aed > 0);
    price = {
      rows: sections.map((s) => ({ section: s.work_section, total: s.lines.length > 0 && s.lines.every(isUnpricedLine) ? null : s.section_total_aed })),
      subtotal: boq.subtotal_aed,
      ohp: boq.ohp_aed && boq.ohp_aed > 0 ? { pct: Number(boq.ohp_pct ?? 0), amount: boq.ohp_aed } : null,
      contingency: { pct: boq.contingency_pct, amount: boq.contingency_aed },
      vat: { pct: boq.vat_pct, amount: boq.vat_aed },
      totalText: total.text,
      excludes: total.excludes,
      note:
        reference > 0 || ohpMissing
          ? `Prices are rev ${rev ?? "—"}. ${reference > 0 ? `${reference} line${reference === 1 ? "" : "s"} price from the market reference — add ${reference === 1 ? "it" : "them"} to your book and regenerate to apply your rates` : "Regenerate to apply"}${ohpMissing ? `${reference > 0 ? " and" : ""} your OH&P ${ohpPct}%` : ""}.`
          : null,
    };
    const prog = boq.programme;
    const assumptions = [info.draft ? "draft quantities" : null, info.derivedLines > 0 ? `${info.derivedLines} derived quantit${info.derivedLines === 1 ? "y" : "ies"}, firm after site verification` : null].filter(Boolean) as string[];
    const showRates = setup?.showLineRates ?? false;
    receives.push(
      { n: "01", title: "Cover", detail: `display name, client, date${setup?.validityDays ? ", validity" : ""}` },
      { n: "02", title: "Scope summary", detail: `${sections.length} work sections, drawn ${day(boqRow.data.created_at)}` },
      { n: "03", title: "Price summary", detail: showRates ? "every line with its rate · section totals · contingency · VAT" : "section totals · contingency · VAT — no line rates" },
      { n: "04", title: "Exclusions & to be priced", detail: info.unpriced.length ? `${info.unpriced.length} line${info.unpriced.length === 1 ? "" : "s"} named` : "none — every line is priced" },
      { n: "05", title: "Indicative programme", detail: prog ? `${prog.total_days} days · derived, not a commitment` : "not on this BoQ" },
      { n: "06", title: "Assumptions", detail: assumptions.length ? assumptions.join(", ") : "none stated" },
      { n: "07", title: "Terms", detail: [setup?.validityDays ? "validity" : null, setup?.paymentTerms ? "payment terms" : null, gate.firm?.terms_text ? "your terms" : null].filter(Boolean).join(" · ") || "none set yet" },
    );
  }

  return {
    projectId,
    gate: { ok: gate.verdict.ok, refusal: gate.verdict.refusal, reason: gate.verdict.reason, noFirm: !gate.firm, noBoq: !gate.boq },
    firm: gate.firm ? { id: gate.firm.firm_id, name: gate.firm.name, displayName: gate.firm.display_name, brand: gate.firm.brand, logo: !!gate.firm.logo_path, termsSet: !!gate.firm.terms_text, ohpPct } : null,
    setup,
    rev,
    revDate: boqRow.data ? day(boqRow.data.created_at) : null,
    bookOpen: attention,
    basis: gate.boq ? { referenceLines: gate.boq.basis.reference_lines, firmLines: gate.boq.basis.firm_lines, totalLines: gate.boq.basis.total_lines } : null,
    receives,
    price,
  };
}
