import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { WET_ROOM_TYPES } from "@/lib/boq/wet-room";
import { recordPilotEvent } from "@/lib/pilot/events";
import { setupOf, WALLS, writesFor, type WetRoomSetup } from "@/lib/plan/wet-room-setup";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// B7 4 — PATCH /api/plan-wet-room { room_id, setup }: the wet-room panel on
// 01 Plan. One wet room's bulkhead, water heater, shower niche, shower valve
// wall and extractor — what the pilot set by script. Writes the room's spec, the
// shower fixture's spec and the water-heater fixture (lib/plan/wet-room-setup.ts);
// recorded as a `design_edit` on layer "wet_room" with from → to, so the revision
// diff can name it. The BoQ follows on the next regenerate. Any project member.
const WallZ = z.enum(WALLS as unknown as [string, ...string[]]);
const Body = z.object({
  room_id: z.string().uuid(),
  setup: z.object({
    bulkhead: z.object({ over: z.enum(["shower", "bath", "vanity", "wc"]) }).nullable(),
    heater: z.object({ wall: WallZ, height_mm: z.number().min(300).max(3500), action: z.enum(["box_in", "relocate"]) }).nullable(),
    niche: z.object({ wall: WallZ, width_mm: z.number().min(150).max(2000), height_mm: z.number().min(150).max(1500) }).nullable(),
    valve_wall: WallZ.nullable(),
    extractor: z.boolean(),
  }),
});

type FxRow = { id: string; type: string; position: [number, number]; spec: Record<string, unknown> | null };

export async function PATCH(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: "Body must be { room_id, setup: { bulkhead, heater, niche, valve_wall, extractor } }.", code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const { room_id } = body.data;
  const setup = body.data.setup as WetRoomSetup;
  const access = await projectAccess(db, caller, { room_id });
  if (access.denied) return access.denied;
  const projectId = access.projectId!;

  const { data: room } = await db.from("rooms").select("id, room_type, spec, polygon").eq("id", room_id).maybeSingle<{ id: string; room_type: string | null; spec: Record<string, unknown> | null; polygon: [number, number][] }>();
  if (!room) return NextResponse.json({ success: false, error: "That room is not on this project.", code: "room_not_found" }, { status: 404 });
  if (!WET_ROOM_TYPES.has(room.room_type ?? "")) return NextResponse.json({ success: false, error: "The wet-room panel is for a bathroom, ensuite or powder room.", code: "not_a_wet_room" }, { status: 422 });

  const { data: fxRows } = await db.from("plan_fixtures").select("id, type, position, spec").eq("project_id", projectId).eq("room_id", room_id).eq("layer", "plumbing");
  const fixtures = ((fxRows ?? []) as FxRow[]).filter((f) => Array.isArray(f.position));
  const before = setupOf(room.spec, fixtures, room.polygon);
  const w = writesFor(setup, room.spec, fixtures, room.polygon);

  const { error: rErr } = await db.from("rooms").update({ spec: w.roomSpec }).eq("id", room_id);
  if (rErr) return NextResponse.json({ success: false, error: rErr.message }, { status: 500 });
  if (w.showerSpec) {
    const { error } = await db.from("plan_fixtures").update({ spec: w.showerSpec.spec }).eq("id", w.showerSpec.id);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (w.heater.op === "delete") {
    const { error } = await db.from("plan_fixtures").delete().eq("id", w.heater.id);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } else if (w.heater.op === "upsert") {
    const row = { position: w.heater.position, spec: w.heater.spec };
    const { error } = w.heater.id
      ? await db.from("plan_fixtures").update(row).eq("id", w.heater.id)
      : await db.from("plan_fixtures").insert({ ...row, project_id: projectId, room_id, layer: "plumbing", type: "water_heater", source: "user" });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const after = setupOf(w.roomSpec, fixtures.map((f) => (w.showerSpec && f.id === w.showerSpec.id ? { ...f, spec: w.showerSpec.spec } : f)).filter((f) => f.type !== "water_heater").concat(w.heater.op === "upsert" ? [{ id: w.heater.id ?? "new", type: "water_heater", position: w.heater.position, spec: w.heater.spec }] : []), room.polygon);
  if (JSON.stringify(before) !== JSON.stringify(after)) await recordPilotEvent(db, projectId, "design_edit", { layer: "wet_room", room_id, from: before, to: after }, { actor: caller.id });
  return NextResponse.json({ success: true, setup: after });
}
