// =============================================================================
// lib/pilot/metrics.ts — the three-firms evidence, per firm and per project (L5).
//
// Pure. Given the rows (events with their 048 columns, projects, corrections
// with a resolved section, pack exports), it answers per project:
//
//   time to first BoQ        project start → the first BoQ generated for the pilot
//   time to first FULL BoQ   … with nothing left untyped / undecided
//   checking time            first BoQ generated → the first RELEASE (a pack export
//                            that passed in the app, or a document handed over) —
//                            "prep + checking" in the spec's words
//   corrections              count, by type, by section, and where they LANDED:
//                            promoted into the firm's book, or left on the project
//   support touches          help requests, interventions, reported errors
//   reviews                  signed-in views of the BoQ (048+), distinct actors
//
// and per firm: its projects, the sums and medians, its rate-book changes, and —
// stated, not hidden — the GAPS: events with no actor (pre-048, or a script),
// projects with no firm, metrics that could not be computed and why.
//
// Not the pilot: stage `verification` (our checks) and `reference_pack` (a pack
// exported for another project to look at). Scripted stages count for what was
// produced, never as the firm's own time.
// =============================================================================

import { NON_PILOT_STAGES, SCRIPTED_STAGES } from "./events";

export interface EventRow {
  project_id: string | null;
  firm_id: string | null;
  kind: string;
  actor: string | null;
  session_ref: string | null;
  duration_ms: number | null;
  stage: string | null;
  recorded_at: string;
  detail: Record<string, unknown> | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  firm_id: string | null;
  created_at: string;
  scope: "garden" | "interior" | "mixed" | "none";
}

export interface CorrectionRow {
  project_id: string;
  firm_id: string | null;
  correction_type: string;
  item_key: string | null;
  /** Resolved by the loader from the item key (POMI section) or null. */
  section: string | null;
  promoted_at: string | null;
  recorded_at: string;
  session_ref: string | null;
}

export interface PackRow {
  project_id: string;
  source: string;
  status: string;
  stage: string | null;
  actor: string | null;
  created_at: string;
  finished_at: string | null;
  proposal: boolean;
}

export interface FirmRow {
  id: string;
  name: string;
}

export interface ProjectMetrics {
  project_id: string;
  name: string;
  firm_id: string | null;
  scope: ProjectRow["scope"];
  events: number;
  started_at: string | null;
  first_boq_at: string | null;
  first_full_boq_at: string | null;
  first_release_at: string | null;
  /** project start → first BoQ generated (pilot stages only). */
  time_to_first_boq_min: number | null;
  time_to_first_full_boq_min: number | null;
  /** first BoQ generated → first release ("prep + checking"). */
  checking_min: number | null;
  boq_generations: number;
  reviews: { views: number; distinct_actors: number; first_view_at: string | null };
  corrections: {
    total: number;
    by_type: Record<string, number>;
    by_section: Record<string, number>;
    landed: { book: number; project: number };
  };
  support: { touches: number; by_channel: Record<string, number>; unresolved: number };
  friction: number;
  approvals: number;
  acceptances: number;
  packs: { app_passed: number; app_blocked: number; app_failed: number };
  /** Distinct signed-in actors seen on the project. */
  actors: number;
  /** Pilot events with no actor — a script's, or ours, or pre-048. */
  events_without_actor: number;
  /** Why a figure is missing, in words. */
  gaps: string[];
}

export interface FirmMetrics {
  firm_id: string;
  name: string;
  projects: ProjectMetrics[];
  totals: {
    projects: number;
    boq_generations: number;
    corrections: ProjectMetrics["corrections"];
    support_touches: number;
    reviews: number;
    median_time_to_first_boq_min: number | null;
    median_checking_min: number | null;
  };
  rate_book: { entries: number; edits: number; promotions: number; retirements: number; quote_accepts: number };
  gaps: string[];
}

export interface ThreeFirmsEvidence {
  firms: FirmMetrics[];
  /** Projects with events but no firm — reported, never silently dropped. */
  unattributed: ProjectMetrics[];
  generated_at: string;
}

const minutes = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 60000) * 10) / 10;
const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round(((s[m - 1]! + s[m]!) / 2) * 10) / 10;
};
const count = (xs: readonly string[]) => xs.reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});
const stageOf = (e: EventRow) => e.stage ?? (typeof e.detail?.stage === "string" ? e.detail.stage : null);
const isPilot = (e: EventRow) => !NON_PILOT_STAGES.has(stageOf(e) ?? "");

export function projectMetrics(project: ProjectRow, allEvents: readonly EventRow[], allCorrections: readonly CorrectionRow[], allPacks: readonly PackRow[]): ProjectMetrics {
  const events = allEvents.filter((e) => e.project_id === project.id).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const pilot = events.filter(isPilot);
  const corrections = allCorrections.filter((c) => c.project_id === project.id);
  const packs = allPacks.filter((p) => p.project_id === project.id && !NON_PILOT_STAGES.has(p.stage ?? ""));
  const gaps: string[] = [];

  const started = pilot.find((e) => e.kind === "plan_started")?.recorded_at ?? project.created_at ?? pilot[0]?.recorded_at ?? null;
  const boqs = pilot.filter((e) => e.kind === "boq_generated");
  const firstBoq = boqs[0]?.recorded_at ?? null;
  const firstFull = boqs.find((e) => e.detail?.full === true)?.recorded_at ?? null;
  // A release: an app pack export that passed, or a document handed over outside a
  // verification run (a BoQ PDF / proposal event with no non-pilot stage).
  const releases = [
    ...packs.filter((p) => p.source === "app" && p.status === "passed").map((p) => ({ at: p.finished_at ?? p.created_at, actor: p.actor })),
    ...pilot.filter((e) => e.kind === "pack_exported" && (e.detail?.document === "boq_pdf" || e.detail?.document === "proposal") && !SCRIPTED_STAGES.has(stageOf(e) ?? "")).map((e) => ({ at: e.recorded_at, actor: e.actor })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const firstRelease = releases[0]?.at ?? null;
  const releaseByUs = releases.length > 0 && !releases[0]!.actor;

  const views = pilot.filter((e) => e.kind === "boq_viewed");
  const support = pilot.filter((e) => e.kind === "support_touch");
  const byType = count(corrections.map((c) => c.correction_type));
  const bySection = count(corrections.map((c) => c.section ?? "unmapped"));
  const landedBook = corrections.filter((c) => !!c.promoted_at).length;
  const actors = new Set(events.map((e) => e.actor).filter((a): a is string => !!a));
  const noActor = pilot.filter((e) => !e.actor).length;

  if (!firstBoq) gaps.push("no BoQ generated in a pilot stage");
  if (firstBoq && !firstRelease) gaps.push("no release yet (no passed app export, no document handed over) — checking time open");
  if (firstBoq && firstRelease && releaseByUs) gaps.push("the first release carries no actor (our export or a script's, not the firm's) — checking time measures our pipeline, not the firm's review");
  if (noActor > 0) gaps.push(`${noActor} of ${pilot.length} pilot events carry no actor (pre-048 rows, or a script / our own run) — the firm's own time cannot be separated from ours on them`);
  if (views.length === 0) gaps.push("no signed-in BoQ views recorded (boq_viewed exists since 048)");
  if (project.firm_id == null) gaps.push("project has no firm — attributed to a firm only through its corrections' firm_id");

  return {
    project_id: project.id,
    name: project.name,
    firm_id: project.firm_id,
    scope: project.scope,
    events: events.length,
    started_at: started,
    first_boq_at: firstBoq,
    first_full_boq_at: firstFull,
    first_release_at: firstRelease,
    time_to_first_boq_min: started && firstBoq ? Math.max(0, minutes(started, firstBoq)) : null,
    time_to_first_full_boq_min: started && firstFull ? Math.max(0, minutes(started, firstFull)) : null,
    checking_min: firstBoq && firstRelease ? Math.max(0, minutes(firstBoq, firstRelease)) : null,
    boq_generations: boqs.length,
    reviews: { views: views.length, distinct_actors: new Set(views.map((v) => v.actor).filter(Boolean)).size, first_view_at: views[0]?.recorded_at ?? null },
    corrections: { total: corrections.length, by_type: byType, by_section: bySection, landed: { book: landedBook, project: corrections.length - landedBook } },
    support: {
      touches: support.length,
      by_channel: count(support.map((s) => String(s.detail?.channel ?? "unspecified"))),
      unresolved: support.filter((s) => s.detail?.resolved === false).length,
    },
    friction: pilot.filter((e) => e.kind === "friction").length,
    approvals: pilot.filter((e) => e.kind === "approval_recorded").length,
    acceptances: pilot.filter((e) => e.kind === "basis_accepted").length,
    packs: {
      app_passed: packs.filter((p) => p.source === "app" && p.status === "passed").length,
      app_blocked: packs.filter((p) => p.source === "app" && p.status === "blocked").length,
      app_failed: packs.filter((p) => p.source === "app" && p.status === "failed").length,
    },
    actors: actors.size,
    events_without_actor: noActor,
    gaps,
  };
}

/** A project belongs to a firm through projects.firm_id, or — failing that — through the firm its corrections name. */
export function firmOfProject(project: ProjectRow, corrections: readonly CorrectionRow[]): string | null {
  if (project.firm_id) return project.firm_id;
  const firms = new Set(corrections.filter((c) => c.project_id === project.id && c.firm_id).map((c) => c.firm_id!));
  return firms.size === 1 ? [...firms][0]! : null;
}

export function firmRollup(firm: FirmRow, projects: readonly ProjectRow[], events: readonly EventRow[], corrections: readonly CorrectionRow[], packs: readonly PackRow[]): FirmMetrics {
  const mine = projects.filter((p) => firmOfProject(p, corrections) === firm.id);
  const pm = mine.map((p) => projectMetrics(p, events, corrections, packs));
  const firmEvents = events.filter((e) => e.firm_id === firm.id && e.kind === "rate_book_change");
  const rb = { entries: 0, edits: 0, promotions: 0, retirements: 0, quote_accepts: 0 };
  for (const e of firmEvents) {
    const a = String(e.detail?.action ?? "");
    if (a === "entry") rb.entries++;
    else if (a === "edit") rb.edits++;
    else if (a === "promote") rb.promotions++;
    else if (a === "retire") rb.retirements++;
    else if (a === "quote_accept") rb.quote_accepts++;
  }
  const sum = (f: (p: ProjectMetrics) => number) => pm.reduce((n, p) => n + f(p), 0);
  const mergeCounts = (f: (p: ProjectMetrics) => Record<string, number>) => pm.reduce<Record<string, number>>((acc, p) => { for (const [k, v] of Object.entries(f(p))) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
  const gaps: string[] = [];
  const viaCorrections = mine.filter((p) => !p.firm_id).length;
  if (viaCorrections) gaps.push(`${viaCorrections} project(s) attributed only through corrections (projects.firm_id is null)`);
  if (firmEvents.length === 0) gaps.push("no rate-book change events (the firm made no entry / promotion / quote accept since 048, or its history predates 048)");
  if (pm.length === 0) gaps.push("no projects attributed to this firm");
  return {
    firm_id: firm.id,
    name: firm.name,
    projects: pm,
    totals: {
      projects: pm.length,
      boq_generations: sum((p) => p.boq_generations),
      corrections: { total: sum((p) => p.corrections.total), by_type: mergeCounts((p) => p.corrections.by_type), by_section: mergeCounts((p) => p.corrections.by_section), landed: { book: sum((p) => p.corrections.landed.book), project: sum((p) => p.corrections.landed.project) } },
      support_touches: sum((p) => p.support.touches),
      reviews: sum((p) => p.reviews.views),
      median_time_to_first_boq_min: median(pm.map((p) => p.time_to_first_boq_min).filter((x): x is number => x != null)),
      median_checking_min: median(pm.map((p) => p.checking_min).filter((x): x is number => x != null)),
    },
    rate_book: rb,
    gaps,
  };
}

export function threeFirmsEvidence(firms: readonly FirmRow[], projects: readonly ProjectRow[], events: readonly EventRow[], corrections: readonly CorrectionRow[], packs: readonly PackRow[], now = new Date()): ThreeFirmsEvidence {
  const rollups = firms.map((f) => firmRollup(f, projects, events, corrections, packs));
  const attributed = new Set(rollups.flatMap((r) => r.projects.map((p) => p.project_id)));
  const withEvents = new Set(events.map((e) => e.project_id).filter((x): x is string => !!x));
  const unattributed = projects.filter((p) => !attributed.has(p.id) && withEvents.has(p.id)).map((p) => projectMetrics(p, events, corrections, packs));
  return { firms: rollups, unattributed, generated_at: now.toISOString() };
}

/** Section of a rate-book item, for the by-section rollup. Pure over the two vocabularies the loader hands in. */
export function sectionOfItem(itemKey: string | null, gardenSections: Readonly<Record<string, string>>, interiorSections: Readonly<Record<string, string>>): string | null {
  if (!itemKey) return null;
  return gardenSections[itemKey] ?? interiorSections[itemKey] ?? null;
}
