import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { AnalyticsEvent, trackServer } from "@/lib/analytics";
import {
  buildEveningPrompt,
  currentDayRender,
  lightingByZone,
  wantsEvening,
  type BatchFixture,
  type BatchRender,
} from "@/lib/render-batch/plan";
import {
  buildEditInput,
  createRenderPrediction,
  getRenderModel,
  IN_FLIGHT_CAP,
  IN_FLIGHT_WINDOW_MS,
} from "@/lib/render-image";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// G4: the evening view of a lit exterior zone.
//
// An EDIT of the zone's current day render, never a fresh generation — the
// evening has to be the same garden with the lights on, not a second garden.
// The instruction is deterministic (buildEveningPrompt), names only the
// lighting designed for the zone, and is the cache key together with the
// parent: the same day render with the same lighting is never paid for twice.
// Finalised by /api/render/status like every other render (QA runs; no
// auto-retry, as for a tweak).

const BodySchema = z.object({
  project_id: z.string().uuid(),
  room_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { project_id, room_id } = parsed.data;

    const apiKey = process.env.REPLICATE_API_TOKEN;
    if (!apiKey) {
      return NextResponse.json({ error: "REPLICATE_API_TOKEN is not configured." }, { status: 500 });
    }

    const supabase = getSupabaseAdmin() as unknown as SupabaseClient;

    const { data: room } = await supabase
      .from("rooms")
      .select("id, name_en, room_type, polygon, plan_id")
      .eq("id", room_id)
      .maybeSingle<{ id: string; name_en: string | null; room_type: string | null; polygon: unknown; plan_id: string }>();
    if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });

    // The view column is what tells an evening render from a tweak; without
    // migration 035 there is nowhere to record it, so say so rather than write
    // a render that would later read as the zone's day view.
    const { data: renderRows, error: renderErr } = await supabase
      .from("renders")
      .select("id, room_id, status, image_url, parent_render_id, view, created_at")
      .eq("room_id", room_id)
      .eq("project_id", project_id);
    if (renderErr) {
      return NextResponse.json(
        { error: "Evening views need migration 035 (renders.view).", code: "migration_required" },
        { status: 503 },
      );
    }
    const renders = (renderRows ?? []) as BatchRender[];

    const { data: fixtureRows } = await supabase
      .from("plan_fixtures")
      .select("type, room_id, position, spec")
      .eq("project_id", project_id);
    // Lighting is assigned across every zone on the plan, so a boundary light
    // on a shared edge lands on exactly one of them.
    const { data: planRooms } = await supabase
      .from("rooms")
      .select("id, name_en, room_type, polygon")
      .eq("plan_id", room.plan_id);
    const lights =
      lightingByZone(planRooms ?? [room], (fixtureRows ?? []) as BatchFixture[]).get(room.id) ?? [];

    if (!wantsEvening(room, lights)) {
      return NextResponse.json(
        {
          error: `'${room.name_en ?? "This zone"}' has no lighting on the plan, so it has no evening view. Place its lighting points on the plan first.`,
          code: "no_lighting",
        },
        { status: 422 },
      );
    }

    const day = currentDayRender(renders, room.id);
    if (!day) {
      return NextResponse.json(
        { error: "Render the day view first — the evening view is an edit of it.", code: "day_required" },
        { status: 409 },
      );
    }

    const prompt = buildEveningPrompt({ roomType: room.room_type, lights });

    const { data: cached } = await supabase
      .from("renders")
      .select("id, image_url, prompt")
      .eq("room_id", room_id)
      .eq("view", "evening")
      .eq("parent_render_id", day.id)
      .eq("prompt", prompt)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; image_url: string | null; prompt: string }>();
    if (cached?.image_url) {
      return NextResponse.json({
        render_id: cached.id,
        image_url: cached.image_url,
        prompt: cached.prompt,
        view: "evening",
        parent_render_id: day.id,
        cached: true,
      });
    }

    const sinceIso = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString();
    const { count: inFlight } = await supabase
      .from("renders")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("status", "pending")
      .gte("created_at", sinceIso);
    if ((inFlight ?? 0) >= IN_FLIGHT_CAP) {
      return NextResponse.json(
        { error: `Too many renders in progress (max ${IN_FLIGHT_CAP} at once). Wait for one to finish.` },
        { status: 429 },
      );
    }

    const model = getRenderModel();
    let prediction;
    try {
      prediction = await createRenderPrediction(apiKey, model, buildEditInput(model, prompt, [day.image_url!]));
    } catch (err) {
      console.error("[api/render/evening] prediction create error", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Replicate call failed." },
        { status: 502 },
      );
    }

    const { data: row, error: insertErr } = await supabase
      .from("renders")
      .insert({
        project_id,
        room_id,
        prompt,
        image_url: null,
        parent_render_id: day.id,
        source_image_url: day.image_url,
        model,
        mode: "tweak",
        view: "evening",
        prediction_id: prediction.id,
        status: "pending",
      })
      .select("id")
      .single<{ id: string }>();
    if (insertErr || !row) {
      console.error("[api/render/evening] insert error", insertErr);
      return NextResponse.json({ error: insertErr?.message ?? "Failed to save render." }, { status: 500 });
    }

    void trackServer(AnalyticsEvent.RenderStarted, { projectId: project_id, room_id, model, mode: "evening" });

    return NextResponse.json({
      render_id: row.id,
      prediction_id: prediction.id,
      status: "pending",
      prompt,
      view: "evening",
      parent_render_id: day.id,
    });
  } catch (err) {
    console.error("[api/render/evening] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Evening render failed." },
      { status: 500 },
    );
  }
}
