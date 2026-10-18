import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { projectAccess } from "@/lib/projects/http";
import { headingBetween, insidePolygon, normHeading, photoViewsOf, type RoomPhotoRow } from "@/lib/render/photo-views";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// B2 (migration 062) — a room's photos as views, and where each was taken from.
//
//   GET   /api/room-photos?room_id=…   every photo of the room, oldest first
//                                      ("Photo N · your photo"), with its camera
//   PATCH /api/room-photos { id, camera: { position, heading_deg } | { position, toward } | null }
//                                      place a photo on the room plan — the point it
//                                      was taken from (normalised plan space, inside
//                                      the room) and the heading it looks along, or
//                                      the point it looks toward; null clears it.
//
// Where a photo was taken from changes no quantity, so it is not a plan edit
// (no design_edit event — the BoQ is not stale because a photo was placed).

const COLS = "id, room_id, public_url, storage_path, created_at, camera_position, camera_heading_deg";
const COLS_PRE062 = "id, room_id, public_url, storage_path, created_at";

const Pt = z.tuple([z.number().finite(), z.number().finite()]);
const Patch = z.object({
  id: z.string().uuid(),
  camera: z.union([z.object({ position: Pt, heading_deg: z.number().finite() }), z.object({ position: Pt, toward: Pt }), z.null()]),
});

const db = () => getSupabaseAdmin() as unknown as SupabaseClient;

export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const roomId = new URL(request.url).searchParams.get("room_id");
  if (!roomId || !z.string().uuid().safeParse(roomId).success) return NextResponse.json({ error: "room_id (uuid) required." }, { status: 400 });
  const access = await projectAccess(db(), caller, { room_id: roomId });
  if (access.denied) return access.denied;
  let res = await db().from("room_photos").select(COLS).eq("room_id", roomId).returns<RoomPhotoRow[]>();
  if (res.error) res = await db().from("room_photos").select(COLS_PRE062).eq("room_id", roomId).returns<RoomPhotoRow[]>();
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  return NextResponse.json({ views: photoViewsOf((res.data ?? []) as RoomPhotoRow[], roomId) });
}

export async function PATCH(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body must be { id, camera: { position, heading_deg } | { position, toward } | null }.", code: "bad_request" }, { status: 400 });
  const { id, camera } = parsed.data;
  const access = await projectAccess(db(), caller, { room_photo_id: id });
  if (access.denied) return access.denied;

  const { data: photo } = await db().from("room_photos").select("room_id").eq("id", id).maybeSingle<{ room_id: string }>();
  let patch: Record<string, unknown> = { camera_position: null, camera_heading_deg: null, camera_set_by: caller.id };
  if (camera) {
    const { data: room } = await db().from("rooms").select("polygon").eq("id", photo!.room_id).maybeSingle<{ polygon: unknown }>();
    const poly = Array.isArray(room?.polygon) ? (room!.polygon as [number, number][]) : null;
    if (poly && !insidePolygon(camera.position, poly, 1e-6)) {
      return NextResponse.json({ error: "A photo is taken from inside its room — place it on the room.", code: "outside_room" }, { status: 422 });
    }
    const heading = "heading_deg" in camera ? normHeading(camera.heading_deg) : headingBetween(camera.position, camera.toward);
    if ("toward" in camera && camera.toward[0] === camera.position[0] && camera.toward[1] === camera.position[1]) {
      return NextResponse.json({ error: "Drag from where the photo was taken toward what it looks at.", code: "no_direction" }, { status: 400 });
    }
    patch = { camera_position: camera.position, camera_heading_deg: heading, camera_set_by: caller.id };
  }
  const { error } = await db().from("room_photos").update(patch).eq("id", id);
  if (error) {
    const missing = /camera_|schema cache|does not exist/i.test(error.message);
    return NextResponse.json({ error: missing ? "Placing photos needs migration 062 — apply it with npm run db:push." : error.message, code: missing ? "migration_required" : "write_failed" }, { status: 500 });
  }
  const { data: rows } = await db().from("room_photos").select(COLS).eq("room_id", photo!.room_id).returns<RoomPhotoRow[]>();
  const views = photoViewsOf((rows ?? []) as RoomPhotoRow[], photo!.room_id);
  return NextResponse.json({ view: views.find((v) => v.id === id) ?? null, views });
}
