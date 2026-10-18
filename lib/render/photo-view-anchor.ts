// =============================================================================
// lib/render/photo-view-anchor.ts — locking a photo view, and the room anchor it
// makes (bathroom pilot B4, migration 064). Server-only.
//
//   lockPhotoView   the user locks a version of a view (room_photos.locked_*).
//                   The FIRST view locked in a room anchors it: the room design
//                   spec is read from that render (room-spec.ts) and stored in
//                   room_anchors. Locking another view later never moves the
//                   anchor; re-rendering a non-anchor view never touches it.
//   moveAnchor      an "Ask for a change" on the anchor view: the anchor moves
//                   to the new version (spec read again, the old one kept in
//                   `history`), and every other view's "follows" goes stale —
//                   shown, never re-rendered automatically.
//   loadStudioState the versions of each view, its lock, and each room's anchor.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { checkCostUsd } from "./photo-check";
import type { PhotoViewGate } from "./photo-view-run";
import { photoViewsOf, type RoomPhotoRow } from "./photo-views";
import { recordSpend } from "./render-spend";
import { extractRoomSpec, type RoomAnchor, type RoomDesignSpec } from "./room-spec";

export class AnchorError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type AnchorRow = { room_id: string; room_photo_id: string | null; render_id: string; spec: RoomDesignSpec; history: unknown[] | null; locked_at: string | null };

/** "Photo 2" — a room photo's view label, short. */
export async function photoShortLabel(db: SupabaseClient, roomId: string, roomPhotoId: string | null): Promise<string> {
  if (!roomPhotoId) return "the locked view";
  const { data } = await db.from("room_photos").select("id, room_id, public_url, storage_path, created_at").eq("room_id", roomId).returns<RoomPhotoRow[]>();
  const v = photoViewsOf(data ?? [], roomId).find((x) => x.id === roomPhotoId);
  return v ? `Photo ${v.n}` : "the locked view";
}

export async function loadRoomAnchor(db: SupabaseClient, roomId: string): Promise<RoomAnchor | null> {
  const { data, error } = await db.from("room_anchors").select("room_id, room_photo_id, render_id, spec, history, locked_at").eq("room_id", roomId).maybeSingle<AnchorRow>();
  if (error || !data) return null;
  return { room_id: data.room_id, room_photo_id: data.room_photo_id, render_id: data.render_id, spec: data.spec, locked_at: data.locked_at, label: await photoShortLabel(db, roomId, data.room_photo_id) };
}

const fetchBytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const mime = (b: Uint8Array): "image/jpeg" | "image/png" => (b[0] === 0x89 ? "image/png" : "image/jpeg");

async function readSpec(db: SupabaseClient, projectId: string, render: { id: string; image_url: string; room_photo_id: string | null }, actor: string | null): Promise<RoomDesignSpec> {
  const bytes = await fetchBytes(render.image_url);
  const read = await extractRoomSpec({ mediaType: mime(bytes), data: Buffer.from(bytes).toString("base64") });
  await recordSpend(db, { project_id: projectId, purpose: "photo_check", model: read.model, cost_usd: checkCostUsd(read.usage), render_id: render.id, room_photo_id: render.room_photo_id, detail: { step: "room_spec", usage: read.usage, actor } });
  return read.spec;
}

type RenderRow = { id: string; project_id: string; room_photo_id: string | null; image_url: string | null; mode: string | null; status: string | null; gate: PhotoViewGate | null };

/**
 * Lock a version of a photo view. Only a version that passed its layout check
 * can be locked — a locked view is a promise about the client's room. The
 * room's first lock anchors it.
 */
export async function lockPhotoView(db: SupabaseClient, input: { projectId: string; renderId: string; actor: string | null }): Promise<{ room_photo_id: string; locked_render_id: string; anchor: RoomAnchor; anchored_now: boolean }> {
  const { data: r } = await db.from("renders").select("id, project_id, room_photo_id, image_url, mode, status, gate").eq("id", input.renderId).maybeSingle<RenderRow>();
  if (!r || r.project_id !== input.projectId || r.mode !== "photo_view" || !r.room_photo_id) throw new AnchorError(404, "render_not_found", "That view is not on this project.");
  if (!r.image_url || r.status !== "succeeded") throw new AnchorError(409, "not_rendered", "This version has no image to lock.");
  if (r.gate?.outcome !== "passed") throw new AnchorError(409, "layout_not_passed", "Only a version that follows your photo's layout can be locked — render it again first.");
  const { data: photo } = await db.from("room_photos").select("id, room_id").eq("id", r.room_photo_id).maybeSingle<{ id: string; room_id: string }>();
  if (!photo) throw new AnchorError(404, "room_photo_not_found", "That photo is not on this project.");

  const now = new Date().toISOString();
  const { error: lockErr } = await db.from("room_photos").update({ locked_render_id: r.id, locked_at: now }).eq("id", photo.id);
  if (lockErr) throw new AnchorError(500, "migration_required", `The view could not be locked: ${lockErr.message}`);

  let anchor = await loadRoomAnchor(db, photo.room_id);
  let anchoredNow = false;
  if (!anchor) {
    const spec = await readSpec(db, input.projectId, { id: r.id, image_url: r.image_url, room_photo_id: photo.id }, input.actor);
    // The insert races nothing that matters: a second concurrent first-lock loses on the primary key and keeps the first.
    const { error } = await db.from("room_anchors").insert({ room_id: photo.room_id, room_photo_id: photo.id, render_id: r.id, spec, locked_by: input.actor, locked_at: now, updated_at: now });
    if (error && !/duplicate key/i.test(error.message)) throw new AnchorError(500, "anchor_not_saved", `The room's anchor could not be saved: ${error.message}`);
    anchor = await loadRoomAnchor(db, photo.room_id);
    anchoredNow = !error;
  }
  return { room_photo_id: photo.id, locked_render_id: r.id, anchor: anchor!, anchored_now: anchoredNow };
}

/** The anchor view was changed: the anchor follows its new version (spec read again; history kept). */
export async function moveAnchor(db: SupabaseClient, input: { projectId: string; roomId: string; render: { id: string; image_url: string; room_photo_id: string | null }; actor: string | null; request: string }): Promise<RoomAnchor | null> {
  const { data: cur } = await db.from("room_anchors").select("room_id, room_photo_id, render_id, spec, history, locked_at").eq("room_id", input.roomId).maybeSingle<AnchorRow>();
  if (!cur) return null;
  const spec = await readSpec(db, input.projectId, input.render, input.actor);
  const now = new Date().toISOString();
  const history = [...(Array.isArray(cur.history) ? cur.history : []), { render_id: cur.render_id, spec: cur.spec, until: now, request: input.request }];
  await db.from("room_anchors").update({ render_id: input.render.id, spec, history, updated_at: now }).eq("room_id", input.roomId);
  return loadRoomAnchor(db, input.roomId);
}

// --- the studio's view of it ---------------------------------------------------------------

export interface PhotoViewVersion {
  render_id: string;
  image_url: string | null;
  gate: PhotoViewGate;
  created_at: string;
  parent_render_id: string | null;
  anchor_render_id: string | null;
}

export interface PhotoViewState {
  /** Every stored version of each photo's view, oldest first (an unchanged edit is never one). */
  versions: Record<string, PhotoViewVersion[]>;
  /** The locked version of each photo, when locked. */
  locked: Record<string, string>;
  /** Each room's anchor. */
  anchors: Record<string, RoomAnchor>;
}

export async function loadStudioState(db: SupabaseClient, roomIds: readonly string[], photoIds: readonly string[]): Promise<PhotoViewState> {
  const out: PhotoViewState = { versions: {}, locked: {}, anchors: {} };
  if (photoIds.length > 0) {
    let res: { data: unknown[] | null; error: unknown } = await db.from("renders").select("id, room_photo_id, image_url, gate, created_at, parent_render_id, anchor_render_id, status").in("room_photo_id", [...photoIds]).eq("mode", "photo_view").order("created_at", { ascending: true });
    if (res.error) res = await db.from("renders").select("id, room_photo_id, image_url, gate, created_at, parent_render_id, status").in("room_photo_id", [...photoIds]).eq("mode", "photo_view").order("created_at", { ascending: true });
    for (const r of (res.data ?? []) as { id: string; room_photo_id: string; image_url: string | null; gate: PhotoViewGate; created_at: string; parent_render_id: string | null; anchor_render_id?: string | null; status: string | null }[]) {
      if (r.status !== "succeeded" || !r.gate) continue;
      (out.versions[r.room_photo_id] ??= []).push({ render_id: r.id, image_url: r.image_url, gate: r.gate, created_at: r.created_at, parent_render_id: r.parent_render_id, anchor_render_id: r.anchor_render_id ?? null });
    }
    const locks = await db.from("room_photos").select("id, locked_render_id").in("id", [...photoIds]);
    if (!locks.error) for (const p of (locks.data ?? []) as { id: string; locked_render_id: string | null }[]) if (p.locked_render_id) out.locked[p.id] = p.locked_render_id;
  }
  for (const roomId of roomIds) {
    const a = await loadRoomAnchor(db, roomId);
    if (a) out.anchors[roomId] = a;
  }
  return out;
}
