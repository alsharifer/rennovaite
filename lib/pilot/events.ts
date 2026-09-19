// =============================================================================
// lib/pilot/events.ts — the garden pilot's instrumentation (G5, migration 037).
//
// The pilot is measured, not remembered: time to draw a plan, time to the first
// FULL BoQ, how often a render passes the faithfulness gate, and every point of
// friction a designer hits. Events are written best-effort by the routes that
// cause them — a missing table or a failed insert never costs anyone a save — and
// only for AUTHORED plans, so an interior project's rows are never touched.
//
// The metrics themselves are computed from the events by a pure function, so the
// definitions ("first FULL BoQ" = no counter left untyped and no site-reference
// item left undecided) are reviewable and tested rather than implied by a query.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type PilotEventKind = "plan_started" | "plan_saved" | "design_edit" | "boq_generated" | "pack_exported" | "friction";

export interface PilotEvent {
  kind: PilotEventKind;
  recorded_at: string;
  detail: Record<string, unknown> | null;
}

/** Record an event for an authored (garden pilot) plan. Never throws. */
export async function recordPilotEvent(
  supabase: SupabaseClient,
  projectId: string,
  kind: PilotEventKind,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { data: plan } = await supabase
      .from("plans")
      .select("source")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ source: string | null }>();
    if (plan?.source !== "user_drawn") return;
    await supabase.from("pilot_events").insert({ project_id: projectId, kind, detail });
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
  corrections: { total: number; by_type: Record<"rate" | "quantity" | "scope" | "design", number> };
}

const minutes = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 60000) * 10) / 10;

export function computePilotMetrics(
  events: readonly PilotEvent[],
  renders: readonly GateRowLike[],
  corrections: readonly CorrectionLike[],
): PilotMetrics {
  // Events a verification script caused (stage "verification") or a reference pack
  // exported for another project to show (stage "reference_pack") are not the pilot.
  const sorted = [...events].filter((e) => e.detail?.stage !== "verification" && e.detail?.stage !== "reference_pack").sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const started = sorted.find((e) => e.kind === "plan_started") ?? sorted.find((e) => e.kind === "plan_saved" || e.kind === "design_edit");
  const boqs = sorted.filter((e) => e.kind === "boq_generated");
  const full = boqs.find((e) => e.detail?.full === true) ?? null;
  // Script-seeded edits (Step 1 layout, a seeded design proposal) are not the designer drawing.
  const edits = sorted.filter((e) => (e.kind === "plan_saved" || e.kind === "design_edit") && e.detail?.stage !== "reference_layout" && e.detail?.stage !== "design_seed" && e.detail?.stage !== "geometry_fix");
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
  const byType = { rate: 0, quantity: 0, scope: 0, design: 0 };
  for (const c of corrections) if (c.correction_type in byType) byType[c.correction_type as keyof typeof byType]++;

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
  };
}
