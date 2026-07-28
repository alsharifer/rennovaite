// =============================================================================
// lib/plan/derive.ts — server-only DB adapter for the geometry contract.
//
// Fetches the latest confirmed plan for a project and hands the raw persisted
// rooms to the pure `buildPlanGraph` (lib/plan/geometry.ts). Kept separate so
// geometry.ts has zero DB/runtime deps and stays unit-testable.
// =============================================================================

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { buildPlanGraph, type PlanGraph, type RawRoom } from "./geometry";

type ParsedJson = { scale?: string | null; units?: string | null } | null;

/**
 * Derive the metric PlanGraph for a project from whatever we persist today
 * (rooms.polygon + plans.parsed_json.scale). Reads only — never writes.
 */
export async function derivePlanGraph(projectId: string): Promise<PlanGraph> {
  const supabase = getSupabaseAdmin();

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("id, total_area_m2, parsed_json")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planErr) throw new Error(`derivePlanGraph: plan load failed — ${planErr.message}`);
  if (!plan) {
    return buildPlanGraph({
      projectId,
      planId: null,
      scale: null,
      total_area_m2: null,
      rooms: [],
    });
  }

  const { data: rooms, error: roomsErr } = await supabase
    .from("rooms")
    .select("id, name_en, name_ar, room_type, area_m2, polygon")
    .eq("plan_id", plan.id)
    .order("name_en");
  if (roomsErr) throw new Error(`derivePlanGraph: rooms load failed — ${roomsErr.message}`);

  const parsed = plan.parsed_json as ParsedJson;

  return buildPlanGraph({
    projectId,
    planId: plan.id,
    scale: parsed?.scale ?? null,
    total_area_m2: plan.total_area_m2,
    rooms: (rooms ?? []) as RawRoom[],
  });
}
