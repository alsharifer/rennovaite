// =============================================================================
// lib/plan/derive.ts — server-only DB adapter for the geometry contract.
//
// Fetches the latest confirmed plan for a project and hands the raw persisted
// rooms to the pure `buildPlanGraph` (lib/plan/geometry.ts). Kept separate so
// geometry.ts has zero DB/runtime deps and stays unit-testable.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import type { RawLinearElement } from "./elements";
import { buildPlanGraph, type PlanGraph, type PlanSource, type RawContext, type RawOpening, type RawRoom } from "./geometry";

/** Read persisted openings for a plan (migration 026). `[]` if the table is
 *  absent, so derivePlanGraph works before 026 is applied. */
async function loadOpenings(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  planId: string,
): Promise<RawOpening[]> {
  try {
    const sb = supabase as unknown as SupabaseClient;
    const COLS = "id, wall_ref, room_id, kind, width_mm, height_mm, sill_mm, position, along_offset, source, derived";
    // G5c (039): a garden gate names its context wall and carries the site-reference fields.
    const COLS_039 = `${COLS}, context_id, spec, site_reference, disposition, dims_derived, derived_note`;
    const withGates = await sb.from("plan_openings").select(COLS_039).eq("plan_id", planId);
    if (!withGates.error) {
      return ((withGates.data ?? []) as unknown as (Record<string, unknown> & { kind: string })[]).map((o) => ({
        id: o.id as string,
        wall_ref: (o.wall_ref as string | null) ?? null,
        room_id: (o.room_id as string | null) ?? null,
        type: o.kind,
        width_mm: (o.width_mm as number | null) ?? null,
        height_mm: (o.height_mm as number | null) ?? null,
        sill_mm: (o.sill_mm as number | null) ?? null,
        position: o.position,
        along_offset: (o.along_offset as number | null) ?? null,
        source: (o.source as string | null) ?? null,
        derived: (o.derived as boolean | null) ?? null,
        context_id: (o.context_id as string | null) ?? null,
        spec: (o.spec as Record<string, unknown> | null) ?? null,
        site_reference: (o.site_reference as boolean | null) ?? null,
        disposition: (o.disposition as string | null) ?? null,
        dims_derived: (o.dims_derived as boolean | null) ?? null,
        derived_note: (o.derived_note as string | null) ?? null,
      }));
    }
    const { data, error } = await sb
      .from("plan_openings")
      .select(COLS)
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

/** Read persisted linear elements (migration 031). `[]` if the table is absent,
 *  so derivePlanGraph works before 031 is applied. */
async function loadElements(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  planId: string,
): Promise<RawLinearElement[]> {
  try {
    const sb = supabase as unknown as SupabaseClient;
    // 036 adds spec, 037 site reference + derived dims; an older database still
    // derives a graph without them.
    for (const cols of [
      "id, room_id, kind, polyline, height_mm, width_mm, source, derived, spec, dims_derived, derived_note, site_reference, disposition",
      "id, room_id, kind, polyline, height_mm, width_mm, source, derived, spec",
      "id, room_id, kind, polyline, height_mm, width_mm, source, derived",
    ]) {
      const { data, error } = await sb
        .from("plan_elements")
        .select(cols)
        .eq("plan_id", planId)
        .order("created_at")
        .returns<RawLinearElement[]>();
      if (!error) return data ?? [];
    }
    return [];
  } catch {
    return [];
  }
}

/** G4b: existing context volumes (migration 036). `[]` before it is applied. */
async function loadContext(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  planId: string,
): Promise<RawContext[]> {
  try {
    const sb = supabase as unknown as SupabaseClient;
    for (const cols of [
      "id, kind, name, polygon, base_mm, height_mm, derived, note, dims_derived, site_reference, disposition, spec",
      "id, kind, name, polygon, base_mm, height_mm, derived, note, dims_derived, site_reference, disposition",
      "id, kind, name, polygon, base_mm, height_mm, derived, note",
    ]) {
      const { data, error } = await sb
        .from("plan_context")
        .select(cols)
        .eq("plan_id", planId)
        .order("created_at")
        .returns<RawContext[]>();
      if (!error) return data ?? [];
    }
    return [];
  } catch {
    return [];
  }
}

type ParsedJson = { scale?: string | null; units?: string | null } | null;

/** Columns added by migration 031. Selected separately so a pre-031 database
 *  still derives a graph (the whole plan step would 500 otherwise). */
interface AuthoredColumns {
  source: PlanSource | null;
  plot_width_m: number | null;
  plot_depth_m?: number | null;
  /** 037 */
  dims_derived?: boolean | null;
  dims_note?: string | null;
}

async function loadAuthoredColumns(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  planId: string,
): Promise<AuthoredColumns> {
  try {
    const sb = supabase as unknown as SupabaseClient;
    for (const cols of ["source, plot_width_m, plot_depth_m, dims_derived, dims_note", "source, plot_width_m, plot_depth_m"]) {
      const { data, error } = await sb.from("plans").select(cols).eq("id", planId).maybeSingle<AuthoredColumns>();
      if (!error) return data ?? { source: null, plot_width_m: null };
    }
    return { source: null, plot_width_m: null };
  } catch {
    return { source: null, plot_width_m: null };
  }
}

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

  // Later columns are selected best-effort, newest first, for the same reason
  // as the plan columns above: an older database must still derive a graph.
  // 037 adds dims_derived/site_reference/disposition, 036 level_mm/height_mm/spec,
  // 035 area_derived_m2/derived_note, 031 unroofed.
  const sb = supabase as unknown as SupabaseClient;
  const ROOM_SELECTS = [
    "id, name_en, name_ar, room_type, area_m2, polygon, unroofed, area_derived_m2, derived_note, level_mm, height_mm, spec, dims_derived, site_reference, disposition",
    "id, name_en, name_ar, room_type, area_m2, polygon, unroofed, area_derived_m2, derived_note, level_mm, height_mm, spec",
    "id, name_en, name_ar, room_type, area_m2, polygon, unroofed, area_derived_m2, derived_note",
    "id, name_en, name_ar, room_type, area_m2, polygon, unroofed",
    "id, name_en, name_ar, room_type, area_m2, polygon",
  ];
  let roomsRes = await sb.from("rooms").select(ROOM_SELECTS[0]!).eq("plan_id", plan.id).order("name_en");
  for (const cols of ROOM_SELECTS.slice(1)) {
    if (!roomsRes.error) break;
    roomsRes = await sb.from("rooms").select(cols).eq("plan_id", plan.id).order("name_en");
  }
  if (roomsRes.error) {
    throw new Error(`derivePlanGraph: rooms load failed — ${roomsRes.error.message}`);
  }

  const parsed = plan.parsed_json as ParsedJson;
  const openings = await loadOpenings(supabase, plan.id);
  const elements = await loadElements(supabase, plan.id);
  const context = await loadContext(supabase, plan.id);
  const authored = await loadAuthoredColumns(supabase, plan.id);

  return buildPlanGraph({
    projectId,
    planId: plan.id,
    scale: parsed?.scale ?? null,
    total_area_m2: plan.total_area_m2,
    rooms: (roomsRes.data ?? []) as unknown as RawRoom[],
    openings,
    elements,
    context,
    // Only an authored plan carries a measured scale; a parsed one keeps the
    // area-derived factor it has always used.
    unit_to_m: authored.source === "user_drawn" ? authored.plot_width_m : null,
    plot:
      authored.source === "user_drawn" && authored.plot_width_m && authored.plot_depth_m
        ? { width_m: Number(authored.plot_width_m), depth_m: Number(authored.plot_depth_m) }
        : null,
    plot_dims_derived: authored.dims_derived === true,
    dims_note: authored.dims_note ?? null,
    source: authored.source,
  });
}
