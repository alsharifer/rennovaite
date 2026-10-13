// =============================================================================
// lib/provenance/tier.ts — tierOf(): one BoQ line → its three provenance marks
// (R7 §1.4, K1; proposed in K0.3, ruled 12 Oct).
//
// It CONSUMES the I4 provenance source — never re-derives from raw fields in
// the UI:
//   rate  ← lineTierKey() (stored rate_tier, or I4's inference for a BoQ stored
//           before L1), the rate_status flags, and rate_book.qs_validated;
//   qty   ← the line's own qty_derived (the take-off already folds derived
//           geometry into it — element `derived` flags stay popover text);
//   amount ← the weaker of the two (R1).
//
// Mapping (spec §1.4 + the 12 Oct ruling):
//   firm_private, firm_correction           → measured ("Own basis")
//   own_price (K11: priced on review, 057)   → measured ("Own basis")
//   reference / module_reference            → validated iff rate_book.qs_validated, else market
//   selection                               → market when priced, else derived — NEVER validated
//   catalog, allowance, labour_book, p4_constant, overlay_default,
//   indicative, furniture, untraceable      → derived
//   rate_status site_assessment / indicative / needs_selection → at most derived
//   a QS-to-price line at rate 0 (isUnpricedLine)               → unpriced
//
// Server-side: lineTierKey lives in lib/provenance/boq.ts, which curates
// identity. Components import lib/provenance/tier-vocab.ts and receive marks as
// data.
// =============================================================================

import { isUnpricedLine } from "@/lib/documents/boq-derived";
import { OWN_PRICE_TIER } from "@/lib/boq/own-basis-vocab";
import { lineItemKey, lineTierKey, type ProvLine } from "@/lib/provenance/boq";

import { weaker, type LineTiers, type PricedTier } from "./tier-vocab";

export * from "./tier-vocab";

export interface TierContext {
  /** item_key → rate_book.qs_validated (lib/provenance/load.ts). The ONLY road to "validated". */
  qsValidated?: Record<string, boolean>;
}

/** The plain-words reason a rate tier is derived ("Derived — site assessment"). */
const RATE_WHY: Record<string, string> = {
  catalog: "catalogue price",
  allowance: "rule allowance",
  labour_book: "labour rate book",
  p4_constant: "take-off constant",
  overlay_default: "default point rate",
  indicative: "indicative rate",
  furniture: "indicative retail",
  selection: "selected product, not QS-checked",
};
const STATUS_WHY: Record<string, string> = {
  site_assessment: "site assessment",
  indicative: "indicative rate",
  needs_selection: "awaiting a selection",
};

export function tierOf(line: ProvLine, workSection: string, ctx: TierContext = {}): LineTiers {
  if (isUnpricedLine(line)) return { qty: "unpriced", rate: "unpriced", amount: "unpriced", qtyWhy: null, rateWhy: null };

  const qty: PricedTier = line.qty_derived ? "derived" : "measured";
  const qtyWhy = line.qty_derived ? "quantity derived" : null;

  const key = lineTierKey(line, workSection);
  let rate: PricedTier;
  let rateWhy: string | null = null;
  if (key === "firm_private" || key === "firm_correction" || key === OWN_PRICE_TIER) rate = "measured";
  else if (key === "reference" || key === "module_reference") {
    const item = lineItemKey(line);
    rate = item && ctx.qsValidated?.[item] === true ? "validated" : "market";
  } else if (key === "selection") {
    rate = line.rate_status === "priced" ? "market" : "derived";
    if (rate === "derived") rateWhy = RATE_WHY.selection!;
  } else {
    rate = "derived";
    rateWhy = key ? (RATE_WHY[key] ?? null) : "source not established";
  }
  const status = line.rate_status ? STATUS_WHY[line.rate_status] : undefined;
  if (status) {
    rate = weaker(rate, "derived");
    rateWhy = status;
  }

  return { qty, rate, amount: weaker(qty, rate), qtyWhy, rateWhy };
}
