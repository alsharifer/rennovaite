// =============================================================================
// lib/staging/collect.ts — assemble the optional furniture section (P7).
//
// Read-time only. Gathers the rooms a homeowner opted into, prices each room's
// staging set (preferring the set that actually dressed its render), and returns
// ONE "Furniture (optional)" section for the BoQ view. Never writes to
// boqs.sections — so it is invisible to every contractor export. Flag-gated +
// best-effort: any missing table returns null and the BoQ renders unchanged.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadFurniturePrices } from "./prices";
import { getStagingSet, stagingRoomTypeFromDb, type StagingSet } from "./sets";
import {
  buildFurnitureSection,
  type FurnitureSection,
  type OptedRoom,
} from "./furniture-boq";

export async function collectFurnitureSection(
  projectId: string,
  supabase: SupabaseClient,
): Promise<FurnitureSection | null> {
  if (process.env.STAGING_ENABLED !== "true") return null;

  // 1. Which rooms opted in?
  let optedRoomIds: string[] = [];
  try {
    const { data, error } = await supabase
      .from("furniture_opt_ins")
      .select("room_id")
      .eq("project_id", projectId);
    if (error || !data) return null; // table absent → no furniture section
    optedRoomIds = (data as { room_id: string }[]).map((r) => r.room_id);
  } catch {
    return null;
  }
  if (optedRoomIds.length === 0) return null;

  // 2. Project-level style choice → the tier + fallback set.
  const { data: styleRows } = await supabase
    .from("style_choices")
    .select("style_key")
    .eq("project_id", projectId)
    .is("room_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const styleKey = (styleRows?.[0] as { style_key?: string } | undefined)?.style_key;
  if (!styleKey) return null;

  // 3. Room names + types for the opted rooms.
  const { data: roomRows } = await supabase
    .from("rooms")
    .select("id, name_en, room_type")
    .in("id", optedRoomIds);
  const rooms = (roomRows ?? []) as {
    id: string;
    name_en: string | null;
    room_type: string | null;
  }[];

  // 4. The set that actually dressed each room's latest render (staging_set),
  //    falling back to the deterministic set for the style + room type.
  const { data: renderRows } = await supabase
    .from("renders")
    .select("room_id, staging_set, created_at")
    .eq("project_id", projectId)
    .in("room_id", optedRoomIds)
    .order("created_at", { ascending: false });
  const stagingByRoom = new Map<string, StagingSet>();
  for (const r of (renderRows ?? []) as {
    room_id: string | null;
    staging_set: unknown;
  }[]) {
    if (r.room_id && !stagingByRoom.has(r.room_id) && Array.isArray(r.staging_set)) {
      stagingByRoom.set(r.room_id, r.staging_set as StagingSet);
    }
  }

  const opted: OptedRoom[] = [];
  for (const room of rooms) {
    let set = stagingByRoom.get(room.id) ?? null;
    if (!set) {
      const rt = stagingRoomTypeFromDb(room.room_type);
      set = rt ? getStagingSet(styleKey, rt) : null;
    }
    if (!set || set.length === 0) continue;
    opted.push({
      roomId: room.id,
      roomName: room.name_en?.trim() || "Room",
      styleKey,
      set,
    });
  }
  if (opted.length === 0) return null;

  const book = await loadFurniturePrices(supabase);
  return buildFurnitureSection(opted, book);
}
