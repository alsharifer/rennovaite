// lib/render/photo-views-load.ts — what the renders studio needs to show a room's
// photo views and place them on the plan (B2). Server-only reads; best-effort
// (a database before 062 lists the photos without cameras).

import type { SupabaseClient } from "@supabase/supabase-js";
import { withoutReplaced } from "@/lib/overlays/replaces";

import { metresPerUnit } from "@/lib/plan/plan-rules";

import { photoViewsOf, type PhotoView, type RoomPhotoRow } from "./photo-views";

/** One room as the photo positioner draws it: its outline, openings and fixtures. */
export interface MiniPlan {
  room_id: string;
  polygon: [number, number][];
  /** Metres per plan unit — so a fixture's footprint draws at its size. */
  m_per_u: number | null;
  openings: { id: string; kind: string; position: [number, number]; width_mm: number }[];
  fixtures: { id: string; type: string; position: [number, number]; spec: Record<string, unknown> | null }[];
}

const asPt = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1])) ? [Number(v[0]), Number(v[1])] : null);

export async function loadPhotoViews(db: SupabaseClient, roomIds: readonly string[]): Promise<Record<string, PhotoView[]>> {
  const out: Record<string, PhotoView[]> = {};
  if (roomIds.length === 0) return out;
  let res = await db.from("room_photos").select("id, room_id, public_url, storage_path, created_at, camera_position, camera_heading_deg").in("room_id", [...roomIds]).returns<RoomPhotoRow[]>();
  if (res.error) res = await db.from("room_photos").select("id, room_id, public_url, storage_path, created_at").in("room_id", [...roomIds]).returns<RoomPhotoRow[]>();
  const rows = (res.data ?? []) as RoomPhotoRow[];
  for (const id of roomIds) out[id] = photoViewsOf(rows, id);
  return out;
}

export async function loadMiniPlans(db: SupabaseClient, projectId: string, plan: { id: string; total_area_m2: number | null; source?: string | null; plot_width_m?: number | null }, roomIds: readonly string[]): Promise<Record<string, MiniPlan>> {
  const out: Record<string, MiniPlan> = {};
  if (roomIds.length === 0) return out;
  const [roomsRes, openRes, fixRes] = await Promise.all([
    db.from("rooms").select("id, polygon, area_m2").eq("plan_id", plan.id),
    db.from("plan_openings").select("id, kind, position, width_mm, room_id").eq("plan_id", plan.id),
    db.from("plan_fixtures").select("id, type, position, spec, room_id, layer").eq("project_id", projectId).eq("layer", "plumbing"),
  ]);
  const rooms = (roomsRes.data ?? []) as { id: string; polygon: unknown; area_m2: number | null }[];
  const mPerU = metresPerUnit(rooms, plan.total_area_m2, plan.source === "user_drawn" ? plan.plot_width_m ?? null : null);
  for (const r of rooms) {
    if (!roomIds.includes(r.id) || !Array.isArray(r.polygon)) continue;
    out[r.id] = {
      room_id: r.id,
      polygon: (r.polygon as unknown[]).map(asPt).filter((p): p is [number, number] => !!p),
      m_per_u: mPerU,
      openings: ((openRes.data ?? []) as { id: string; kind: string; position: unknown; width_mm: number | null; room_id: string | null }[])
        .filter((o) => o.room_id === r.id && asPt(o.position))
        .map((o) => ({ id: o.id, kind: o.kind, position: asPt(o.position)!, width_mm: Number(o.width_mm ?? 0) })),
      // B7: a fixture another one replaces is not rendered — its replacement is.
      fixtures: withoutReplaced((fixRes.data ?? []) as { id: string; type: string; position: unknown; spec: Record<string, unknown> | null; room_id: string | null }[])
        .filter((f) => f.room_id === r.id && asPt(f.position))
        .map((f) => ({ id: f.id, type: f.type, position: asPt(f.position)!, spec: f.spec })),
    };
  }
  return out;
}
