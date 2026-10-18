// =============================================================================
// lib/render/photo-view-change.ts — "Ask for a change" on a photo view
// (bathroom pilot B4; R10a's honesty, on the B2 pipeline). Server-only.
//
//   1. A structural request ("move the WC", "bigger window") goes to the plan —
//      422 before any model is paid (lib/render/change-request.ts).
//   2. The edit model edits the view's CURRENT image (google/nano-banana, the
//      R10a tweak path: the parent's own frame, nothing else re-composed).
//   3. Perceptual difference vs the parent (similarity.ts): below the R10a
//      threshold the row is kept as `status: "unchanged"` — never a version —
//      and the studio says "That change didn't come through — the image is the
//      same. Try being more specific."
//   4. A real change must still hold the photo's layout: the placement check
//      reads it beside the photo. An edit that moved a fixture is not kept
//      ("That change moved the WC — it was not kept.").
//   5. What it changed, read beside the parent (room-spec describeChange) →
//      "Last change: “lighter oak floor” → version 2 · changed: floor finish".
//   6. The version follows its parent's lock; on the ANCHOR view it moves the
//      room's anchor (spec read again) and every other view's "follows" goes
//      stale — shown, not re-rendered.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { uploadRenderBytes } from "@/lib/render-storage";
import { fetchSceneBytes, runRenderModel } from "@/lib/scene-render/pipeline";
import { imageSize } from "@/lib/scene-render/gate";

import { classifyChangeRequest, planOpeningsHref, STRUCTURAL_MESSAGE } from "./change-request";
import { checkCostUsd, detectItems, judgePhotoPlacement } from "./photo-check";
import { moveAnchor } from "./photo-view-anchor";
import { PhotoViewError, type PhotoViewChange, type PhotoViewGate } from "./photo-view-run";
import { IMAGE_PRICE_USD, recordSpend, type SpendRow } from "./render-spend";
import { changeLine, describeChange, type RoomAnchor } from "./room-spec";
import { compareImages, isUnchangedEdit, UNCHANGED_MESSAGE } from "./similarity";

export const CHANGE_MODEL = "google/nano-banana";

export function changePrompt(request: string): string {
  return [
    `Edit this photo of a renovated bathroom: ${request.trim()}.`,
    "Change ONLY that. Keep everything else exactly as it is: the same camera, framing and crop, the same room, door, window and every fixture in the same place and size, and every finish the request does not mention. Photorealistic.",
  ].join(" ");
}

export type ChangeOutcome =
  | { kind: "version"; render_id: string; image_url: string; gate: PhotoViewGate; change: PhotoViewChange; anchor: RoomAnchor | null }
  | { kind: "unchanged"; render_id: string; message: string }
  | { kind: "moved"; render_id: string; message: string };

const mime = (b: Uint8Array): "image/jpeg" | "image/png" => (b[0] === 0x89 ? "image/png" : "image/jpeg");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

export async function runPhotoViewChange(db: SupabaseClient, input: { projectId: string; renderId: string; request: string; actor: string | null }): Promise<ChangeOutcome> {
  const request = input.request.trim();
  if (!request) throw new PhotoViewError(400, "bad_request", "Say what to change.");
  const cls = classifyChangeRequest(request);
  if (cls.kind === "structural") throw Object.assign(new PhotoViewError(422, "structural_change", STRUCTURAL_MESSAGE), { plan_href: planOpeningsHref(input.projectId) });

  const { data: parent } = await db.from("renders").select("id, project_id, room_photo_id, image_url, mode, status, gate, anchor_render_id").eq("id", input.renderId).maybeSingle<{ id: string; project_id: string; room_photo_id: string | null; image_url: string | null; mode: string | null; status: string | null; gate: PhotoViewGate | null; anchor_render_id: string | null }>();
  if (!parent || parent.project_id !== input.projectId || parent.mode !== "photo_view" || !parent.room_photo_id || !parent.gate) throw new PhotoViewError(404, "render_not_found", "That view is not on this project.");
  if (!parent.image_url || parent.status !== "succeeded") throw new PhotoViewError(409, "not_rendered", "Render this view first, then ask for a change.");
  const { data: photo } = await db.from("room_photos").select("id, room_id, public_url, locked_render_id, before_detection").eq("id", parent.room_photo_id).maybeSingle<{ id: string; room_id: string; public_url: string; locked_render_id: string | null; before_detection: { detection: { items: PhotoViewGate["before"] } } | null }>();
  if (!photo) throw new PhotoViewError(404, "room_photo_not_found", "That photo is not on this project.");

  const spend: SpendRow[] = [];
  const parentBytes = await fetchSceneBytes(parent.image_url);
  const url = await runRenderModel(CHANGE_MODEL, { prompt: changePrompt(request), image_input: [parent.image_url], aspect_ratio: "match_input_image", output_format: "jpg" });
  const next = await fetchSceneBytes(url);
  let cost = IMAGE_PRICE_USD[CHANGE_MODEL] ?? 0;
  spend.push({ project_id: input.projectId, purpose: "photo_view", model: CHANGE_MODEL, size: (() => { const s = imageSize(next); return s ? `${s.width}x${s.height}` : null; })(), cost_usd: IMAGE_PRICE_USD[CHANGE_MODEL] ?? null, detail: { step: "change", request } });

  const sim = await compareImages(Buffer.from(parentBytes), Buffer.from(next)).catch(() => null);
  const record = async (status: string, gate: Record<string, unknown>, image: string | null) => {
    const { data: row, error } = await db.from("renders").insert({ project_id: input.projectId, room_id: null, room_photo_id: photo.id, parent_render_id: parent.id, prompt: changePrompt(request), image_url: image, source_image_url: parent.image_url, model: CHANGE_MODEL, mode: "photo_view", gate, status, ...(parent.anchor_render_id ? { anchor_render_id: parent.anchor_render_id } : {}) }).select("id").single<{ id: string }>();
    if (error || !row) throw new Error(`could not save the change: ${error?.message}`);
    await recordSpend(db, spend.map((s) => ({ ...s, render_id: row.id, room_photo_id: photo.id, detail: { ...(s.detail ?? {}), actor: input.actor } })));
    return row.id;
  };

  // R10a: an edit that came back the same image is on record, never a version.
  if (sim && isUnchangedEdit(sim)) {
    const id = await record("unchanged", { unchanged: true, request, similarity: sim }, null);
    return { kind: "unchanged", render_id: id, message: UNCHANGED_MESSAGE };
  }

  // The layout still holds: the edit read beside the photo, against the photo's own reading.
  const before = photo.before_detection?.detection ?? { items: parent.gate.before };
  const photoBytes = new Uint8Array(await (await fetch(photo.public_url)).arrayBuffer());
  const read = await detectItems({ mediaType: mime(next), data: b64(next) }, parent.gate.items, "after", imageSize(next), { image: { mediaType: mime(photoBytes), data: b64(photoBytes) }, located: before.items });
  const readUsd = checkCostUsd(read.usage);
  cost += readUsd;
  spend.push({ project_id: input.projectId, purpose: "photo_check", model: read.model, cost_usd: readUsd, detail: { step: "change_layout", usage: read.usage } });
  const verdict = judgePhotoPlacement(parent.gate.items, before, read);
  if (!verdict.passed) {
    const first = verdict.failures[0];
    const message = `That change ${first ? first.message.replace(/^the render /, "") : "moved the layout"} — it was not kept. Try asking for it differently.`;
    const id = await record("unchanged", { unchanged: false, layout_failed: true, request, failures: verdict.failures, similarity: sim }, null);
    return { kind: "moved", render_id: id, message };
  }

  const what = await describeChange({ mediaType: mime(parentBytes), data: b64(parentBytes) }, { mediaType: mime(next), data: b64(next) }, request);
  const whatUsd = checkCostUsd(what.usage);
  cost += whatUsd;
  spend.push({ project_id: input.projectId, purpose: "photo_check", model: read.model, cost_usd: whatUsd, detail: { step: "change_describe", usage: what.usage } });

  const { count } = await db.from("renders").select("id", { count: "exact", head: true }).eq("room_photo_id", photo.id).eq("mode", "photo_view").eq("status", "succeeded");
  const version = (count ?? 0) + 1;
  const change: PhotoViewChange = {
    request,
    changed: what.changed,
    summary: what.summary,
    line: changeLine(request, version, what.changed),
    version,
    parent_render_id: parent.id,
    ssim: sim ? Math.round(sim.ssim * 1000) / 1000 : null,
    changed_pct: sim ? Math.round(sim.changedPct * 10) / 10 : null,
    cost_usd: Math.round(cost * 10000) / 10000,
  };
  const stored = await uploadRenderBytes(`projects/${input.projectId}/photo-views/${photo.id}-${Date.now()}.jpg`, next, mime(next));
  const gate: PhotoViewGate = { ...parent.gate, outcome: "passed", line: verdict.line, change, cost_usd: change.cost_usd };
  const id = await record("succeeded", gate as unknown as Record<string, unknown>, stored);

  // The lock follows the version the user changed; on the anchor view, so does the anchor.
  let anchor: RoomAnchor | null = null;
  if (photo.locked_render_id === parent.id) {
    await db.from("room_photos").update({ locked_render_id: id, locked_at: new Date().toISOString() }).eq("id", photo.id);
    const { data: a } = await db.from("room_anchors").select("render_id").eq("room_id", photo.room_id).maybeSingle<{ render_id: string }>();
    if (a?.render_id === parent.id) anchor = await moveAnchor(db, { projectId: input.projectId, roomId: photo.room_id, render: { id, image_url: stored, room_photo_id: photo.id }, actor: input.actor, request });
  }
  return { kind: "version", render_id: id, image_url: stored, gate, change, anchor };
}
