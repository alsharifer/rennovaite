// =============================================================================
// lib/boq/revision-diff-types.ts — the revision diff's vocabulary (U4).
//
// CLIENT-SAFE: no imports. The diff engine (lib/boq/revision-diff.ts) reaches the
// landscape take-off and the ground-truth module through the line-identity map,
// so a client component must not import it — the view takes the labels and the
// types from here.
// =============================================================================

export type DiffClass = "quantity" | "rate" | "both" | "total" | "added" | "removed";
export type CauseKind = "correction" | "applied_correction" | "reverted_correction" | "firm_rate" | "plan_edit" | "scope_change" | "openings_confirmed" | "openings_need_wall" | "ceiling_height" | "tiled_height" | "product_change" | "wet_room" | "session_decision" | "regeneration" | "engine_rounding" | "engine_change";

/** Human label for a class, shared by the view and the PDF. */
export const DIFF_CLASS_LABEL: Record<DiffClass, string> = {
  quantity: "quantity moved",
  rate: "rate moved",
  // H7: quantity and rate as printed are unchanged; only the total's rounding moved.
  total: "total moved (rounding)",
  both: "quantity and rate moved",
  added: "added",
  removed: "removed",
};

export const CAUSE_KIND_LABEL: Record<CauseKind, string> = {
  correction: "Correction recorded",
  // K11 #4 (057): a price added on review / a correction applied to the BoQ — and undone by a revert.
  applied_correction: "Applied to the BoQ",
  reverted_correction: "Reverted",
  firm_rate: "Contractor rate book",
  plan_edit: "Plan edited",
  // K12: rooms added to / left out of the renovation on 01 Plan.
  scope_change: "Scope changed",
  // R10b: openings found on the drawing, confirmed by the owner on 01 Plan.
  openings_confirmed: "Openings confirmed",
  openings_need_wall: "Openings need a wall",
  // B1 (061): a room's ceiling height entered or changed on 01 Plan.
  ceiling_height: "Ceiling height",
  tiled_height: "Tiled height",
  // B7: a product swapped from a BoQ line; the wet-room panel on 01 Plan.
  product_change: "Product changed",
  wet_room: "Wet room",
  session_decision: "Session decision",
  regeneration: "BoQ regenerated",
  engine_rounding: "H7 rounding",
  // C1: a defect fixed in the engine, named only where the stored engine versions straddle the fix.
  engine_change: "Engine fix",
};
