// =============================================================================
// scripts/lib/b8-context.ts — what the B8 scripts (check-noise calibration and
// the render experiment) share: the dev test bathroom, its five photos, and the
// two designs they are judged against.
//
//   current — the room as it stands (rev 14): a storage cabinet in place of the
//             bidet, a fixed glass panel; the room anchored on Photo 2.
//   b2b     — the room as B2b rendered it (18 Oct): the bidet kept, the hinged
//             screen; no anchor. Rebuilt from the same plan rows by leaving out
//             the cabinet and what it replaces — never written anywhere.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveTarget } from "../_target-guard.mjs";

import { checkItemsFor, type CheckItem } from "@/lib/render/photo-check";
import { loadMiniPlans, loadPhotoViews, type MiniPlan } from "@/lib/render/photo-views-load";
import { styleBriefFrom, type ReferenceStyle } from "@/lib/render/reference-style";
import { loadRoomAnchor } from "@/lib/render/photo-view-anchor";
import type { RoomAnchor } from "@/lib/render/room-spec";
import { specElements } from "@/lib/render/room-spec";
import { wetRoomChoicesOf } from "@/lib/boq/wet-room";
import type { StyleBrief } from "@/lib/render/photo-restyle";
import type { PhotoView } from "@/lib/render/photo-views";

export const P = "a2661f34-9d96-4020-a755-40359440c302";
export const ROOM = "4ca01776-3251-4436-aaa0-e2e74257341c";
export const EVAL_DIR = "data/Bathroom Pilot/b8-eval";

export interface Design {
  key: "current" | "b2b";
  plan: MiniPlan;
  items: CheckItem[];
  /** Items the design changes the size of (the fixed panel): place held, size free. */
  resizable: Set<string>;
  notes: string[];
}

export interface B8Context {
  db: SupabaseClient;
  views: PhotoView[];
  current: Design;
  b2b: Design;
  /** The client's references in words (B2), the look for an unanchored view. */
  references: StyleBrief;
  /** The first three whole-room reference images (B2b's image refs). */
  referenceUrls: string[];
  anchor: (RoomAnchor & { image_url: string; bytes: Uint8Array; style: StyleBrief }) | null;
}

export async function loadB8Context(script: string): Promise<B8Context> {
  const { url, key } = resolveTarget({ script, writes: true });
  const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseClient;
  const { data: plan } = await db.from("plans").select("id, total_area_m2, source, plot_width_m").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single();
  const mini = (await loadMiniPlans(db, P, plan!, [ROOM]))[ROOM]!;
  const views = (await loadPhotoViews(db, [ROOM]))[ROOM]!;
  const { data: roomRow } = await db.from("rooms").select("spec").eq("id", ROOM).single<{ spec: Record<string, unknown> | null }>();

  const currentItems = checkItemsFor(mini);
  const current: Design = { key: "current", plan: mini, items: currentItems, resizable: new Set(), notes: [] };
  if (wetRoomChoicesOf(roomRow?.spec ?? null).shower_screen === "fixed_panel") {
    for (const it of currentItems) if (it.kind === "shower") current.resizable.add(it.ref);
    current.notes.push("The shower has ONE fixed frameless walk-in glass panel — no hinged glass door, no second panel; the shower is open at its end. Keep the shower where it is.");
  }

  // B2b's design: every plumbing fixture as it was — the bidet back, no cabinet, no replacement.
  const { data: rawFx } = await db.from("plan_fixtures").select("id, type, position, spec, room_id").eq("project_id", P).eq("layer", "plumbing").eq("room_id", ROOM);
  const oldFixtures = ((rawFx ?? []) as { id: string; type: string; position: [number, number]; spec: Record<string, unknown> | null }[])
    .filter((f) => f.type !== "storage_cabinet" && f.type !== "shattaf_point")
    .map((f) => ({ id: f.id, type: f.type, position: f.position, spec: f.spec ? Object.fromEntries(Object.entries(f.spec).filter(([k]) => k !== "replaces" && k !== "replaces_fixture_id" && k !== "height_mm")) : null }));
  const oldPlan: MiniPlan = { ...mini, fixtures: oldFixtures };
  const b2b: Design = { key: "b2b", plan: oldPlan, items: checkItemsFor(oldPlan), resizable: new Set(), notes: [] };

  const { data: brief } = await db.from("project_briefs").select("reference_style").eq("project_id", P).maybeSingle<{ reference_style: ReferenceStyle | null }>();
  const references = styleBriefFrom(brief?.reference_style ?? null, null);
  let referenceUrls: string[] = [];
  if (brief?.reference_style?.item_ids?.length) {
    const { data: assets } = await db.from("project_assets").select("id, storage_path").in("id", brief.reference_style.item_ids.slice(0, 3));
    referenceUrls = ((assets ?? []) as { storage_path: string }[]).map((a) => db.storage.from("plan-uploads").getPublicUrl(a.storage_path).data.publicUrl);
  }

  const a = await loadRoomAnchor(db, ROOM);
  let anchor: B8Context["anchor"] = null;
  if (a) {
    const { data: ar } = await db.from("renders").select("image_url").eq("id", a.render_id).single<{ image_url: string }>();
    const elements = specElements(a.spec);
    anchor = { ...a, image_url: ar!.image_url, bytes: new Uint8Array(await (await fetch(ar!.image_url)).arrayBuffer()), style: { text: elements.map((e) => `${e.element}: ${e.finish}`).join("; ") + ".", source: "anchor", line: "", elements } };
  }
  return { db, views, current, b2b, references, referenceUrls, anchor };
}

export const bytesOf = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
export const mime = (b: Uint8Array): "image/jpeg" | "image/png" => (b[0] === 0x89 ? "image/png" : "image/jpeg");
export const img = (b: Uint8Array) => ({ mediaType: mime(b), data: Buffer.from(b).toString("base64") });
