// =============================================================================
// lib/pilot/events.ts — the pilot's instrumentation (G5 → L5).
//
// The pilot is measured, not remembered: time to a first BoQ, time from the
// first generation to the export (prep + checking), corrections and where they
// landed, support touches — PER FIRM (migration 048). Events are written
// best-effort by the routes and stores that cause them — a failed insert never
// costs anyone a save — for EVERY project (the G5 "authored plans only" guard is
// gone: an interior firm project that recorded nothing could not be measured).
//
// What a row carries beyond kind + detail (048): the firm (the project's, or
// the firm itself for a rate-book event), the ACTOR (the signed-in account;
// null = a script or our own run — the distinction the pilot turns on), the
// session record, a measured duration, and the stage as a column. Before 048
// the writer falls back to the old shape for the old kinds and drops the rest —
// it never throws.
//
// The per-project metrics (`computePilotMetrics`) are the G5 definitions,
// unchanged; the per-firm rollups live in lib/pilot/metrics.ts.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type PilotEventKind =
  | "plan_started"
  | "plan_saved"
  | "design_edit"
  | "boq_generated"
  | "pack_exported"
  | "friction"
  | "session_decision"
  | "correction"
  // L5 (048)
  | "boq_viewed"
  | "support_touch"
  | "rate_book_change"
  | "approval_recorded"
  | "basis_accepted";

/** The kinds the pre-048 CHECK accepts — what the fallback may still write. */
const LEGACY_KINDS: ReadonlySet<string> = new Set(["plan_started", "plan_saved", "design_edit", "boq_generated", "pack_exported", "friction", "session_decision", "correction"]);

/** Stages that are not the pilot: our verification runs and reference packs. */
export const NON_PILOT_STAGES: ReadonlySet<string> = new Set(["verification", "reference_pack"]);
/** Stages where a script drew or edited on the firm's behalf — not the firm's own time. */
export const SCRIPTED_STAGES: ReadonlySet<string> = new Set(["reference_layout", "design_seed", "geometry_fix", "session_apply"]);

export interface PilotEvent {
  kind: PilotEventKind;
  recorded_at: string;
  detail: Record<string, unknown> | null;
}

export interface PilotEventOptions {
  /** The signed-in account that caused it; null = a script / our run. */
  actor?: string | null;
  /** The firm; defaults to the project's firm when a project is given. */
  firmId?: string | null;
  sessionRef?: string | null;
  durationMs?: number | null;
  /** The stage column; defaults to detail.stage. */
  stage?: string | null;
}

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || error.code === "23514" || error.code === "23502" || /does not exist|could not find|violates check constraint|null value in column/i.test(error.message ?? "");
}

/**
 * Record an event. `projectId` may be null for a firm-level event (a rate-book
 * change) when `opts.firmId` is given. Never throws.
 */
export async function recordPilotEvent(
  supabase: SupabaseClient,
  projectId: string | null,
  kind: PilotEventKind,
  detail: Record<string, unknown> = {},
  opts: PilotEventOptions = {},
): Promise<void> {
  try {
    let firmId = opts.firmId ?? null;
    if (!firmId && projectId) {
      const { data } = await supabase.from("projects").select("firm_id").eq("id", projectId).maybeSingle<{ firm_id: string | null }>();
      firmId = data?.firm_id ?? null;
    }
    if (!projectId && !firmId) return;
    const stage = opts.stage ?? (typeof detail.stage === "string" ? detail.stage : null);
    const row = {
      project_id: projectId,
      kind,
      detail: stage && detail.stage === undefined ? { ...detail, stage } : detail,
      firm_id: firmId,
      actor: opts.actor ?? null,
      session_ref: opts.sessionRef ?? null,
      duration_ms: opts.durationMs == null ? null : Math.max(0, Math.round(opts.durationMs)),
      stage,
    };
    const { error } = await supabase.from("pilot_events").insert(row);
    if (error && isMissingSchema(error) && projectId && LEGACY_KINDS.has(kind)) {
      // Pre-048 table: the old shape, the old kinds only.
      await supabase.from("pilot_events").insert({ project_id: projectId, kind, detail: row.detail });
    }
  } catch {
    /* instrumentation is never allowed to break the thing it measures */
  }
}

/** Resolve a plan id to its project, for routes that only know the plan. */
export async function projectOfPlan(supabase: SupabaseClient, planId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from("plans").select("project_id").eq("id", planId).maybeSingle<{ project_id: string }>();
    return data?.project_id ?? null;
  } catch {
    return null;
  }
}

export interface GateRowLike {
  view: string | null;
  gate: { outcome?: string; attempts?: { passed?: boolean }[] } | null;
}

export interface CorrectionLike {
  correction_type: string;
}

export interface PilotMetrics {
  /**
   * The designer drawing: first design-session edit → last edit before the first
   * full BoQ (or the latest edit). Edits tagged stage "reference_layout" — the
   * scripted Step 1 — are not the designer and do not count.
   */
  time_to_draw_plan_min: number | null;
  /** Minutes actually spent editing: gaps of up to 30 min between edits, summed. */
  active_design_min: number | null;
  /** Plan started → first BoQ with nothing left untyped or undecided. */
  time_to_first_full_boq_min: number | null;
  first_full_boq_at: string | null;
  boq_generations: number;
  render_gate: {
    renders: number;
    passed: number;
    substituted: number;
    pass_rate: number | null;
    /** Attempts that passed / attempts made — the model's first-try reliability. */
    attempt_pass_rate: number | null;
  };
  friction: { at: string; note: string; area: string | null }[];
  corrections: { total: number; by_type: Record<"rate" | "quantity" | "scope" | "design" | "confirm", number> };
  /**
   * G5d: real design-session data — the decisions applied and the corrections
   * captured at a working session with a firm, per instrumentation record
   * ("three-firms #1"). Script-applied geometry is not counted as designer time.
   */
  sessions: { record: string; decisions: number; corrections: Record<string, number> }[];
}

const minutes = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 60000) * 10) / 10;

export function computePilotMetrics(
  events: readonly PilotEvent[],
  renders: readonly GateRowLike[],
  corrections: readonly CorrectionLike[],
): PilotMetrics {
  // Events a verification script caused (stage "verification") or a reference pack
  // exported for another project to show (stage "reference_pack") are not the pilot.
  const sorted = [...events].filter((e) => !NON_PILOT_STAGES.has(String(e.detail?.stage ?? ""))).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const started = sorted.find((e) => e.kind === "plan_started") ?? sorted.find((e) => e.kind === "plan_saved" || e.kind === "design_edit");
  const boqs = sorted.filter((e) => e.kind === "boq_generated");
  const full = boqs.find((e) => e.detail?.full === true) ?? null;
  // Script-seeded edits (Step 1 layout, a seeded design proposal) are not the designer drawing.
  const edits = sorted.filter((e) => (e.kind === "plan_saved" || e.kind === "design_edit") && !SCRIPTED_STAGES.has(String(e.detail?.stage ?? "")));
  const lastEditBeforeFull = full ? [...edits].reverse().find((e) => e.recorded_at <= full.recorded_at) : edits[edits.length - 1];
  const session = lastEditBeforeFull ? edits.filter((e) => e.recorded_at <= lastEditBeforeFull.recorded_at) : [];
  let active = 0;
  for (let i = 1; i < session.length; i++) {
    const gap = minutes(session[i - 1]!.recorded_at, session[i]!.recorded_at);
    if (gap <= 30) active += gap;
  }

  const gated = renders.filter((r) => r.gate?.outcome === "passed" || r.gate?.outcome === "substituted");
  const passed = gated.filter((r) => r.gate!.outcome === "passed").length;
  const attempts = gated.flatMap((r) => r.gate!.attempts ?? []);
  const byType = { rate: 0, quantity: 0, scope: 0, design: 0, confirm: 0 };
  for (const c of corrections) if (c.correction_type in byType) byType[c.correction_type as keyof typeof byType]++;
  const records = new Map<string, { record: string; decisions: number; corrections: Record<string, number> }>();
  for (const e of sorted.filter((x) => (x.kind === "session_decision" || x.kind === "correction") && typeof x.detail?.record === "string")) {
    const key = String(e.detail!.record);
    const r = records.get(key) ?? { record: key, decisions: 0, corrections: {} };
    if (e.kind === "session_decision") r.decisions++;
    else {
      const t = String(e.detail?.correction_type ?? "unknown");
      r.corrections[t] = (r.corrections[t] ?? 0) + 1;
    }
    records.set(key, r);
  }

  return {
    time_to_draw_plan_min: session.length ? minutes(session[0]!.recorded_at, lastEditBeforeFull!.recorded_at) : null,
    active_design_min: session.length ? Math.round(active * 10) / 10 : null,
    time_to_first_full_boq_min: started && full ? minutes(started.recorded_at, full.recorded_at) : null,
    first_full_boq_at: full?.recorded_at ?? null,
    boq_generations: boqs.length,
    render_gate: {
      renders: gated.length,
      passed,
      substituted: gated.length - passed,
      pass_rate: gated.length ? Math.round((passed / gated.length) * 1000) / 1000 : null,
      attempt_pass_rate: attempts.length ? Math.round((attempts.filter((a) => a.passed).length / attempts.length) * 1000) / 1000 : null,
    },
    friction: sorted
      .filter((e) => e.kind === "friction")
      .map((e) => ({ at: e.recorded_at, note: String(e.detail?.note ?? ""), area: typeof e.detail?.area === "string" ? e.detail.area : null })),
    corrections: { total: corrections.length, by_type: byType },
    sessions: [...records.values()],
  };
}
