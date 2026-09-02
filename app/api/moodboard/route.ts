import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadMoodboard } from "@/lib/moodboard/load";
import {
  isStyleRoom,
  reorder,
  styleDescriptor,
  type MoodboardItem,
} from "@/lib/moodboard/types";
import { getStyleByKey } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// B2 moodboard CRUD. One row per reference; ordering is an integer `position`
// kept dense by the reorder helper. Style items get a derived descriptor at
// write time so the render pipeline never has to reach back into lib/styles.
// =============================================================================

const SELECT_COLS =
  "id, project_id, kind, asset_id, render_id, style_key, style_room, image_url, descriptor, position, created_at";

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

/** GET /api/moodboard?project_id=… */
export async function GET(request: NextRequest) {
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "project_id (uuid) required." }, { status: 400 });
  }
  const items = await loadMoodboard(projectId);
  return NextResponse.json({ items });
}

const AddSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("style"),
    project_id: z.string().uuid(),
    style_key: z.string(),
    style_room: z.string(),
  }),
  z.object({
    kind: z.literal("asset"),
    project_id: z.string().uuid(),
    asset_id: z.string().uuid(),
    descriptor: z.string().max(500).nullish(),
  }),
  z.object({
    kind: z.literal("render"),
    project_id: z.string().uuid(),
    render_id: z.string().uuid(),
    descriptor: z.string().max(500).nullish(),
  }),
]);

/** POST /api/moodboard — add one reference to the end of the board. */
export async function POST(request: NextRequest) {
  try {
    const parsed = AddSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const body = parsed.data;
    const supabase = db();

    // Append: one past the current maximum position.
    const { data: last } = await supabase
      .from("moodboard_items")
      .select("position")
      .eq("project_id", body.project_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle<{ position: number }>();
    const position = (last?.position ?? -1) + 1;

    let row: Record<string, unknown>;
    if (body.kind === "style") {
      if (!getStyleByKey(body.style_key)) {
        return NextResponse.json({ error: `Unknown style key: ${body.style_key}` }, { status: 400 });
      }
      if (!isStyleRoom(body.style_room)) {
        return NextResponse.json({ error: `Unknown style room: ${body.style_room}` }, { status: 400 });
      }
      row = {
        project_id: body.project_id,
        kind: "style",
        style_key: body.style_key,
        style_room: body.style_room,
        // Derived, deterministic — no model involved for built-in art.
        descriptor: styleDescriptor(body.style_key, body.style_room),
        position,
      };
    } else if (body.kind === "asset") {
      row = {
        project_id: body.project_id,
        kind: "asset",
        asset_id: body.asset_id,
        descriptor: body.descriptor ?? null,
        position,
      };
    } else {
      row = {
        project_id: body.project_id,
        kind: "render",
        render_id: body.render_id,
        descriptor: body.descriptor ?? null,
        position,
      };
    }

    const { data, error } = await supabase
      .from("moodboard_items")
      .insert(row)
      .select(SELECT_COLS)
      .single();
    if (error || !data) {
      // The partial unique index rejects the same style image twice.
      if (error?.code === "23505") {
        return NextResponse.json({ error: "That image is already on the board." }, { status: 409 });
      }
      throw error ?? new Error("Failed to add the reference.");
    }
    // Re-read so the caller gets a resolved image_url without a second request.
    const items = await loadMoodboard(body.project_id);
    return NextResponse.json({
      item: items.find((i) => i.id === (data as MoodboardItem).id) ?? data,
      items,
    });
  } catch (err) {
    console.error("[api/moodboard] POST error", err);
    const message = err instanceof Error ? err.message : "Failed to add the reference.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const ReorderSchema = z.object({
  project_id: z.string().uuid(),
  id: z.string().uuid(),
  to_index: z.number().int().min(0),
});

/** PATCH /api/moodboard — move one item to a new index; renumbers densely. */
export async function PATCH(request: NextRequest) {
  try {
    const parsed = ReorderSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { project_id, id, to_index } = parsed.data;
    const supabase = db();

    const { data, error } = await supabase
      .from("moodboard_items")
      .select("id, position, created_at")
      .eq("project_id", project_id);
    if (error || !data) throw error ?? new Error("Failed to read the board.");

    const updates = reorder(
      data as { id: string; position: number; created_at?: string }[],
      id,
      to_index,
    );
    for (const u of updates) {
      const { error: upErr } = await supabase
        .from("moodboard_items")
        .update({ position: u.position })
        .eq("id", u.id);
      if (upErr) throw upErr;
    }
    return NextResponse.json({ items: await loadMoodboard(project_id), moved: updates.length });
  } catch (err) {
    console.error("[api/moodboard] PATCH error", err);
    const message = err instanceof Error ? err.message : "Failed to reorder.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/moodboard?id=… — remove one reference. */
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const id = z.string().uuid().safeParse(url.searchParams.get("id"));
    if (!id.success) {
      return NextResponse.json({ error: "A valid id is required." }, { status: 400 });
    }
    const { error } = await db().from("moodboard_items").delete().eq("id", id.data);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/moodboard] DELETE error", err);
    const message = err instanceof Error ? err.message : "Failed to remove.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
