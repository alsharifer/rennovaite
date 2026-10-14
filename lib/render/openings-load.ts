// =============================================================================
// lib/render/openings-load.ts — a room's openings for an off-plan render (R10b).
// SERVER-ONLY. Unconfirmed finds are INCLUDED (renders use them at once,
// labelled); pricing never reads this.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DetectionMeta, OpeningsBasis } from "@/lib/plan/openings-vocab";

import { openingsBasis, openingsPhrase, roomOpeningsFor, type RoomOpening } from "./openings-prompt";

/** Best-effort: a database before 059, or a room without a plan, gives no openings. */
export async function loadRoomOpenings(db: SupabaseClient, roomId: string): Promise<{ phrase: string | null; basis: OpeningsBasis | null; openings: RoomOpening[] }> {
  const none = { phrase: null, basis: null, openings: [] };
  try {
    const { data: room } = await db.from("rooms").select("id, plan_id").eq("id", roomId).maybeSingle<{ id: string; plan_id: string }>();
    if (!room?.plan_id) return none;
    const [ops, rooms] = await Promise.all([
      db.from("plan_openings").select("id, kind, room_id, source, confirmed_at, detection").eq("plan_id", room.plan_id),
      db.from("rooms").select("id, name_en").eq("plan_id", room.plan_id),
    ]);
    if (ops.error) return none;
    const names = new Map(((rooms.data ?? []) as { id: string; name_en: string | null }[]).map((r) => [r.id, r.name_en]));
    const list = roomOpeningsFor(
      ((ops.data ?? []) as { id: string; kind: string; room_id: string | null; source: string | null; confirmed_at: string | null; detection: DetectionMeta | null }[]).filter((o) => o.kind !== "gate"),
      roomId,
    );
    return { phrase: openingsPhrase(list, roomId, (id) => names.get(id) ?? null), basis: openingsBasis(list), openings: list };
  } catch {
    return none;
  }
}
