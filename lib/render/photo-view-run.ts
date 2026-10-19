// =============================================================================
// lib/render/photo-view-run.ts — render one photo view (bathroom pilot B2).
//
// The client's photo, restyled to the client's references, its layout held by
// the placement check (photo-check.ts) with one re-render, then an honest
// failure. Server-only. The result is a `renders` row with mode "photo_view",
// `room_photo_id` set and `room_id` NULL — a photo view is not the room's day
// render, so no room-level reader (chains, Generate all, lock progress, the 3D
// anchors) picks it up; it is read through its photo. Every paid call is a
// render_spend row (the cost guard).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { uploadRenderBytes } from "@/lib/render-storage";
import { getStyleByKey } from "@/lib/styles";
import { resolveAnyStyle } from "@/lib/garden-styles";

import { CHECK_VERSION, checkItemsFor, checkCostUsd, expectedInView, type CheckItem, type Detection } from "./photo-check";
import { ARM_MODEL, photoViewArm, readBefore, restyleWithCheck, type RestyleResult } from "./photo-restyle";
import { cameraOf } from "./photo-views";
import { loadMiniPlans } from "./photo-views-load";
import { PHOTO_VIEW_IMAGE_REFS, styleBriefFrom, type ReferenceStyle } from "./reference-style";
import { IMAGE_PRICE_USD, recordSpend, USD_TO_AED } from "./render-spend";
import { loadRoomAnchor } from "./photo-view-anchor";
import { wetRoomChoicesOf } from "@/lib/boq/wet-room";
import { designKey } from "@/lib/documents/render-consistency";
import { fittingNotes } from "./fitting-notes";
import { followsLine, specElements } from "./room-spec";

// b4-1: a view of an anchored room renders against the anchor (image + spec) and is checked beside it.
export const PHOTO_VIEW_PIPELINE = "b4-1";

/**
 * Renders per view: the first, and one re-render with the check's findings
 * (the pair-gate loop). PHOTO_VIEW_MAX_ATTEMPTS=1 caps a deployment (or a
 * verification run) at one paid render per view; a failure is then shown at once.
 */
export function photoViewMaxAttempts(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.PHOTO_VIEW_MAX_ATTEMPTS);
  return Number.isInteger(n) && n >= 1 && n <= 2 ? n : 2;
}

/** Vision readings per attempt (the after reading twice, B8, + the style or follows check), US$ — measured at ≈ 0.03 each. */
const CHECKS_PER_ATTEMPT_USD = 0.09;

/** B4 cost guard: what one view costs to render, AED — one attempt … `maxAttempts` (the studio's estimate). */
export function photoViewCostAed(maxAttempts: number, env: Record<string, string | undefined> = process.env): { low: number; high: number } {
  const per = (IMAGE_PRICE_USD[ARM_MODEL[photoViewArm(env)]] ?? 0) + CHECKS_PER_ATTEMPT_USD;
  const aed = (usd: number) => Math.round(usd * USD_TO_AED * 100) / 100;
  return { low: aed(per), high: aed(per * Math.max(1, maxAttempts)) };
}

export interface PhotoViewGate {
  pipeline: string;
  outcome: "passed" | "failed" | "error";
  line: string;
  style_line: string;
  style_source: "references" | "preset" | "anchor";
  arm: string;
  checked: string[];
  items: CheckItem[];
  before: Detection["items"];
  expected_in_view: string[] | null;
  attempts: {
    attempt: number;
    model: string;
    image_url: string | null;
    size: string | null;
    passed: boolean;
    failures: { ref: string; short: string; reason: string; message: string }[];
    after: Detection["items"] | null;
    ssim: number | null;
    changed_pct: number | null;
    style: { score: number; passed: boolean; elements: { element: string; verdict: string; note: string }[] } | null;
    /** B2b: a frame-pinned output, and how it was cut back to the photo. */
    frame?: { source: string; k: number; residual_px: number | null; rect: { left: number; top: number; width: number; height: number }; output: string } | null;
    cost_usd: number;
    error?: string;
  }[];
  cost_usd: number;
  /** B4: the room anchor this render was made against (absent = none, or this view is the anchor). */
  anchor?: { render_id: string; label: string } | null;
  /** B7: the design fingerprint when it was made (designKey — fixtures + the room's product choices). */
  design_key?: string;
  /** B4: set on a version made by "Ask for a change". */
  change?: PhotoViewChange | null;
}

/** B4: what an "Ask for a change" asked for and what it changed. */
export interface PhotoViewChange {
  request: string;
  changed: string[];
  summary: string;
  /** "Last change: “…” → version 2 · changed: floor finish". */
  line: string;
  version: number;
  parent_render_id: string;
  ssim: number | null;
  changed_pct: number | null;
  cost_usd: number;
}

export class PhotoViewError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const itemsKeyOf = (items: readonly CheckItem[]) => `${CHECK_VERSION}|` + items.map((i) => `${i.ref}:${i.plan_id}`).join("|");

export async function runPhotoView(db: SupabaseClient, input: { projectId: string; roomPhotoId: string; actor: string | null; promptOverride?: (attempt: number) => string | null }): Promise<{ render_id: string; image_url: string | null; gate: PhotoViewGate }> {
  const { data: photo } = await db.from("room_photos").select("id, room_id, public_url, camera_position, camera_heading_deg, before_detection").eq("id", input.roomPhotoId).maybeSingle<{ id: string; room_id: string; public_url: string; camera_position: unknown; camera_heading_deg: number | null; before_detection: { items_key: string; detection: Detection } | null }>();
  if (!photo?.public_url) throw new PhotoViewError(404, "room_photo_not_found", "That photo is not on this project.");
  const { data: plan } = await db.from("plans").select("id, total_area_m2, source, plot_width_m").eq("project_id", input.projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; total_area_m2: number | null; source: string | null; plot_width_m: number | null }>();
  if (!plan) throw new PhotoViewError(409, "no_plan", "This project has no plan — the check reads the room's fixtures from it.");
  const mini = (await loadMiniPlans(db, input.projectId, plan, [photo.room_id]))[photo.room_id];
  if (!mini) throw new PhotoViewError(409, "no_room", "The photo's room is not on the plan.");
  const items = checkItemsFor(mini);
  if (items.length === 0) throw new PhotoViewError(409, "nothing_to_check", "Mark the room's door, window and fixtures on 01 Plan first — the check holds the render to them.");

  const photoBytes = new Uint8Array(await (await fetch(photo.public_url)).arrayBuffer());
  const itemsKey = itemsKeyOf(items);
  let before = photo.before_detection?.items_key === itemsKey ? photo.before_detection.detection : null;
  const spend: Parameters<typeof recordSpend>[1] = [];
  if (!before) {
    before = await readBefore(photoBytes, items);
    spend.push({ project_id: input.projectId, purpose: "photo_check", model: before.model, cost_usd: checkCostUsd(before.usage), room_photo_id: photo.id, detail: { step: "before", usage: before.usage } });
    await db.from("room_photos").update({ before_detection: { items_key: itemsKey, detection: before } }).eq("id", photo.id);
  }

  // The style: the client's references in words, else the project's direction.
  const { data: brief } = await db.from("project_briefs").select("reference_style").eq("project_id", input.projectId).maybeSingle<{ reference_style: ReferenceStyle | null }>();
  const { data: choice } = await db.from("style_choices").select("style_key").eq("project_id", input.projectId).is("room_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle<{ style_key: string }>();
  const preset = resolveAnyStyle(choice?.style_key ?? null, getStyleByKey);
  let style = styleBriefFrom(brief?.reference_style ?? null, preset ? { name_en: preset.name_en, prompt: preset.one_line } : null);

  let extra: string[] = [];
  if (PHOTO_VIEW_IMAGE_REFS && brief?.reference_style?.item_ids?.length) {
    const { data: assets } = await db.from("project_assets").select("id, storage_path").in("id", brief.reference_style.item_ids.slice(0, 3));
    extra = ((assets ?? []) as { storage_path: string }[]).map((a) => db.storage.from("plan-uploads").getPublicUrl(a.storage_path).data.publicUrl);
  }

  // B4: once the room is anchored, every OTHER view renders against the anchor —
  // its image after the photo (in place of the references, which it already
  // embodies) and the room design spec as the look — and is checked beside it.
  // The anchor's own view renders as before, and no render here moves the anchor.
  const anchor = await loadRoomAnchor(db, photo.room_id);
  let anchorInput: { label: string; bytes: Uint8Array } | null = null;
  if (anchor && anchor.room_photo_id !== photo.id) {
    const { data: ar } = await db.from("renders").select("image_url").eq("id", anchor.render_id).maybeSingle<{ image_url: string | null }>();
    const elements = specElements(anchor.spec);
    if (ar?.image_url && elements.length > 0) {
      anchorInput = { label: anchor.label, bytes: new Uint8Array(await (await fetch(ar.image_url)).arrayBuffer()) };
      extra = [ar.image_url];
      style = { text: elements.map((e) => `${e.element}: ${e.finish}`).join("; ") + ".", source: "anchor", line: followsLine("follows", anchor.label), elements };
    }
  }

  const arm = photoViewArm();
  const wcInView = items.some((it) => it.kind === "wc" && before!.items.find((l) => l.ref === it.ref)?.present);
  const notes = fittingNotes(cameraOf(photo), mini, wcInView);
  // The room's spec choices that change a fixture's form: a fixed walk-in panel
  // for the photo's hinged screen is smaller ON PURPOSE — said, and its size freed.
  const { data: roomRow } = await db.from("rooms").select("spec").eq("id", photo.room_id).maybeSingle<{ spec: Record<string, unknown> | null }>();
  const resizable = new Set<string>();
  if (wetRoomChoicesOf(roomRow?.spec ?? null).shower_screen === "fixed_panel") {
    for (const it of items) if (it.kind === "shower") resizable.add(it.ref);
    notes.push("The shower has ONE fixed frameless walk-in glass panel — no hinged glass door, no second panel; the shower is open at its end. Keep the shower where it is.");
  }
  const res: RestyleResult = await restyleWithCheck({ notes, resizable, project_id: input.projectId, arm, photoUrl: photo.public_url, photoBytes, items, before, style, extraImages: extra, promptOverride: input.promptOverride, maxAttempts: photoViewMaxAttempts(), anchor: anchorInput });
  let stored: string | null = null;
  if (res.final) stored = await uploadRenderBytes(`projects/${input.projectId}/photo-views/${photo.id}-${Date.now()}.jpg`, res.final.bytes, res.final.bytes[0] === 0x89 ? "image/png" : "image/jpeg");

  const camera = cameraOf(photo);
  const gate: PhotoViewGate = {
    pipeline: PHOTO_VIEW_PIPELINE,
    outcome: res.outcome,
    line: res.line,
    style_line: res.style_line,
    style_source: style.source,
    arm: arm,
    checked: res.attempts.find((a) => a.verdict)?.verdict?.checked ?? [],
    items,
    before: before.items,
    expected_in_view: camera ? [...expectedInView(camera, mini, items, mini.m_per_u)] : null,
    attempts: res.attempts.map((a) => ({
      attempt: a.attempt,
      model: a.model,
      image_url: a.image_url,
      size: a.size,
      passed: !!a.verdict?.passed,
      failures: a.verdict?.failures ?? [],
      after: a.after?.items ?? null,
      ssim: a.similarity ? Math.round(a.similarity.ssim * 1000) / 1000 : null,
      changed_pct: a.similarity ? Math.round(a.similarity.changedPct * 10) / 10 : null,
      style: a.style ? { score: a.style.score, passed: a.style.passed, elements: a.style.elements } : null,
      frame: a.frame ? { source: a.frame.map.source, k: Math.round(a.frame.map.k * 1000) / 1000, residual_px: a.frame.map.residual_px, rect: a.frame.rect, output: a.frame.output } : null,
      cost_usd: Math.round(a.cost_usd * 10000) / 10000,
      ...(a.error ? { error: a.error } : {}),
    })),
    cost_usd: Math.round((res.attempts.reduce((s, a) => s + a.cost_usd, 0) + spend.reduce((s, r) => s + (r.cost_usd ?? 0), 0)) * 10000) / 10000,
    ...(anchorInput && anchor ? { anchor: { render_id: anchor.render_id, label: anchor.label } } : {}),
    design_key: designKey(mini.fixtures, (roomRow?.spec as Record<string, unknown> | null)?.wet_room ?? null),
  };
  const { data: row, error } = await db
    .from("renders")
    .insert({
      project_id: input.projectId,
      room_id: null,
      room_photo_id: photo.id,
      prompt: res.attempts.at(-1)?.prompt ?? "",
      image_url: stored,
      source_image_url: photo.public_url,
      model: res.attempts.at(-1)?.model ?? null,
      mode: "photo_view",
      gate,
      status: res.outcome === "error" ? "failed" : "succeeded",
      ...(anchorInput && anchor ? { anchor_render_id: anchor.render_id } : {}),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !row) throw new Error(`could not save the photo view: ${error?.message}`);
  await recordSpend(db, [...spend, ...res.spend].map((s) => ({ ...s, render_id: row.id, room_photo_id: photo.id, detail: { ...(s.detail ?? {}), actor: input.actor } })));
  return { render_id: row.id, image_url: stored, gate };
}

/** The latest photo-view render of each photo (for the studio). */
export async function loadPhotoViewRenders(db: SupabaseClient, photoIds: readonly string[]): Promise<Record<string, { render_id: string; image_url: string | null; gate: PhotoViewGate; created_at: string }>> {
  const out: Record<string, { render_id: string; image_url: string | null; gate: PhotoViewGate; created_at: string }> = {};
  if (photoIds.length === 0) return out;
  const { data, error } = await db.from("renders").select("id, room_photo_id, image_url, gate, created_at").in("room_photo_id", [...photoIds]).eq("mode", "photo_view").order("created_at", { ascending: true });
  if (error) return out;
  for (const r of (data ?? []) as { id: string; room_photo_id: string; image_url: string | null; gate: PhotoViewGate; created_at: string }[]) out[r.room_photo_id] = { render_id: r.id, image_url: r.image_url, gate: r.gate, created_at: r.created_at };
  return out;
}
