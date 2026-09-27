// =============================================================================
// lib/quotes/derive.ts — what a quoted figure becomes in the book (U3).
//
// The book holds NET rates EXCLUDING VAT in AED: the BoQ adds VAT once at
// assembly (lib/boq/totals.ts), and a discount the firm negotiated is theirs to
// apply. A quote can state its figures four ways; the record says which, and
// the derivation is shown on the line ("list 100.00 − 12% = 88.00; ÷ 1.05 VAT
// = 83.81"), never applied silently. Pure.
// =============================================================================

export const UAE_VAT_PCT = 5;

export interface QuoteTerms {
  currency: string;
  vat_treatment: "excl" | "incl" | "unknown";
  rates_are: "net" | "list";
  discount_pct: number;
}

export interface Derived {
  rate_aed: number | null;
  /** Why the line cannot enter the book as priced (null = it can). */
  hold_reason: string | null;
  /** The arithmetic, for the review screen and the entry note. */
  explanation: string;
}

export function deriveRate(rate_raw: number | null, terms: QuoteTerms): Derived {
  if (rate_raw === null || !Number.isFinite(rate_raw)) return { rate_aed: null, hold_reason: "rate is not a number", explanation: "no rate" };
  if (rate_raw < 0) return { rate_aed: null, hold_reason: "rate is negative", explanation: `${rate_raw}` };
  if (terms.currency.toUpperCase() !== "AED") {
    return { rate_aed: null, hold_reason: `currency ${terms.currency} — no exchange rate is applied; convert before import`, explanation: `${rate_raw} ${terms.currency}` };
  }
  if (terms.vat_treatment === "unknown") {
    return { rate_aed: null, hold_reason: "VAT treatment unknown — state whether the quote's rates include VAT", explanation: `${rate_raw} AED` };
  }
  const steps: string[] = [`${fmt(rate_raw)}`];
  let v = rate_raw;
  if (terms.rates_are === "list" && terms.discount_pct > 0) {
    v = v * (1 - terms.discount_pct / 100);
    steps.push(`− ${terms.discount_pct}% = ${fmt(v)}`);
  }
  if (terms.vat_treatment === "incl") {
    v = v / (1 + UAE_VAT_PCT / 100);
    steps.push(`÷ 1.${String(UAE_VAT_PCT).padStart(2, "0")} VAT = ${fmt(v)}`);
  }
  const rate_aed = Math.round(v * 100) / 100;
  return { rate_aed, hold_reason: null, explanation: steps.length === 1 ? `${steps[0]} net excl. VAT` : steps.join(" ") };
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}
