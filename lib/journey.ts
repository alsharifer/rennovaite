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
    available: () => true,
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

// =============================================================================
// The FIRM journey (K2) — Blueprint v0.4 §7, R7 rail frame 9:361.
//
// A separate definition beside the owner list above (which is untouched): the
// persona decides which one a page's rail renders — a member of the firm a
// project is attached to sees this one, everyone else the owner journey
// (lib/journey-state.ts). Numbering is FIXED, 00–08: a firm step never drops
// out; when it cannot be used yet it is Blocked and says why.
//
// Every step maps to a route that exists. 01 Project & Plan is the intake
// (v0.4 §7) — for an existing project there is no per-project intake page, so
// it opens the plan, whose source and parse state it covers; 02 Scope owns
// that route's active state (spec §3.8). 08 Proposal opens a gate page until
// K4 builds the proposal screen there.
// =============================================================================

export type JourneyPersona = "firm" | "owner";

export type FirmStepKey =
  | "hub"
  | "project_plan"
  | "scope"
  | "specification"
  | "rates_basis"
  | "boq_review"
  | "documents"
  | "revisions"
  | "proposal";

export interface FirmStepDef {
  key: FirmStepKey;
  /** Fixed two-digit number, "00"–"08". */
  number: string;
  label: string;
  href: (projectId: string) => string;
  /** The project-relative paths on which this step is the active one ("" = the hub). */
  activeOn: readonly string[];
}

export const FIRM_STEPS: readonly FirmStepDef[] = [
  { key: "hub", number: "00", label: "Project hub", href: (id) => `/project/${id}`, activeOn: [""] },
  { key: "project_plan", number: "01", label: "Project & Plan", href: (id) => `/project/${id}/plan`, activeOn: [] },
  { key: "scope", number: "02", label: "Scope", href: (id) => `/project/${id}/plan`, activeOn: ["/plan"] },
  { key: "specification", number: "03", label: "Specification", href: (id) => `/project/${id}/accessories`, activeOn: ["/accessories"] },
  { key: "rates_basis", number: "04", label: "Rates & Basis", href: (id) => `/project/${id}/rates`, activeOn: ["/rates"] },
  { key: "boq_review", number: "05", label: "BoQ & Review", href: (id) => `/project/${id}/boq`, activeOn: ["/boq"] },
  { key: "documents", number: "06", label: "Documents", href: (id) => `/project/${id}/drawings`, activeOn: ["/drawings"] },
  { key: "revisions", number: "07", label: "Revisions & Approval", href: (id) => `/project/${id}/boq/revisions`, activeOn: ["/boq/revisions"] },
  { key: "proposal", number: "08", label: "Proposal", href: (id) => `/project/${id}/proposal`, activeOn: ["/proposal"] },
];

/** Owner steps' extra surfaces that light the same step (style folds into ideation). */
const OWNER_ACTIVE_ALIASES: Partial<Record<JourneyStepKey, readonly string[]>> = {
  ideation: ["/ideation", "/style"],
  costing: ["/boq", "/boq/revisions", "/accessories"],
};

/**
 * Which step a pathname lights, for either persona. Exact project-relative
 * match first (so /boq/revisions is 07, not 05); null when the page is not a
 * step (the 3D viewer, settings).
 */
export function activeStepKey(persona: JourneyPersona, pathname: string, projectId: string | null, flags: JourneyFlags): string | null {
  const prefix = projectId ? `/project/${projectId}` : null;
  if (persona === "firm") {
    if (!prefix || !(pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
    const rel = pathname.slice(prefix.length).replace(/\/$/, "");
    return FIRM_STEPS.find((s) => s.activeOn.includes(rel))?.key ?? null;
  }
  if (pathname === "/project/new") return "intake";
  if (!prefix || !pathname.startsWith(prefix)) return null;
  const rel = pathname.slice(prefix.length).replace(/\/$/, "");
  for (const s of journeySteps(flags)) {
    const own = s.key === "intake" ? null : s.href(projectId!).slice(prefix.length);
    if ((OWNER_ACTIVE_ALIASES[s.key] ?? (own ? [own] : [])).includes(rel)) return s.key;
  }
  return null;
}
