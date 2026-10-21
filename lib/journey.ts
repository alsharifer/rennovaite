// =============================================================================
// lib/journey.ts — the two journeys, in one place.
//
// The OWNER journey (K8, spec §6.0 — "rethought", 13 Oct): 00 Overview · 01 Plan
// · 02 Design · 03 Renders · 04 Cost · 05 Timeline · 06 Tender. Seven steps with
// FIXED numbers, like the firm journey: a step never drops out of the numbering.
// What a deployment lacks moves inside a step instead (06 Tender opens on its
// Contractors & suppliers tab when DRAWINGS_ENABLED is off).
//
// Two steps own two routes each, drawn as sub-tabs (text tabs, brass 2 px
// underline, each a real link) — 04 Cost: /boq | /accessories; 06 Tender:
// /drawings | /vendors — and the rail lights the step on both. 02 Design is one
// route with two views (?view=direction | references); the old /ideation,
// /style and /moodboard routes 308 to it.
//
// The intake (/project/new) is part of 01 Plan. The 3D viewer is a side
// surface, never a numbered stop: the rail keeps the step you came from.
//
// The FIRM journey (K2) follows, unchanged.
// =============================================================================

export interface JourneyFlags {
  drawingsEnabled: boolean;
}

/** Read the flags the journey depends on from the environment (server-side). */
export function journeyFlagsFromEnv(): JourneyFlags {
  return { drawingsEnabled: process.env.DRAWINGS_ENABLED === "true" };
}

export type OwnerStepKey = "overview" | "plan" | "design" | "renders" | "cost" | "timeline" | "tender";

/** One sub-tab of an owner step: a route of its own, a real link. */
export interface OwnerSubTab {
  key: string;
  label: string;
  /** Project-relative path, e.g. "/boq". */
  path: string;
  available: (flags: JourneyFlags) => boolean;
}

export interface OwnerStepDef {
  key: OwnerStepKey;
  /** Fixed two-digit number, "00"–"06". */
  number: string;
  label: string;
  /** One line on what the step is for (empty states, Next). */
  blurb: string;
  /** The project-relative paths on which this step is the active one ("" = the overview). */
  activeOn: readonly string[];
  /** Sub-tabs, in order; the step opens on the first available one. */
  tabs?: readonly OwnerSubTab[];
  /** The step's own path when it has no tabs. */
  path?: string;
}

const ALWAYS = () => true;

export const OWNER_STEPS: readonly OwnerStepDef[] = [
  { key: "overview", number: "00", label: "Overview", blurb: "Where your renovation stands.", activeOn: [""], path: "" },
  { key: "plan", number: "01", label: "Plan", blurb: "Your floor plan, read and checked.", activeOn: ["/plan"], path: "/plan" },
  {
    key: "design",
    number: "02",
    label: "Design",
    blurb: "A direction for the villa and the references every render follows.",
    activeOn: ["/design", "/ideation", "/style", "/moodboard"],
    path: "/design",
  },
  { key: "renders", number: "03", label: "Renders", blurb: "Each room in your chosen direction.", activeOn: ["/render"], path: "/render" },
  {
    key: "cost",
    number: "04",
    label: "Cost",
    blurb: "A priced bill of quantities and the products you choose.",
    activeOn: ["/boq", "/boq/revisions", "/accessories"],
    tabs: [
      { key: "boq", label: "Bill of quantities", path: "/boq", available: ALWAYS },
      { key: "specification", label: "Specification", path: "/accessories", available: ALWAYS },
    ],
  },
  { key: "timeline", number: "05", label: "Timeline", blurb: "How long the work should take.", activeOn: ["/timeline"], path: "/timeline" },
  {
    key: "tender",
    number: "06",
    label: "Tender",
    blurb: "Documents for contractors and the suppliers for every line.",
    activeOn: ["/drawings", "/vendors"],
    tabs: [
      { key: "documents", label: "Documents", path: "/drawings", available: (f) => f.drawingsEnabled },
      { key: "suppliers", label: "Contractors & suppliers", path: "/vendors", available: ALWAYS },
    ],
  },
];

/** The project-relative path a step opens on (its first available tab). */
function ownerStepPath(s: OwnerStepDef, flags: JourneyFlags): string {
  if (s.tabs) return (s.tabs.find((t) => t.available(flags)) ?? s.tabs[s.tabs.length - 1]!).path;
  return s.path ?? "";
}

export function ownerStep(key: OwnerStepKey): OwnerStepDef {
  return OWNER_STEPS.find((s) => s.key === key)!;
}

/** Where an owner step opens for a project. */
export function ownerStepHref(key: OwnerStepKey, projectId: string, flags: JourneyFlags): string {
  return `/project/${projectId}${ownerStepPath(ownerStep(key), flags)}`;
}

/** A step's available sub-tabs for a project, with hrefs — what the tab strip draws. */
export function ownerSubTabs(key: OwnerStepKey, projectId: string, flags: JourneyFlags): { key: string; label: string; href: string; path: string }[] {
  return (ownerStep(key).tabs ?? []).filter((t) => t.available(flags)).map((t) => ({ key: t.key, label: t.label, path: t.path, href: `/project/${projectId}${t.path}` }));
}

/** The step after `key` (null after 06 Tender) — a page's "Continue to …". */
export function nextOwnerStep(key: OwnerStepKey): OwnerStepDef | null {
  const i = OWNER_STEPS.findIndex((s) => s.key === key);
  return i >= 0 && i + 1 < OWNER_STEPS.length ? OWNER_STEPS[i + 1]! : null;
}

// =============================================================================
// The FIRM journey (K2) — Blueprint v0.4 §7, R7 rail frame 9:361.
//
// The persona decides which journey a page's rail renders — a member of the
// firm a project is attached to sees this one, everyone else the owner journey
// (lib/journey-state.ts). Numbering is FIXED, 00–08: a firm step never drops
// out; when it cannot be used yet it is Blocked and says why.
//
// Every step maps to a route that exists. 01 Project & Plan is the intake
// (v0.4 §7) — for an existing project there is no per-project intake page, so
// it opens the plan, whose source and parse state it covers; 02 Scope owns
// that route's active state (spec §3.8).
// =============================================================================

export type JourneyPersona = "firm" | "owner";

/**
 * K2's persona rule, the one place it is decided (C5 #3): a member of the firm
 * the project is attached to works the FIRM journey; everyone else — every
 * project with no firm, and (impossible under the persona invariant) a
 * non-member on a firm project — the owner's.
 */
export function journeyPersona(projectFirmId: string | null | undefined, callerFirmIds: readonly string[]): JourneyPersona {
  return projectFirmId && callerFirmIds.includes(projectFirmId) ? "firm" : "owner";
}

/** What the rail calls things for a persona — a firm project never reads "My home" or "Owner". */
export function railPersonaLabels(persona: JourneyPersona, opts: { admin?: boolean } = {}): { switcher: string; projects: string; journey: string; role: string } {
  return persona === "firm"
    ? { switcher: "Project", projects: "Projects", journey: "Firm journey", role: opts.admin ? "Firm admin" : "Firm member" }
    : { switcher: "My home", projects: "Your homes", journey: "Your renovation", role: "Owner" };
}

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

/**
 * Which step a pathname lights, for either persona. Exact project-relative
 * match (so a firm's /boq/revisions is 07, not 05); null when the page is not a
 * step (the 3D viewer, settings).
 */
export function activeStepKey(persona: JourneyPersona, pathname: string, projectId: string | null): string | null {
  if (persona === "owner" && pathname === "/project/new") return "plan";
  const prefix = projectId ? `/project/${projectId}` : null;
  if (!prefix || !(pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  const rel = pathname.slice(prefix.length).replace(/\/$/, "");
  const steps: readonly { key: string; activeOn: readonly string[] }[] = persona === "firm" ? FIRM_STEPS : OWNER_STEPS;
  return steps.find((s) => s.activeOn.includes(rel))?.key ?? null;
}
