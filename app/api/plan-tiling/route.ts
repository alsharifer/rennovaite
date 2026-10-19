import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { recordPilotEvent } from "@/lib/pilot/events";
import { isTiledRoomType, TILING_BOUNDS_M } from "@/lib/plan/tiling";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// B5 (migration 065) — PATCH /api/plan-tiling { plan_id, rooms: [{ id, tiled_height_m }] }.
// A wet room's tiled height on 01 Plan. A number stores it (a dado below the
// ceiling); null goes back to full height. Wet rooms of THAT PLAN only. Recorded
// as a `design_edit` on layer "tiling" with each room's from → to, so the revision
// diff names it on the tiling and paint lines and Regenerate reads "Tiled height
// changed since rev N". The cost follows on the next regenerate. Any project member.
const Body = z.object({
  plan_id: z.string().uuid(),
  rooms: z
    .array(z.object({ id: z.string().uuid(), tiled_height_m: z.number().min(TILING_BOUNDS_M[0]).max(TILING_BOUNDS_M[1]).nullable() }))
    .min(1)
    .max(500),
});

const to2dp = (n: number) => Math.round(n * 100) / 100;

export async function PATCH(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: `Body must be { plan_id, rooms: [{ id, tiled_height_m }] } with heights ${TILING_BOUNDS_M[0]}–${TILING_BOUNDS_M[1]} m.`, code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const { plan_id, rooms } = body.data;
  const access = await projectAccess(db, caller, { plan_id });
  if (access.denied) return access.denied;

  const ids = rooms.map((r) => r.id);
  const { data: current, error } = await db.from("rooms").select("id, name_en, room_type, tiled_height_m").eq("plan_id", plan_id).in("id", ids);
  if (error) {
    const missing = /tiled_height|schema cache|does not exist/i.test(error.message);
    return NextResponse.json({ success: false, error: missing ? "Tiled heights need migration 065 — apply it with npm run db:push." : error.message, code: missing ? "migration_required" : "read_failed" }, { status: 500 });
  }
  const now = new Map(((current ?? []) as { id: string; name_en: string | null; room_type: string | null; tiled_height_m: number | null }[]).map((r) => [r.id, r]));
  if (now.size !== new Set(ids).size) return NextResponse.json({ success: false, error: "A room is not on this plan.", code: "room_not_found" }, { status: 404 });
  if ([...now.values()].some((r) => !isTiledRoomType(r.room_type))) return NextResponse.json({ success: false, error: "Only a wet room (bathroom, ensuite, powder room, kitchen) has a tiled height.", code: "not_a_wet_room" }, { status: 422 });

  const moved: { id: string; name: string | null; from: number | null; to: number | null }[] = [];
  for (const r of rooms) {
    const before = now.get(r.id)!;
    const from = before.tiled_height_m == null ? null : Number(before.tiled_height_m);
    const to = r.tiled_height_m == null ? null : to2dp(r.tiled_height_m);
    if (from === to) continue;
    const { error: upErr } = await db.from("rooms").update({ tiled_height_m: to }).eq("plan_id", plan_id).eq("id", r.id);
    if (upErr) return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });
    moved.push({ id: r.id, name: before.name_en, from, to });
  }
  if (moved.length) await recordPilotEvent(db, access.projectId!, "design_edit", { layer: "tiling", plan_id, rooms: moved }, { actor: caller.id });
  return NextResponse.json({ success: true, rooms: rooms.map((r) => ({ id: r.id, tiled_height_m: r.tiled_height_m == null ? null : to2dp(r.tiled_height_m) })), moved: moved.length });
}
