// =============================================================================
// plan-interaction.ts — read/edit mode gate for EditablePlanViewer (P4 Step 4).
//
// Pure predicates that decide WHICH handlers register per mode. The component
// wires each listener inline as `predicate ? handler : undefined`, so a unit
// test on these predicates asserts handler registration directly (gate c)
// without rendering React. `read` mode never registers a geometry-mutating
// listener (onPointerMove is the mutator).
// =============================================================================

export type PlanViewerMode = "read" | "edit";

/** Editing affordances (toolbar, resize handles, delete X, rename) render only in edit. */
export function editingEnabled(mode: PlanViewerMode): boolean {
  return mode === "edit";
}

/**
 * SVG-level drag listeners (onPointerDown/Move/Up) register only in edit mode.
 * onPointerMove is the geometry mutator, so read mode registers none.
 */
export function svgDragEnabled(mode: PlanViewerMode): boolean {
  return mode === "edit";
}

/** A room click drags (edit) or inspects (read) — the two are mutually exclusive. */
export function roomInteraction(mode: PlanViewerMode): "drag" | "inspect" {
  return mode === "edit" ? "drag" : "inspect";
}
