// =============================================================================
// lib/plan/site-reference.ts — what already stands in the garden, and whether a
// plan's dimensions are derived or measured (garden pilot G5, migration 037).
//
// Two vocabularies that every consumer of a garden plan has to agree on, so they
// live in one pure module rather than being re-decided in the take-off, the 3D
// scene, the drawings and the editor:
//
// 1. SITE REFERENCE. A feature photographed on site (a gazebo, a sink counter, a
//    stepping-stone path, planter borders, trees, string lights) is placed on the
//    plan as the kind of thing it is and tagged site_reference. The designer
//    decides per item — keep, remove or replace — and that one word decides where
//    the item counts:
//
//                       new work   demolition   in the design (scene, drawings)
//      design item         yes         no          yes
//      keep                no          no          yes, as existing
//      remove              no          yes         no
//      replace             yes         yes         yes, as new
//      replace → other     no          yes         no — the replacing design element
//        (spec.replaced_by)                        carries the new work
//      not decided         no          no          yes, as existing — and the
//                                                  pack refuses to export
//
//    Keep is the load-bearing case: a kept gazebo is neither demolished nor
//    priced as a new pergola, however much it looks like one on the plan.
//
// 2. DERIVED DIMENSIONS. The client garden is drawn first from a developer type
//    plan and amended once the plot is measured. A plan is a DRAFT for as long as
//    any boundary-critical dimension — the plot, a zone outline, a run or a
//    context footprint — is still derived. Heights assumed for context volumes
//    are not boundary-critical and do not make a plan a draft.
// =============================================================================

export type Disposition = "keep" | "remove" | "replace";

export const DISPOSITIONS: readonly Disposition[] = ["keep", "remove", "replace"];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  keep: "Keep",
  remove: "Remove",
  replace: "Replace",
};

/** Appended to a BoQ measurement whose geometry is derived from a reference layout. */
export const DERIVED_QTY_NOTE = "derived from reference layout — firm after site verification";

/** The wording every draft cover and BoQ header carries, verbatim. */
export const DRAFT_STATEMENT =
  "DRAFT FOR REVIEW — quantities derived from reference layout; firm after site verification.";

export interface SiteRefTag {
  site_reference?: boolean | null;
  disposition?: string | null;
  /**
   * What replaces it, when the replacement is a DIFFERENT design element (a
   * stepping-stone path replaced by a porcelain path zone; string lights by the
   * designed lighting). Read from spec.replaced_by when not given directly.
   */
  replaced_by?: string | null;
  spec?: Record<string, unknown> | null;
}

/** The text of what replaces an item elsewhere in the design, or null (in place / not replaced). */
export function replacedBy(t: SiteRefTag): string | null {
  if (!t.site_reference || t.disposition !== "replace") return null;
  const v = t.replaced_by ?? (typeof t.spec?.replaced_by === "string" ? t.spec.replaced_by : null);
  return v && v.trim() ? v.trim() : null;
}

export function isDisposition(v: unknown): v is Disposition {
  return typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);
}

export function dispositionOf(t: SiteRefTag): Disposition | null {
  return t.site_reference && isDisposition(t.disposition) ? t.disposition : null;
}

/** Counts toward new-work quantities. */
export function isNewWork(t: SiteRefTag): boolean {
  if (!t.site_reference) return true;
  // Replaced by another design element: that element is the new work, not this one.
  return t.disposition === "replace" && !replacedBy(t);
}

/** Counts toward demolition quantities. */
export function isDemolished(t: SiteRefTag): boolean {
  return !!t.site_reference && (t.disposition === "remove" || t.disposition === "replace");
}

/** Stands in the designed garden (3D scene, drawings). A removed item does not. */
export function isInDesign(t: SiteRefTag): boolean {
  return !(t.site_reference && (t.disposition === "remove" || replacedBy(t) !== null));
}

/** Stands in the designed garden as the EXISTING item (kept, or not yet decided). */
export function isExistingInDesign(t: SiteRefTag): boolean {
  return !!t.site_reference && t.disposition !== "remove" && t.disposition !== "replace";
}

/** A site-reference item nobody has decided about yet. */
export function isUndecided(t: SiteRefTag): boolean {
  return !!t.site_reference && !isDisposition(t.disposition);
}

// --- Draft status ----------------------------------------------------------------

export interface DimsItem {
  id: string;
  name: string;
  dims_derived?: boolean | null;
}

export interface DraftInput {
  plot_dims_derived: boolean;
  dims_note: string | null;
  zones: readonly DimsItem[];
  runs: readonly DimsItem[];
  context: readonly DimsItem[];
}

export interface DraftStatus {
  draft: boolean;
  /** The boundary-critical items still derived, named. Empty when not a draft. */
  derived: string[];
  note: string | null;
  statement: string | null;
}

export function draftStatus(input: DraftInput): DraftStatus {
  const derived: string[] = [];
  if (input.plot_dims_derived) derived.push("plot boundary");
  for (const z of input.zones) if (z.dims_derived) derived.push(`zone: ${z.name}`);
  for (const r of input.runs) if (r.dims_derived) derived.push(`run: ${r.name}`);
  for (const c of input.context) if (c.dims_derived) derived.push(`context: ${c.name}`);
  const draft = derived.length > 0;
  return { draft, derived, note: draft ? input.dims_note : null, statement: draft ? DRAFT_STATEMENT : null };
}
