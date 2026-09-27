// =============================================================================
// lib/boq/revision-diff-types.ts — the revision diff's vocabulary (U4).
//
// CLIENT-SAFE: no imports. The diff engine (lib/boq/revision-diff.ts) reaches the
// landscape take-off and the ground-truth module through the line-identity map,
// so a client component must not import it — the view takes the labels and the
// types from here.
// =============================================================================

export type DiffClass = "quantity" | "rate" | "both" | "added" | "removed";
export type CauseKind = "correction" | "firm_rate" | "plan_edit" | "session_decision" | "regeneration";

/** Human label for a class, shared by the view and the PDF. */
export const DIFF_CLASS_LABEL: Record<DiffClass, string> = {
  quantity: "quantity moved",
  rate: "rate moved",
  both: "quantity and rate moved",
  added: "added",
  removed: "removed",
};

export const CAUSE_KIND_LABEL: Record<CauseKind, string> = {
  correction: "Correction recorded",
  firm_rate: "Contractor rate book",
  plan_edit: "Plan edited",
  session_decision: "Session decision",
  regeneration: "BoQ regenerated",
};
