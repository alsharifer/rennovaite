// =============================================================================
// lib/boq/own-basis-vocab.ts — the words for a price added on review and an
// applied correction (K11 #4, spec §7.3). CLIENT-SAFE: no imports.
// =============================================================================

/** The resolution tier a priced-on-review line carries (`rate_tier`). tierOf → measured ("own basis"). */
export const OWN_PRICE_TIER = "own_price";

/** The line's `vendor_or_source` — a curated role label, never a person or a firm. */
export const OWN_PRICE_SOURCE = "own price — added on review";

export type BasisKind = "supplier_quote" | "contractor_price" | "own_estimate";
export const BASIS_KINDS: readonly BasisKind[] = ["supplier_quote", "contractor_price", "own_estimate"];
export const BASIS_LABEL: Record<BasisKind, string> = {
  supplier_quote: "Quote from a supplier",
  contractor_price: "Contractor's price",
  own_estimate: "My own estimate",
};

export type CorrectionOrigin = "correction" | "add_price";

/** "Quote from a supplier — Oct 2026" — the basis as the popover and the diff print it. */
export function basisText(kind: BasisKind | null | undefined, note: string | null | undefined): string | null {
  const head = kind ? BASIS_LABEL[kind] : null;
  const tail = note?.trim() || null;
  return head && tail ? `${head} — ${tail}` : (head ?? tail);
}

/** "Price added by <name>" / "Correction by <name>" — the diff's cause. */
export function appliedHeadline(origin: CorrectionOrigin, byName: string | null | undefined): string {
  const who = byName?.trim() || "a project member";
  return origin === "add_price" ? `Price added by ${who}` : `Correction by ${who}`;
}

/** Undo lives in Revisions (spec §7.3). */
export const UNDO_SENTENCE = "Undo it from Revisions.";
