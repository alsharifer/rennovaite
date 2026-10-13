// =============================================================================
// lib/boq/revision-diff-types.ts — the revision diff's vocabulary (U4).
//
// CLIENT-SAFE: no imports. The diff engine (lib/boq/revision-diff.ts) reaches the
// landscape take-off and the ground-truth module through the line-identity map,
// so a client component must not import it — the view takes the labels and the
// types from here.
// =============================================================================

export type DiffClass = "quantity" | "rate" | "both" | "total" | "added" | "removed";
export type CauseKind = "correction" | "applied_correction" | "reverted_correction" | "firm_rate" | "plan_edit" | "session_decision" | "regeneration" | "engine_rounding";

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
  session_decision: "Session decision",
  regeneration: "BoQ regenerated",
  engine_rounding: "H7 rounding",
};
