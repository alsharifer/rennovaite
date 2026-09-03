import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadSelections } from "@/lib/accessories/load";
import { loadPickerData } from "@/lib/accessories/picker-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// D1 accessory selection.
//
// GET returns, per item_key: the RULE-DERIVED DEFAULT (what the engine assumed
// before anyone chose anything), the take-off QUANTITY (read-only — users pick
// WHAT, the engine computes HOW MANY), the catalogue alternatives by spec
// class, and the project's current selection. All of it via loadPickerData, so
// the page and this route can never disagree about the default.
// =============================================================================

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

export async function GET(request: NextRequest) {
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "project_id (uuid) required." }, { status: 400 });
  }
  try {
    return NextResponse.json(await loadPickerData(projectId));
  } catch (err) {
    console.error("[api/accessories] GET error", err);
    const message = err instanceof Error ? err.message : "Failed to load accessories.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const SelectSchema = z.object({
  project_id: z.string().uuid(),
  item_key: z.string().min(1),
  catalog_item_id: z.string().uuid(),
});

/** POST — choose a catalogue item for one BoQ line. */
export async function POST(request: NextRequest) {
  try {
    const parsed = SelectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { project_id, item_key, catalog_item_id } = parsed.data;

    // The catalogue row must actually price this item_key — otherwise a
    // selection would silently re-rate the wrong line.
    const { data: item, error: itemErr } = await db()
      .from("accessory_catalog")
      .select("id, item_key, scope")
      .eq("id", catalog_item_id)
      .maybeSingle<{ id: string; item_key: string; scope: string }>();
    if (itemErr || !item) {
      return NextResponse.json({ error: "Catalogue item not found." }, { status: 404 });
    }
    if (item.item_key !== item_key) {
      return NextResponse.json(
        { error: `That item prices "${item.item_key}", not "${item_key}".` },
        { status: 400 },
      );
    }
    if (item.scope === "install_only") {
      return NextResponse.json(
        { error: "An install_only item cannot be selected — it would double-count." },
        { status: 400 },
      );
    }

    const { error } = await db()
      .from("accessory_selections")
      .upsert(
        { project_id, item_key, catalog_item_id, selected_at: new Date().toISOString() },
        { onConflict: "project_id,item_key" },
      );
    if (error) throw error;

    return NextResponse.json({ selections: await loadSelections(project_id) });
  } catch (err) {
    console.error("[api/accessories] POST error", err);
    const message = err instanceof Error ? err.message : "Failed to save the selection.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE — deselect, returning that line to its rule-derived default. */
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("project_id");
    const itemKey = url.searchParams.get("item_key");
    if (!projectId || !z.string().uuid().safeParse(projectId).success || !itemKey) {
      return NextResponse.json(
        { error: "project_id (uuid) and item_key are required." },
        { status: 400 },
      );
    }
    const { error } = await db()
      .from("accessory_selections")
      .delete()
      .eq("project_id", projectId)
      .eq("item_key", itemKey);
    if (error) throw error;
    return NextResponse.json({ selections: await loadSelections(projectId) });
  } catch (err) {
    console.error("[api/accessories] DELETE error", err);
    const message = err instanceof Error ? err.message : "Failed to deselect.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
