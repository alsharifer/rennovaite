// =============================================================================
// lib/boq/totals.ts — the BoQ summary chain, in ONE place (I4).
//
//   subtotal → + OH&P (subtotal × ohp%) → + contingency ((subtotal + OH&P) × c%)
//            → + VAT ((subtotal + OH&P + contingency) × vat%) → grand total
//
// The server writes these figures into the stored BoQ; the browser recomputes
// them whenever a scenario moves the subtotal (what-if grades, vendor swaps).
// Both go through `chainTotals`, so a recomputed figure is exactly the figure a
// regenerated BoQ would store — it cannot drift. `chainTotals` reproduces every
// stored BoQ (asserted in lib/boq/__tests__/totals.test.ts and live by
// scripts/provenance-check.mjs).
//
// H7: every component is rounded ONCE, to the fils. It used to be whole
// dirhams — Arabella stored contingency 8,231 and VAT 5,556 against exact
// 8,231.36 and 5,556.17 — and the grand total is exactly the sum of the
// rounded components: grand = subtotal + OH&P + contingency + VAT, to the fils.
// OH&P sits between the subtotal and contingency, so contingency and VAT are
// both charged on it.
//
// Pure and client-safe.
// =============================================================================

import { money2, sumMoney } from "./money";
import { sortSections } from "./section-order";

export interface ChainInput {
  subtotal_aed: number;
  contingency_pct: number;
  vat_pct: number;
  ohp_pct?: number;
}

export interface ChainTotals {
  subtotal_aed: number;
  ohp_pct: number;
  ohp_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
}

export function chainTotals(i: ChainInput): ChainTotals {
  const ohp_pct = i.ohp_pct && i.ohp_pct > 0 ? i.ohp_pct : 0;
  const subtotal_aed = money2(i.subtotal_aed);
  const ohp_aed = ohp_pct > 0 ? money2((subtotal_aed * ohp_pct) / 100) : 0;
  const contingency_aed = money2(((subtotal_aed + ohp_aed) * i.contingency_pct) / 100);
  const vat_aed = money2(((subtotal_aed + ohp_aed + contingency_aed) * i.vat_pct) / 100);
  return {
    subtotal_aed,
    ohp_pct,
    ohp_aed,
    contingency_pct: i.contingency_pct,
    contingency_aed,
    vat_pct: i.vat_pct,
    vat_aed,
    grand_total_aed: sumMoney([subtotal_aed, ohp_aed, contingency_aed, vat_aed]),
  };
}

/** The chain of a stored BoQ document, recomputed with a moved subtotal. */
export function chainWithSubtotal(
  boq: { contingency_pct: number; vat_pct: number; ohp_pct?: number },
  subtotal_aed: number,
): ChainTotals {
  return chainTotals({ subtotal_aed, contingency_pct: boq.contingency_pct, vat_pct: boq.vat_pct, ohp_pct: boq.ohp_pct });
}

/** The figures `rechain` reads and writes on a BoQ document. */
export interface ChainedDoc {
  sections: { work_section: string; lines: { total_aed?: number | null }[]; section_total_aed: number }[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
  ohp_pct?: number;
  ohp_aed?: number;
}

/**
 * H7 — the one way a BoQ's figures are put back together after any producer
 * adds or replaces sections: sections in the canonical order (stable, lines
 * untouched), each section total = Σ its line totals to the fils, subtotal =
 * Σ section totals, then the chain. A document carrying OH&P keeps it (so the
 * call order of the producers cannot drop it); one without gains no OH&P field.
 * Returns a new document; the input is not mutated.
 */
export function rechain<T extends ChainedDoc>(boq: T): T {
  const sections = sortSections(boq.sections).map((s) => ({
    ...s,
    section_total_aed: sumMoney(s.lines.map((l) => (typeof l.total_aed === "number" ? l.total_aed : 0))),
  }));
  const c = chainTotals({
    subtotal_aed: sumMoney(sections.map((s) => s.section_total_aed)),
    contingency_pct: boq.contingency_pct,
    vat_pct: boq.vat_pct,
    ohp_pct: boq.ohp_pct,
  });
  const out = {
    ...boq,
    sections,
    subtotal_aed: c.subtotal_aed,
    contingency_aed: c.contingency_aed,
    vat_aed: c.vat_aed,
    grand_total_aed: c.grand_total_aed,
  } as T;
  if (c.ohp_pct > 0) {
    out.ohp_pct = c.ohp_pct;
    out.ohp_aed = c.ohp_aed;
  }
  return out;
}
