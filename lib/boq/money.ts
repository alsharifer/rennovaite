// =============================================================================
// lib/boq/money.ts — how a BoQ figure is rounded, in ONE place (H7).
//
// Every figure a QS sees must multiply out from the figures beside it. So:
//   - a resolved rate is rounded to 2 dp (fils) AT RESOLUTION, before anything
//     multiplies it — GL-14's net rate 1,366.6928 (list × 0.88) is 1,366.69;
//   - a line total is round(quantity × rate, 2), from that 2-dp rate;
//   - a sum of line totals is rounded once, to the fils, so floating-point
//     drift never reaches a stored figure;
//   - the summary chain (lib/boq/totals.ts) rounds each component once, to the
//     fils, and the grand total is exactly the sum of the rounded components.
//
// Pure and client-safe.
// =============================================================================

/**
 * Round to 2 dp, half away from zero, robust to binary representation
 * (1.005 → 1.01, 16741.9868 → 16741.99, 2.675 → 2.68).
 */
export function money2(n: number): number {
  if (!Number.isFinite(n)) return n;
  const sign = n < 0 ? -1 : 1;
  // Scale through the decimal string so 1.005 is 1.005, not 1.00499999…
  const scaled = Number(`${Math.abs(n)}e2`);
  const r = Number.isFinite(scaled) ? Math.round(scaled) : Math.round(Math.abs(n) * 100);
  return (sign * r) / 100 || 0;
}

/** A line total: the 2-dp rate times the quantity, rounded to the fils. */
export function lineTotal(quantity: number, rate_aed: number): number {
  return money2(quantity * money2(rate_aed));
}

/** A sum of money figures, rounded once to the fils. */
export function sumMoney(values: readonly number[]): number {
  // Sum in integer fils: every input is a 2-dp figure, so this is exact.
  return Math.round(values.reduce((s, v) => s + Math.round(money2(v) * 100), 0)) / 100;
}
