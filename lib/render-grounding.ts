// Material grounding for the render pipeline.
//
// Two grounding signals feed the edit model so a render reflects real,
// purchasable choices rather than a generic style guess:
//
//   1. The chosen style's moodboard image (public/moodboards/<key>-<room>.png),
//      passed as a second image input so nano-banana anchors palette + texture.
//   2. The user's selected vendor SKUs (vendor_selections → pricing_skus),
//      appended to the prompt as a "Materials:" clause.
//
// Both are best-effort: a missing moodboard or a missing vendor_selections
// table returns null/[] and the render proceeds ungrounded.

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RoomType } from "@/lib/render-prompts";

// RoomType → moodboard filename room segment. Moodboards only cover four room
// buckets; master and secondary bedrooms share the "bedroom"/"secondary-
// bedroom" art already generated in public/moodboards.
const MOODBOARD_ROOM: Record<RoomType, string> = {
  "master-bedroom": "bedroom",
  "secondary-bedroom": "secondary-bedroom",
  bathroom: "bathroom",
  living: "living",
};

// Read the chosen style's moodboard from public/moodboards and return it as a
// base64 data URI. Replicate fetches image inputs from its own servers, so a
// localhost /moodboards URL is unreachable — a data URI is the reliable way to
// hand a local asset to the model. Returns null if the file is missing.
export async function loadMoodboardDataUri(
  styleKey: string,
  roomType: RoomType,
): Promise<string | null> {
  const room = MOODBOARD_ROOM[roomType];
  if (!room) return null;
  const file = path.join(
    process.cwd(),
    "public",
    "moodboards",
    `${styleKey}-${room}.png`,
  );
  try {
    const bytes = await readFile(file);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

type SkuRow = { description_en: string | null; brand: string | null };

// Descriptions of the SKUs the user has selected for this project. Reads
// vendor_selections (project-wide, keyed per BoQ line) → pricing_skus. Returns
// [] on any failure (table missing, no selections) so rendering never breaks.
export async function fetchSelectedMaterials(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string[]> {
  try {
    const { data: sel, error: selErr } = await supabase
      .from("vendor_selections")
      .select("sku_id")
      .eq("project_id", projectId);
    if (selErr || !sel || sel.length === 0) return [];

    const skuIds = Array.from(
      new Set(
        (sel as { sku_id: string | null }[])
          .map((r) => r.sku_id)
          .filter((v): v is string => typeof v === "string"),
      ),
    );
    if (skuIds.length === 0) return [];

    const { data: skus, error: skuErr } = await supabase
      .from("pricing_skus")
      .select("description_en, brand")
      .in("id", skuIds);
    if (skuErr || !skus) return [];

    const descriptions: string[] = [];
    for (const s of skus as SkuRow[]) {
      const desc = s.description_en?.trim();
      if (!desc) continue;
      const brand = s.brand?.trim();
      // Prepend the brand only when the description doesn't already lead with
      // it (some SKUs bake the brand into description_en).
      const prefixed =
        brand && !desc.toLowerCase().startsWith(brand.toLowerCase())
          ? `${brand} ${desc}`
          : desc;
      descriptions.push(prefixed);
    }
    return descriptions;
  } catch {
    return [];
  }
}

// Format the selected SKU descriptions as a prompt clause. Returns "" when
// there are no selections so callers can concatenate unconditionally.
export function buildMaterialsClause(descriptions: string[]): string {
  if (descriptions.length === 0) return "";
  // Cap the list so the clause can't dominate the prompt on a fully-specified
  // project; the first selections carry the strongest signal.
  const shown = descriptions.slice(0, 12);
  return `Materials: use these specified products — ${shown.join("; ")}.`;
}
