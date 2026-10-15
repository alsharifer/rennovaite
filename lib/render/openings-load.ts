// =============================================================================
// lib/render/openings-load.ts — a room's openings for an off-plan render (R10b).
// SERVER-ONLY. Unconfirmed finds are INCLUDED (renders use them at once,
// labelled); pricing never reads this.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DetectionMeta, OpeningsBasis } from "@/lib/plan/openings-vocab";
import { checkPlan, metresPerUnit } from "@/lib/plan/plan-rules";

import { openingsBasis, openingsPhrase, roomOpeningsFor, type RoomOpening } from "./openings-prompt";

/** Best-effort: a database before 059, or a room without a plan, gives no openings. */
export async function loadRoomOpenings(db: SupabaseClient, roomId: string): Promise<{ phrase: string | null; basis: OpeningsBasis | null; openings: RoomOpening[] }> {
  const none = { phrase: null, basis: null, openings: [] };
  try {
    const { data: room } = await db.from("rooms").select("id, plan_id").eq("id", roomId).maybeSingle<{ id: string; plan_id: string }>();
    if (!room?.plan_id) return none;
    const [ops, rooms, plan] = await Promise.all([
      db.from("plan_openings").select("id, kind, room_id, source, confirmed_at, detection, position, width_mm, context_id").eq("plan_id", room.plan_id),
      db.from("rooms").select("id, name_en, polygon, room_type, unroofed, area_m2").eq("plan_id", room.plan_id),
      db.from("plans").select("total_area_m2, source, plot_width_m").eq("id", room.plan_id).maybeSingle<{ total_area_m2: number | null; source: string | null; plot_width_m: number | null }>(),
    ]);
    if (ops.error) return none;
    type Row = { id: string; kind: string; room_id: string | null; source: string | null; confirmed_at: string | null; detection: DetectionMeta | null; position: unknown; width_mm: number | null; context_id: string | null };
    const roomRows = (rooms.data ?? []) as { id: string; name_en: string | null; polygon: unknown; room_type: string | null; unroofed: boolean | null; area_m2: number | null }[];
    const names = new Map(roomRows.map((r) => [r.id, r.name_en]));
    // 15 Oct: an opening is on the wall it sits on — out of the render when it
    // "Needs a wall", and in BOTH rooms it joins, whichever one it was drawn from.
    const mPerU = metresPerUnit(roomRows, plan.data?.total_area_m2 ?? null, plan.data?.source === "user_drawn" ? plan.data?.plot_width_m : null);
    const rows = ((ops.data ?? []) as Row[]).filter((o) => o.kind !== "gate");
    const checked = mPerU ? checkPlan({ rooms: roomRows, openings: rows, mPerU }) : null;
    const placed = rows
      .filter((o) => !checked?.needsWall.has(o.id))
      .map((o) => {
        const sides = checked?.placements.get(o.id)?.sides.filter((x): x is string => !!x) ?? [];
        if (sides.length === 0) return o;
        const own = o.room_id && sides.includes(o.room_id) ? o.room_id : sides[0]!;
        const other = sides.find((x) => x !== own) ?? o.detection?.opens_to_room_id ?? null;
        return { ...o, room_id: own, detection: { ...(o.detection ?? {}), opens_to_room_id: other } as DetectionMeta };
      });
    const list = roomOpeningsFor(placed, roomId);
    return { phrase: openingsPhrase(list, roomId, (id) => names.get(id) ?? null), basis: openingsBasis(list), openings: list };
  } catch {
    return none;
  }
}
