// =============================================================================
// lib/render/photo-view-change.ts — "Ask for a change" on a photo view
// (bathroom pilot B4; R10a's honesty, on the B2 pipeline). Server-only.
//
//   1. A structural request ("move the WC", "bigger window") goes to the plan —
//      422 before any model is paid (lib/render/change-request.ts).
//   2. The edit model edits the view's CURRENT image — the photo-view model
//      (photoViewArm: nano-banana-pro by default, the parent padded to 9 : 16
//      and the output cut back to its frame, as the restyle does; nano-banana
//      edits the parent's own frame). Ruled 19 Oct: nano-banana invented a
//      window wherever it erased something, edit after edit.
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
import { cropToFrame, fitMap, frameRect, geometricMap, padToAspect, toPhotoBoxes } from "./frame-pin";
import { carryLocated, checkCostUsd, checkItemsFor, detectAgreed, itemsNamedBy, judgePhotoPlacement } from "./photo-check";
import { ARM_MODEL, photoViewArm, restyleInput } from "./photo-restyle";
import { loadMiniPlans } from "./photo-views-load";
import { designKey } from "@/lib/documents/render-consistency";
import { moveAnchor } from "./photo-view-anchor";
import { PhotoViewError, type PhotoViewChange, type PhotoViewGate } from "./photo-view-run";
import { IMAGE_PRICE_USD, recordSpend, type SpendRow } from "./render-spend";
import { changeLine, describeChange, type RoomAnchor } from "./room-spec";
import { compareImages, isUnchangedEdit, UNCHANGED_MESSAGE } from "./similarity";

/** The nano-banana edit model (PHOTO_VIEW_MODEL=edit). The default is the photo-view model — see changeModel(). */
export const CHANGE_MODEL = "google/nano-banana";
export const changeModel = (env: Record<string, string | undefined> = process.env) => ARM_MODEL[photoViewArm(env)];

export function changePrompt(request: string, pinned = false): string {
  return [
    `Edit this photo of a renovated bathroom: ${request.trim()}.`,
    pinned ? "The narrow strips at the left and right edges are a mirrored copy of the photo's own edges, added only to fill the frame: keep the room itself exactly where the photo has it." : "",
    "Change ONLY that. Keep everything else exactly as it is: the same camera, framing and crop, the same room, door, window and every fixture in the same place and size, and every finish the request does not mention. Do not add any window, door or opening — where something is removed, leave plain tiled wall. Photorealistic.",
  ].filter(Boolean).join(" ");
}

/** B7 6: a change the check refused — its image and reading, shown beside the kept version. */
export interface RefusedChange {
  render_id: string;
  image_url: string;
  request: string;
  message: string;
  failures: { ref: string; short: string; reason: string; message: string }[];
  after: { ref: string; present: boolean; box: [number, number, number, number] | null; instances: number }[];
  created_at: string;
}

export type ChangeOutcome =
  | { kind: "version"; render_id: string; image_url: string; gate: PhotoViewGate; change: PhotoViewChange; anchor: RoomAnchor | null }
  | { kind: "unchanged"; render_id: string; message: string }
  | { kind: "moved"; render_id: string; message: string; refused: RefusedChange };

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

  // The layout still holds: a change is held to the VERSION it edits — the edit
  // read beside its parent, against the parent's own reading (which already
  // passed against the photo). Held to the photo instead, an edit inherits
  // whatever its parent was measured with: a B2 version predates the size rule,
  // and every change to it failed on the parent's own vanity (live, 18 Oct).
  const parentRead = parent.gate.attempts.at(-1)?.after ?? null;
  const reference = parentRead
    ? { bytes: parentBytes, items: parentRead }
    : { bytes: new Uint8Array(await (await fetch(photo.public_url)).arrayBuffer()), items: (photo.before_detection?.detection ?? { items: parent.gate.before }).items };
  // The plan may have changed since the parent was rendered (a cabinet where the
  // bidet was): the edit is checked against the plan's CURRENT items, the
  // parent's reading carried over to them.
  const { data: plan } = await db.from("plans").select("id, total_area_m2, source, plot_width_m").eq("project_id", input.projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; total_area_m2: number | null; source: string | null; plot_width_m: number | null }>();
  const mini = plan ? (await loadMiniPlans(db, input.projectId, plan, [photo.room_id]))[photo.room_id] : undefined;
  const items = mini ? checkItemsFor(mini) : parent.gate.items;
  const carried = mini ? carryLocated(parent.gate.items, reference.items, items) : reference.items;
  const before = { items: carried };

  const arm = photoViewArm();
  const model = ARM_MODEL[arm];
  const pinned = arm === "edit_pro" ? await padToAspect(parentBytes) : null;
  const prompt = changePrompt(request, !!pinned);
  const url = await runRenderModel(model, pinned ? restyleInput("edit_pro", prompt, `data:image/jpeg;base64,${pinned.bytes.toString("base64")}`) : { prompt, image_input: [parent.image_url], aspect_ratio: "match_input_image", output_format: "jpg" });
  const raw = await fetchSceneBytes(url);
  let cost = IMAGE_PRICE_USD[model] ?? 0;
  spend.push({ project_id: input.projectId, purpose: "photo_view", model, size: (() => { const s = imageSize(raw); return s ? `${s.width}x${s.height}` : null; })(), cost_usd: IMAGE_PRICE_USD[model] ?? null, detail: { step: "change", request, arm } });
  // Read where everything is in the model's own frame first: a pinned output is cut back by it.
  const readRaw = await detectAgreed({ mediaType: mime(raw), data: b64(raw) }, items, "after", imageSize(raw), { image: { mediaType: mime(reference.bytes), data: b64(reference.bytes) }, located: carried });
  const readUsd = checkCostUsd(readRaw.usage);
  cost += readUsd;
  spend.push({ project_id: input.projectId, purpose: "photo_check", model: readRaw.model, cost_usd: readUsd, detail: { step: "change_layout", usage: readRaw.usage } });
  let next: Uint8Array = raw;
  let read = readRaw;
  if (pinned) {
    const parentSize = imageSize(parentBytes)!;
    const out = imageSize(raw)!;
    const map = fitMap(carried, readRaw.items, parentSize, out, geometricMap(pinned.plan, out));
    next = new Uint8Array(await cropToFrame(raw, frameRect(map, parentSize, out)));
    read = { ...readRaw, items: toPhotoBoxes(readRaw.items, map, parentSize, out) };
  }

  const sim = await compareImages(Buffer.from(parentBytes), Buffer.from(next)).catch(() => null);
  const record = async (status: string, gate: Record<string, unknown>, image: string | null) => {
    const { data: row, error } = await db.from("renders").insert({ project_id: input.projectId, room_id: null, room_photo_id: photo.id, parent_render_id: parent.id, prompt, image_url: image, source_image_url: parent.image_url, model, mode: "photo_view", gate, status, ...(parent.anchor_render_id ? { anchor_render_id: parent.anchor_render_id } : {}) }).select("id").single<{ id: string }>();
    if (error || !row) throw new Error(`could not save the change: ${error?.message}`);
    await recordSpend(db, spend.map((s) => ({ ...s, render_id: row.id, room_photo_id: photo.id, detail: { ...(s.detail ?? {}), actor: input.actor } })));
    return row.id;
  };

  // R10a: an edit that came back the same image is on record, never a version.
  if (sim && isUnchangedEdit(sim)) {
    const id = await record("unchanged", { unchanged: true, request, similarity: sim }, null);
    return { kind: "unchanged", render_id: id, message: UNCHANGED_MESSAGE };
  }

  const verdict = judgePhotoPlacement(items, before, read, { resizable: itemsNamedBy(request, items) });
  if (!verdict.passed) {
    const first = verdict.failures[0];
    const message = `That change ${first ? first.message.replace(/^the render /, "") : "moved the layout"} — it was not kept. Try asking for it differently.`;
    // B7 6: kept for "see what differs" — the refused image (stored: the model's URL expires) and its reading.
    const refused_image_url = await uploadRenderBytes(`projects/${input.projectId}/photo-views/refused-${photo.id}-${Date.now()}.jpg`, next, mime(next)).catch(() => null);
    const id = await record("unchanged", { unchanged: false, layout_failed: true, request, failures: verdict.failures, similarity: sim, candidate_url: url, refused_image_url, items, before: carried, after: read.items }, null);
    return { kind: "moved", render_id: id, message, refused: { render_id: id, image_url: refused_image_url ?? url, request, message, failures: verdict.failures, after: read.items, created_at: new Date().toISOString() } };
  }

  const what = await describeChange({ mediaType: mime(parentBytes), data: b64(parentBytes) }, { mediaType: mime(next), data: b64(next) }, request);
  const whatUsd = checkCostUsd(what.usage);
  cost += whatUsd;
  spend.push({ project_id: input.projectId, purpose: "photo_check", model: read.model, cost_usd: whatUsd, detail: { step: "change_describe", usage: what.usage } });
  // R10a, read not measured: the image moved a little but the request did not
  // happen ("No visible change; shattaf still present", live 19 Oct) — the
  // honest unchanged answer, never a version.
  if (what.request_done === "no") {
    const id = await record("unchanged", { unchanged: true, request, similarity: sim, read_unchanged: true, summary: what.summary, candidate_url: url }, null);
    return { kind: "unchanged", render_id: id, message: UNCHANGED_MESSAGE };
  }

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
  // The version's own reading is what the next change is held to.
  const attempts = parent.gate.attempts.length ? [...parent.gate.attempts.slice(0, -1), { ...parent.gate.attempts.at(-1)!, after: read.items }] : parent.gate.attempts;
  const { data: roomRow } = await db.from("rooms").select("spec").eq("id", photo.room_id).maybeSingle<{ spec: Record<string, unknown> | null }>();
  const design_key = mini ? designKey(mini.fixtures, roomRow?.spec?.wet_room ?? null) : parent.gate.design_key;
  const gate: PhotoViewGate = { ...parent.gate, items, attempts, outcome: "passed", line: verdict.line, change, cost_usd: change.cost_usd, ...(design_key ? { design_key } : {}) };
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
