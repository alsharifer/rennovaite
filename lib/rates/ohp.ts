// =============================================================================
// lib/rates/ohp.ts — a firm's overheads & profit, as its own line (L1).
//
// OH&P is applied at BoQ ASSEMBLY, after every section is priced, as a visible
// summary line (`ohp_pct` / `ohp_aed` beside contingency and VAT) — never baked
// into a unit rate. A rate in a BoQ therefore always means the same thing
// whichever firm prices it, and a client can see exactly what the markup is.
//
// Order of the summary chain:
//   subtotal (Σ sections) → + OH&P (subtotal × pct) → + contingency (on
//   subtotal + OH&P) → + VAT (on all of it) → grand total.
// A book with ohp_pct = 0 (or no firm) leaves the document untouched — no field
// is even added — so every pre-L1 BoQ regenerates byte for byte.
// =============================================================================

export interface BoqTotalsLike {
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
  ohp_pct?: number;
  ohp_aed?: number;
}

export const OHP_LINE_LABEL = "Overheads & profit";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function applyOhp<T extends BoqTotalsLike>(boq: T, pct: number): T {
  if (!(pct > 0)) return boq;
  const ohp_aed = Math.round((boq.subtotal_aed * pct) / 100);
  boq.ohp_pct = pct;
  boq.ohp_aed = ohp_aed;
  boq.contingency_aed = Math.round(((boq.subtotal_aed + ohp_aed) * boq.contingency_pct) / 100);
  boq.vat_aed = Math.round(((boq.subtotal_aed + ohp_aed + boq.contingency_aed) * boq.vat_pct) / 100);
  boq.grand_total_aed = round2(boq.subtotal_aed + ohp_aed + boq.contingency_aed + boq.vat_aed);
  return boq;
}
