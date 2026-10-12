// =============================================================================
// lib/format/aed.ts — THE AED formatter (I4).
//
// Before I4 there were 14 local formatters across the app and the PDF, agreeing
// on "AED " + rounded en-US digits and disagreeing on everything else (null
// handling, sign glyphs, k/M shortening, whether a table cell shows decimals).
// Every AED figure now goes through one of these, and every on-screen figure
// through <Figure> (components/figures/Figure.tsx), which also carries its
// provenance popover.
//
// Pure and client-safe.
// =============================================================================

import { money2 } from "@/lib/boq/money";

export type AedFormat =
  /** "AED 1,234" — the default. */
  | "aed"
  /** "1,234" — a table cell under an "(AED)" column header. */
  | "amount"
  /** "105.6" — a unit rate, shown exactly as stored (no rounding). */
  | "rate"
  /**
   * "16,741.95" — a BoQ money figure to the fils (H7): line rates and totals
   * and the summary chain, so every figure multiplies out from those beside it.
   */
  | "money"
  /** "+0.04" / "−16,741.99" / "—" for zero — a change to the fils (H7 rounding moves). */
  | "money-delta"
  /** "+AED 1,234" / "−AED 1,234" — a change. */
  | "signed"
  /** "+1,234" / "−1,234" / "—" for zero — a compact change in a dense list. */
  | "delta"
  /** "AED 1.23M" / "AED 12k" / "AED 950" — a stat card. */
  | "short";

const EMPTY = "—";
const MINUS = "−";

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const digits = (n: number) => Math.round(n).toLocaleString("en-US");
const fils2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format an AED figure. Null / NaN / Infinity → "—" in every format. */
export function formatAed(n: number | null | undefined, format: AedFormat = "aed"): string {
  if (!isNum(n)) return EMPTY;
  switch (format) {
    case "aed":
      return `AED ${digits(n)}`;
    case "amount":
      return digits(n);
    case "rate":
      return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
    case "money":
      return fils2(n);
    case "money-delta": {
      if (Math.round(n * 100) === 0) return EMPTY;
      const abs = fils2(Math.abs(n));
      return n > 0 ? `+${abs}` : `${MINUS}${abs}`;
    }
    case "signed": {
      const abs = digits(Math.abs(n));
      return n >= 0 ? `+AED ${abs}` : `${MINUS}AED ${abs}`;
    }
    case "delta": {
      if (Math.round(n) === 0) return EMPTY;
      const abs = digits(Math.abs(n));
      return n > 0 ? `+${abs}` : `${MINUS}${abs}`;
    }
    case "short": {
      const a = Math.abs(n);
      const sign = n < 0 ? MINUS : "";
      if (a >= 1_000_000) return `AED ${sign}${(a / 1_000_000).toFixed(2)}M`;
      if (a >= 1_000) return `AED ${sign}${Math.round(a / 1_000)}k`;
      return `AED ${sign}${Math.round(a)}`;
    }
  }
}

// --- R7 Blueprint number contract (spec §1.3, K1) -----------------------------
// One helper per kind of figure, used by every Blueprint surface. Money is
// rounded with H7's money2 (half away from zero, robust to binary
// representation) BEFORE it is printed, so a displayed rate × displayed
// quantity is the displayed amount to the fils.

const grouped = (n: number, dp: number) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** "7,329.70" — exactly 2 dp, en-US grouping. With `prefix`: "AED 7,329.70". Null → "—". */
export function formatAED(n: number | null | undefined, opts: { prefix?: boolean } = {}): string {
  if (!isNum(n)) return EMPTY;
  const s = `${n < 0 && money2(n) !== 0 ? MINUS : ""}${grouped(Math.abs(money2(n)), 2)}`;
  return opts.prefix ? `AED ${s}` : s;
}

/** A quantity: "1" when integral, else exactly 2 dp ("69.41", "12.50"). Null → "—". */
export function formatQty(n: number | null | undefined): string {
  if (!isNum(n)) return EMPTY;
  const r = money2(n);
  const s = Number.isInteger(r) ? grouped(Math.abs(r), 0) : grouped(Math.abs(r), 2);
  return `${r < 0 ? MINUS : ""}${s}`;
}

/**
 * A change. Money (default): "+1,234.56" / "−0.04" (the true minus, U+2212) /
 * "—" when it rounds to zero. Percent: "+4.2%" / "−0.3%" (1 dp) / "—".
 */
export function formatDelta(n: number | null | undefined, unit: "aed" | "pct" = "aed"): string {
  if (!isNum(n)) return EMPTY;
  const r = unit === "pct" ? Math.round(Math.abs(n) * 10) / 10 : Math.abs(money2(n));
  if (r === 0) return EMPTY;
  const body = unit === "pct" ? `${grouped(r, 1)}%` : grouped(r, 2);
  return `${n > 0 ? "+" : MINUS}${body}`;
}

/** A ratio: "×17.9" (1 dp). Null / non-positive → "—". */
export function formatRatio(n: number | null | undefined): string {
  if (!isNum(n) || n <= 0) return EMPTY;
  return `×${grouped(Math.round(n * 10) / 10, 1)}`;
}

/**
 * The headline estimate, for screen readers (spec §1.3 / §4.2 #12): never
 * "AED … star". `≈ AED 116,679.56*` reads "approximately AED 116,679.56,
 * excludes 3 lines to be priced".
 */
export function headlineSpokenText(total: number, opts: { estimate?: boolean; excludedLines?: number } = {}): string {
  const k = opts.excludedLines ?? 0;
  const lead = opts.estimate === false ? "" : "approximately ";
  return `${lead}AED ${formatAED(total)}${k > 0 ? `, excludes ${k} line${k === 1 ? "" : "s"} to be priced` : ""}`;
}

/** "AED +120k vs baseline" — the style-grid delta, on the shared formatter. */
export function formatAedKDelta(delta: number): string {
  if (delta === 0) return "AED ±0";
  const k = Math.round(Math.abs(delta) / 1000);
  return `AED ${delta > 0 ? "+" : MINUS}${k}k`;
}
