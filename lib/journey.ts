// =============================================================================
// lib/journey.ts — the Phase-1 Target Workflow, in one place.
//
// The nine canonical steps a villa moves through. Before this module every page
// hard-coded its own "Step 03 of 05" string, render/drawings/viewer sat off the
// numbered path entirely, and adding a step meant editing five files that could
// disagree. Now each page asks for its own step and the label is derived.
//
// AVAILABILITY is the important part. A step that is flag-disabled or not yet
// built DROPS OUT of the numbering rather than becoming a dead end: the journey
// renumbers around it, so a user never sees a step they cannot reach and the
// denominator always matches what is actually navigable. Today that means
// `scope_timeline` (T4) is absent and `downloads` follows DRAWINGS_ENABLED.
//
// Style selection is NOT its own step — it folds into step 3 (Ideation), which
// recommends a direction from the questionnaire. `/style` is a second surface
// on that same step, not a step of its own.
//
// The 3D viewer is deliberately absent: it is a view-only side surface reached
// from the layout and render steps, never a numbered stop.
// =============================================================================

export type JourneyStepKey =
  | "intake"
  | "layout"
  | "ideation"
  | "moodboard"
  | "render"
  | "costing"
  | "scope_timeline"
  | "downloads"
  | "marketplace";

export interface JourneyStepDef {
  key: JourneyStepKey;
  /** Short label for the step chrome + hub. */
  label: string;
  /** One line describing what the step is for (empty states, hub cards). */
  blurb: string;
  /** Material Symbols glyph. */
  glyph: string;
  /** Path for a project, or null for the pre-project intake step. */
  href: (projectId: string) => string;
  /**
   * Whether the step exists for this deployment. `false` removes it from the
   * numbering entirely — no dead ends, no "coming soon" stops.
   */
  available: (flags: JourneyFlags) => boolean;
  /** Steps that are only partly built, so the UI can say so honestly. */
  partial?: boolean;
}

export interface JourneyFlags {
  drawingsEnabled: boolean;
}

/** Read the flags the journey depends on from the environment (server-side). */
export function journeyFlagsFromEnv(): JourneyFlags {
  return { drawingsEnabled: process.env.DRAWINGS_ENABLED === "true" };
}

const STEPS: JourneyStepDef[] = [
  {
    key: "intake",
    label: "Intake",
    blurb: "Floor plans, existing drawings and site photos.",
    glyph: "upload_file",
    href: () => "/project/new",
    available: () => true,
  },
  {
    key: "layout",
    label: "Layout",
    blurb: "Confirm the parsed rooms, then place doors and windows.",
    glyph: "grid_on",
    href: (id) => `/project/${id}/plan`,
    available: () => true,
  },
  {
    key: "ideation",
    label: "Ideation",
    blurb: "A few questions, then a recommended direction with samples.",
    glyph: "auto_awesome",
    href: (id) => `/project/${id}/ideation`,
    available: () => true,
  },
  {
    key: "moodboard",
    label: "Moodboard",
    blurb: "Gather the references that will steer every render.",
    glyph: "gallery_thumbnail",
    href: (id) => `/project/${id}/moodboard`,
    available: () => true,
  },
  {
    key: "render",
    label: "Renders",
    blurb: "See each room in your chosen direction.",
    glyph: "auto_fix_high",
    href: (id) => `/project/${id}/render`,
    available: () => true,
  },
  {
    key: "costing",
    label: "Costing & BoQ",
    blurb: "A priced bill of quantities with accessory and spec selection.",
    glyph: "receipt_long",
    href: (id) => `/project/${id}/boq`,
    available: () => true,
  },
  {
    key: "scope_timeline",
    label: "Scope & timeline",
    blurb: "Phase durations and a dated programme.",
    glyph: "calendar_month",
    href: (id) => `/project/${id}/timeline`,
    // T4 — not built yet, so it drops out of the numbering entirely.
    available: () => false,
  },
  {
    key: "downloads",
    label: "Downloads",
    blurb: "Drawing suite and the render pack, ready to send.",
    glyph: "download",
    href: (id) => `/project/${id}/drawings`,
    available: (f) => f.drawingsEnabled,
    // Dimensioned plans + overlays today; the render PDF pack is still to come.
    partial: true,
  },
  {
    key: "marketplace",
    label: "Vendors",
    blurb: "Match every line to a supplier and lock your basket.",
    glyph: "storefront",
    href: (id) => `/project/${id}/vendors`,
    available: () => true,
  },
];

export interface JourneyStep extends JourneyStepDef {
  /** 1-based position among the AVAILABLE steps. */
  number: number;
}

/** The navigable steps, renumbered so the count reflects what exists. */
export function journeySteps(flags: JourneyFlags): JourneyStep[] {
  return STEPS.filter((s) => s.available(flags)).map((s, i) => ({
    ...s,
    number: i + 1,
  }));
}

/** Total navigable steps — the denominator in "Step 3 of 8". */
export function journeyLength(flags: JourneyFlags): number {
  return journeySteps(flags).length;
}

/** One step by key, or null when it is unavailable in this deployment. */
export function journeyStep(
  key: JourneyStepKey,
  flags: JourneyFlags,
): JourneyStep | null {
  return journeySteps(flags).find((s) => s.key === key) ?? null;
}

/** "Step 03 of 08" — zero-padded to match the existing step chrome. */
export function stepLabel(key: JourneyStepKey, flags: JourneyFlags): string {
  const step = journeyStep(key, flags);
  const total = journeyLength(flags);
  if (!step) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Step ${pad(step.number)} of ${pad(total)}`;
}

/** The step after `key` among available steps (null at the end). */
export function nextStep(
  key: JourneyStepKey,
  flags: JourneyFlags,
): JourneyStep | null {
  const steps = journeySteps(flags);
  const i = steps.findIndex((s) => s.key === key);
  return i >= 0 && i + 1 < steps.length ? steps[i + 1]! : null;
}

/** The step before `key` among available steps (null at the start). */
export function prevStep(
  key: JourneyStepKey,
  flags: JourneyFlags,
): JourneyStep | null {
  const steps = journeySteps(flags);
  const i = steps.findIndex((s) => s.key === key);
  return i > 0 ? steps[i - 1]! : null;
}
