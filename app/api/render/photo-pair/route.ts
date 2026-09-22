import { NextResponse, type NextRequest } from "next/server";
import { NotCachedError } from "@/lib/scene-render/pipeline";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { renderPhotoPair } from "@/lib/scene-render/photo-pair-run";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// G5: before/after pairs from the client's own photos. POST makes (or returns the
// cached) pair for one photo; GET lists the project's pairs with their outcome.

const PostSchema = z.object({
  project_id: z.string().uuid(),
  asset_id: z.string().uuid(),
  zone_id: z.string().uuid(),
  /** The existing items this photo shows (zones, runs, trees) — the pair's manifest. */
  item_ids: z.array(z.string().uuid()).max(30).default([]),
  /** T5: answer from cache only; never render. */
  cache_only: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  if (process.env.GARDEN_PILOT_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const r = await renderPhotoPair({ projectId: parsed.data.project_id, assetId: parsed.data.asset_id, zoneId: parsed.data.zone_id, itemIds: parsed.data.item_ids, cacheOnly: parsed.data.cache_only === true });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof NotCachedError) return NextResponse.json({ outcome: "not_cached", cached: false, render_id: null, attempts: [] });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Photo pair failed." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (process.env.GARDEN_PILOT_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) return NextResponse.json({ error: "project_id (uuid) required." }, { status: 400 });
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const { data, error } = await sb
    .from("renders")
    .select("id, room_id, camera, image_url, source_image_url, gate, created_at")
    .eq("project_id", projectId)
    .eq("mode", "photo_pair")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    pairs: (data ?? []).map((r: { id: string; room_id: string | null; camera: string; image_url: string; source_image_url: string; gate: { outcome?: string; zone_name?: string } | null; created_at: string }) => ({
      id: r.id,
      zone_id: r.room_id,
      zone: r.gate?.zone_name ?? null,
      photo: r.camera,
      before: r.source_image_url,
      after: r.gate?.outcome === "passed" ? r.image_url : null,
      outcome: r.gate?.outcome ?? "unknown",
      created_at: r.created_at,
    })),
  });
}
