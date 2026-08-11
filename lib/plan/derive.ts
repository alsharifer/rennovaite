// =============================================================================
// lib/plan/derive.ts — server-only DB adapter for the geometry contract.
//
// Fetches the latest confirmed plan for a project and hands the raw persisted
// rooms to the pure `buildPlanGraph` (lib/plan/geometry.ts). Kept separate so
// geometry.ts has zero DB/runtime deps and stays unit-testable.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { buildPlanGraph, type PlanGraph, type RawOpening, type RawRoom } from "./geometry";

/** Read persisted openings for a plan (migration 026). `[]` if the table is
 *  absent, so derivePlanGraph works before 026 is applied. */
async function loadOpenings(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  planId: string,
): Promise<RawOpening[]> {
  try {
    const sb = supabase as unknown as SupabaseClient;
    const { data, error } = await sb
      .from("plan_openings")
      .select("id, wall_ref, room_id, kind, width_mm, height_mm, sill_mm, position, along_offset, source, derived")
      .eq("plan_id", planId)
      .returns<
        {
          id: string; wall_ref: string | null; room_id: string | null; kind: string;
          width_mm: number | null; height_mm: number | null; sill_mm: number | null;
          position: unknown; along_offset: number | null; source: string | null; derived: boolean | null;
        }[]
      >();
    if (error) return [];
    return (data ?? []).map((o) => ({
      id: o.id,
      wall_ref: o.wall_ref,
      room_id: o.room_id,
      type: o.kind,
      width_mm: o.width_mm,
      height_mm: o.height_mm,
      sill_mm: o.sill_mm,
      position: o.position,
      along_offset: o.along_offset,
      source: o.source,
      derived: o.derived,
    }));
  } catch {
    return [];
  }
}

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
  const openings = await loadOpenings(supabase, plan.id);

  return buildPlanGraph({
    projectId,
    planId: plan.id,
    scale: parsed?.scale ?? null,
    total_area_m2: plan.total_area_m2,
    rooms: (rooms ?? []) as RawRoom[],
    openings,
  });
}
