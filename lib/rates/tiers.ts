// =============================================================================
// lib/rates/tiers.ts — which tier answered a resolved figure (L1).
//
// RESOLUTION ORDER — one order for every pricing path, first answer wins:
//
//   1. firm_private     the project's firm's own rate (firm_rate_entries,
//                       origin = firm_entry)
//   2. firm_correction  that firm's own market_fair correction, EXPLICITLY
//                       promoted into its book (origin = promoted_correction).
//                       An unpromoted correction is recorded, never applied.
//   3. reference        the calibrated reference book: rate_book rows with
//                       provenance = actual_transaction
//   4. interior fallbacks, in RateResolver's existing order:
//        catalog        a pricing_skus pick at the tier percentile
//        allowance      the rule's allowance (empty SKU pool, or allowance-only)
//        labour_book    a labour_rates band
//   5. indicative       rate_book seed / indicative rows — a placeholder
//
//   unpriced            nothing answered; a visible rate-0 line for the QS
//                       (garden needs_qs items). Not a tier that prices.
//   selection           a user-chosen accessory laid over whichever tier
//                       answered (D1) — applied at the same layer as the overlay.
//
// Tiers 1–2 exist only for a project whose `projects.firm_id` is set; for every
// other project the order starts at 3, and before any interior rate_book row
// shares a key with a RATE_RULES item (none does today) tier 3 answers only for
// garden keys — which is why every pre-L1 BoQ regenerates unchanged.
//
// The label a line carries is a CONSTANT from this module (or the garden's
// public label), never a database string. That is the sanitisation boundary for
// `rate_book.source`, which on the Mudon interior actuals names suppliers and
// contractors: nothing a resolver emits is read from it.
// =============================================================================

export const RATE_TIERS = [
  "firm_private",
  "firm_correction",
  "reference",
  "catalog",
  "allowance",
  "labour_book",
  "indicative",
  "unpriced",
  "selection",
] as const;
export type RateTier = (typeof RATE_TIERS)[number];

export const FIRM_TIERS: readonly RateTier[] = ["firm_private", "firm_correction"];
export const isFirmTier = (t: RateTier | null | undefined): boolean => t === "firm_private" || t === "firm_correction";

/**
 * Public labels. A firm's rate reaches a client document as "contractor rate
 * book" — the firm is the one pricing the job, so the rate is honestly theirs,
 * but it is never NAMED on a line: identity stays in `firms`.
 */
export const FIRM_RATE_LABEL = "contractor rate book";
export const FIRM_CORRECTION_LABEL = "contractor rate book (reviewed correction)";
export const INTERIOR_REFERENCE_LABEL = "market reference — Dubai interior (transacted)";
export const INDICATIVE_LABEL = "indicative rate — QS to confirm";

export const TIER_TITLE: Record<RateTier, string> = {
  firm_private: "Firm rate",
  firm_correction: "Firm correction",
  reference: "Market reference",
  catalog: "Catalogue price",
  allowance: "Allowance",
  labour_book: "Labour rate book",
  indicative: "Indicative",
  unpriced: "To be priced",
  selection: "Selected product",
};
