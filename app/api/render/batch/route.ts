import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { gardenStyleFor, isGardenStyleKey } from "@/lib/garden-styles";
import { gardenPresetItems } from "@/lib/moodboard/types";
import { loadRenders } from "@/lib/render-batch/load";
import { planBatch, planSceneBatch, type BatchFixture, type BatchRoom, type SceneRenderRow } from "@/lib/render-batch/plan";
import { loadGardenSceneContext } from "@/lib/scene-render/pipeline";
import { tasteSeedEnabled } from "@/lib/render-grounding";
import { IN_FLIGHT_CAP } from "@/lib/render-image";
import { isExteriorRoomType, roomTypeFromDb } from "@/lib/render-prompts";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// G4 "Generate all" — Newspace ask #2.
//
// This route PLANS the batch and prepares the project for it; it does not hold
// a queue. Every job is then run through the existing single-render routes
// (/api/render for a day view, /api/render/evening for an evening view), so the
// cache, the per-project in-flight cap, the QA gate and the rehosting all apply
// exactly as they do to one render — a batch is not a second pipeline. A job
// already done is reported as done, so pressing the button twice costs nothing.
//
// Preparation = the exterior style preset. With TASTE_SEED_ENABLED on, a
// garden project whose moodboard is EMPTY is seeded with its direction's
// garden + structure art, so every zone in the batch is conditioned on the same
// references and the zones read as one garden. Never onto a board the user has
// already built, and never onto a project with interior rooms (the taste seed
// is project-wide, and a bedroom must not be conditioned on a lawn).

const BodySchema = z.object({ project_id: z.string().uuid() });

type Preset =
  | { seeded: true; style_key: string }
  | { seeded: false; style_key: string | null; reason: string };

export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { project_id } = parsed.data;
    const supabase = getSupabaseAdmin() as unknown as SupabaseClient;

    const { data: project } = await supabase.from("projects").select("id").eq("id", project_id).maybeSingle();
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const { data: styleRows } = await supabase
      .from("style_choices")
      .select("style_key")
      .eq("project_id", project_id)
      .is("room_id", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const styleKey = (styleRows?.[0]?.style_key as string | undefined) ?? null;
    if (!styleKey) {
      return NextResponse.json({ error: "Pick a style direction before rendering." }, { status: 400 });
    }

    const { data: plan } = await supabase
      .from("plans")
      .select("id")
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!plan) return NextResponse.json({ error: "No plan attached to this project yet." }, { status: 400 });

    const [roomsRes, rendersRes, fixturesRes] = await Promise.all([
      supabase.from("rooms").select("id, name_en, room_type, polygon").eq("plan_id", plan.id).order("name_en"),
      loadRenders(supabase, project_id),
      supabase.from("plan_fixtures").select("type, room_id, position, spec").eq("project_id", project_id),
    ]);
    const rooms = (roomsRes.data ?? []) as BatchRoom[];

    const preset = await prepareGardenPreset(supabase, project_id, styleKey, rooms);

    // G4b: a garden is rendered by camera through the plan-faithful pipeline —
    // every zone's camera plus the whole-garden views.
    const renderable = rooms.map((r) => roomTypeFromDb(r.room_type)).filter((t) => t !== null);
    const gardenOnly = renderable.length > 0 && renderable.every((t) => isExteriorRoomType(t));
    let jobs;
    if (gardenOnly) {
      const ctx = await loadGardenSceneContext(project_id);
      const { data: sceneRows } = await supabase
        .from("renders")
        .select("id, camera, view, status")
        .eq("project_id", project_id)
        .eq("mode", "scene");
      jobs = planSceneBatch(
        ctx.cameras.map((c) => ({ id: c.id, label: c.label, zone_id: c.zoneId, lit: c.lit })),
        (sceneRows ?? []) as SceneRenderRow[],
      );
    } else {
      jobs = planBatch({
        rooms,
        renders: rendersRes,
        fixtures: (fixturesRes.data ?? []) as BatchFixture[],
      });
    }

    return NextResponse.json({ jobs, preset, cap: IN_FLIGHT_CAP });
  } catch (err) {
    console.error("[api/render/batch] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Batch planning failed." },
      { status: 500 },
    );
  }
}

async function prepareGardenPreset(
  supabase: SupabaseClient,
  projectId: string,
  styleKey: string,
  rooms: BatchRoom[],
): Promise<Preset> {
  const renderable = rooms.map((r) => roomTypeFromDb(r.room_type)).filter((t) => t !== null);
  const exterior = renderable.filter((t) => isExteriorRoomType(t));
  if (exterior.length === 0) return { seeded: false, style_key: null, reason: "no exterior zones" };

  const presetKey = isGardenStyleKey(styleKey) ? styleKey : gardenStyleFor(styleKey);
  if (!tasteSeedEnabled()) {
    return { seeded: false, style_key: presetKey, reason: "TASTE_SEED_ENABLED is off" };
  }
  if (exterior.length !== renderable.length) {
    return { seeded: false, style_key: presetKey, reason: "project has interior rooms; the taste seed is project-wide" };
  }

  const { count, error } = await supabase
    .from("moodboard_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) return { seeded: false, style_key: presetKey, reason: "moodboard table unavailable" };
  if ((count ?? 0) > 0) {
    return { seeded: false, style_key: presetKey, reason: "moodboard already has references" };
  }

  const items = gardenPresetItems(presetKey);
  if (!items) return { seeded: false, style_key: presetKey, reason: "no preset for this direction" };
  const { error: insErr } = await supabase
    .from("moodboard_items")
    .insert(items.map((i) => ({ ...i, project_id: projectId })));
  if (insErr) return { seeded: false, style_key: presetKey, reason: insErr.message };
  return { seeded: true, style_key: presetKey };
}
