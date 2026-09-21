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

export type AedFormat =
  /** "AED 1,234" — the default. */
  | "aed"
  /** "1,234" — a table cell under an "(AED)" column header. */
  | "amount"
  /** "105.6" — a unit rate, shown exactly as stored (no rounding). */
  | "rate"
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

/** "AED +120k vs baseline" — the style-grid delta, on the shared formatter. */
export function formatAedKDelta(delta: number): string {
  if (delta === 0) return "AED ±0";
  const k = Math.round(Math.abs(delta) / 1000);
  return `AED ${delta > 0 ? "+" : MINUS}${k}k`;
}
