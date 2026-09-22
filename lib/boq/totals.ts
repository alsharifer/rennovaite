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
// Pure and client-safe.
// =============================================================================

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

const round2 = (n: number) => Math.round(n * 100) / 100;

export function chainTotals(i: ChainInput): ChainTotals {
  const ohp_pct = i.ohp_pct && i.ohp_pct > 0 ? i.ohp_pct : 0;
  const ohp_aed = ohp_pct > 0 ? Math.round((i.subtotal_aed * ohp_pct) / 100) : 0;
  const contingency_aed = Math.round(((i.subtotal_aed + ohp_aed) * i.contingency_pct) / 100);
  const vat_aed = Math.round(((i.subtotal_aed + ohp_aed + contingency_aed) * i.vat_pct) / 100);
  return {
    subtotal_aed: i.subtotal_aed,
    ohp_pct,
    ohp_aed,
    contingency_pct: i.contingency_pct,
    contingency_aed,
    vat_pct: i.vat_pct,
    vat_aed,
    grand_total_aed: round2(i.subtotal_aed + ohp_aed + contingency_aed + vat_aed),
  };
}

/** The chain of a stored BoQ document, recomputed with a moved subtotal. */
export function chainWithSubtotal(
  boq: { contingency_pct: number; vat_pct: number; ohp_pct?: number },
  subtotal_aed: number,
): ChainTotals {
  return chainTotals({ subtotal_aed, contingency_pct: boq.contingency_pct, vat_pct: boq.vat_pct, ohp_pct: boq.ohp_pct });
}
