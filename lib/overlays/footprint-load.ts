// lib/overlays/footprint-load.ts — what a footprint snap needs from the stored
// plan (B1): the walls the take-off derives (the same `deriveWallSegments` the
// openings editor and buildPlanGraph use) and the plan's metres per unit.
// Server-only reads; the snap itself is pure (footprint.ts).

import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveWallSegments } from "@/lib/plan/geometry";
import { metresPerUnit } from "@/lib/plan/plan-rules";

import type { SnapWall } from "./footprint";

export interface SnapContext {
  walls: SnapWall[];
  mPerU: number;
}

/** The project's latest plan as a snap context, or null when it has no rooms or no scale. */
export async function loadSnapContext(db: SupabaseClient, projectId: string): Promise<SnapContext | null> {
  const { data: plan } = await db
    .from("plans")
    .select("id, total_area_m2, source, plot_width_m")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; total_area_m2: number | null; source?: string | null; plot_width_m?: number | null }>();
  if (!plan) return null;
  const { data: rooms } = await db
    .from("rooms")
    .select("id, polygon, room_type, unroofed, area_m2")
    .eq("plan_id", plan.id)
    .returns<{ id: string; polygon: unknown; room_type: string | null; unroofed: boolean | null; area_m2: number | null }[]>();
  if (!rooms || rooms.length === 0) return null;
  const mPerU = metresPerUnit(rooms, plan.total_area_m2, plan.source === "user_drawn" ? plan.plot_width_m ?? null : null);
  if (!mPerU) return null;
  return { walls: deriveWallSegments(rooms), mPerU };
}
