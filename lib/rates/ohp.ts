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
//
// I4: the arithmetic is the shared chain (lib/boq/totals.ts), so a figure the
// browser recomputes is the figure this writes.
// =============================================================================

import { chainTotals } from "@/lib/boq/totals";

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

export function applyOhp<T extends BoqTotalsLike>(boq: T, pct: number): T {
  if (!(pct > 0)) return boq;
  const c = chainTotals({ subtotal_aed: boq.subtotal_aed, contingency_pct: boq.contingency_pct, vat_pct: boq.vat_pct, ohp_pct: pct });
  boq.ohp_pct = c.ohp_pct;
  boq.ohp_aed = c.ohp_aed;
  boq.contingency_aed = c.contingency_aed;
  boq.vat_aed = c.vat_aed;
  boq.grand_total_aed = c.grand_total_aed;
  return boq;
}
