// =============================================================================
// lib/moodboard/load.ts — server-side moodboard reads.
//
// Resolves each item to a usable image URL: style art is a static /public path,
// asset items resolve through the project_assets storage path, render items
// through renders.image_url. Every read degrades to [] when migration 027 has
// not been applied, so the moodboard step shows an empty state rather than an
// error.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { publicUrlForPath } from "@/lib/assets/load";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import {
  isStyleRoom,
  sortItems,
  styleImagePath,
  type MoodboardItem,
} from "./types";

const SELECT_COLS =
  "id, project_id, kind, asset_id, render_id, style_key, style_room, image_url, descriptor, position, created_at";

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

/**
 * Fill in each item's image_url from its underlying record. Style art needs no
 * lookup; assets and renders are batched into one query each. An item whose
 * source has gone (deleted asset/render) keeps a null url and the callers skip
 * it rather than rendering a broken tile.
 */
async function resolveUrls(
  supabase: SupabaseClient,
  items: MoodboardItem[],
): Promise<MoodboardItem[]> {
  const assetIds = items.filter((i) => i.kind === "asset" && i.asset_id).map((i) => i.asset_id!);
  const renderIds = items.filter((i) => i.kind === "render" && i.render_id).map((i) => i.render_id!);

  const assetPaths = new Map<string, string>();
  if (assetIds.length > 0) {
    const { data } = await supabase
      .from("project_assets")
      .select("id, storage_path")
      .in("id", assetIds);
    for (const a of (data ?? []) as { id: string; storage_path: string }[]) {
      assetPaths.set(a.id, a.storage_path);
    }
  }

  const renderUrls = new Map<string, string | null>();
  if (renderIds.length > 0) {
    const { data } = await supabase.from("renders").select("id, image_url").in("id", renderIds);
    for (const r of (data ?? []) as { id: string; image_url: string | null }[]) {
      renderUrls.set(r.id, r.image_url);
    }
  }

  return items.map((i) => {
    if (i.kind === "style" && i.style_key) {
      const room = isStyleRoom(i.style_room) ? i.style_room : "living";
      return { ...i, image_url: styleImagePath(i.style_key, room) };
    }
    if (i.kind === "asset" && i.asset_id) {
      const p = assetPaths.get(i.asset_id);
      return { ...i, image_url: p ? publicUrlForPath(p) : null };
    }
    if (i.kind === "render" && i.render_id) {
      return { ...i, image_url: renderUrls.get(i.render_id) ?? null };
    }
    return i;
  });
}

/** A project's moodboard in display order. `[]` when the table is absent. */
export async function loadMoodboard(projectId: string): Promise<MoodboardItem[]> {
  try {
    const supabase = db();
    const { data, error } = await supabase
      .from("moodboard_items")
      .select(SELECT_COLS)
      .eq("project_id", projectId);
    if (error || !data) {
      if (error) console.warn("[moodboard/load] degraded:", error.message);
      return [];
    }
    return sortItems(await resolveUrls(supabase, data as MoodboardItem[]));
  } catch (e) {
    console.warn("[moodboard/load] degraded:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Items that carry a usable image — what the render pipeline may condition on. */
export function seedableItems(items: MoodboardItem[]): MoodboardItem[] {
  return items.filter((i) => typeof i.image_url === "string" && i.image_url.length > 0);
}
