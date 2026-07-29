import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import Replicate from "replicate";
import { z } from "zod";

import { AnalyticsEvent, trackServer } from "@/lib/analytics";
import { getKgContext } from "@/lib/kg/context";
import {
  buildBaseInput,
  buildEditInput,
  createRenderPrediction,
  extractImageUrl,
  getRenderModel,
  IN_FLIGHT_CAP,
  IN_FLIGHT_WINDOW_MS,
  MODEL_OFFPLAN_BASE,
  runWithTimeout,
} from "@/lib/render-image";
import {
  buildMaterialsClause,
  fetchSelectedMaterials,
  loadMoodboardDataUri,
} from "@/lib/render-grounding";
import {
  STYLE_KEYS,
  buildEditPrompt,
  buildOffplanBasePrompt,
  roomTypeFromDb,
  type StyleKey,
} from "@/lib/render-prompts";
import { buildStagingBlock } from "@/lib/staging/prompt";
import { stagingRoomTypeFromDb, type StagingSet } from "@/lib/staging/sets";
import { roomDimensions } from "@/lib/room-geometry";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  project_id: z.string().uuid(),
  room_id: z.string().uuid(),
  tweak: z.string().min(1).max(500).optional(),
});

const VALID_STYLE_KEYS = new Set<string>(STYLE_KEYS);

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 },
      );
    }
    const { project_id, room_id, tweak } = parsed.data;

    const apiKey = process.env.REPLICATE_API_TOKEN;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "REPLICATE_API_TOKEN is not configured. Add it to .env.local and restart the dev server.",
        },
        { status: 500 },
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", project_id)
      .maybeSingle();
    if (!project) {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 },
      );
    }

    const { data: room } = await supabase
      .from("rooms")
      .select("id, room_type, polygon, area_m2")
      .eq("id", room_id)
      .maybeSingle();
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const { data: styleRows } = await supabase
      .from("style_choices")
      .select("style_key")
      .eq("project_id", project_id)
      .is("room_id", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const styleKey = styleRows?.[0]?.style_key ?? null;
    if (!styleKey) {
      return NextResponse.json(
        { error: "Pick a style direction before rendering." },
        { status: 400 },
      );
    }
    if (!VALID_STYLE_KEYS.has(styleKey)) {
      return NextResponse.json(
        { error: `Style '${styleKey}' has no prompt template.` },
        { status: 400 },
      );
    }

    const promptRoomType = roomTypeFromDb(room.room_type);
    if (!promptRoomType) {
      return NextResponse.json(
        {
          error: `Room type '${room.room_type ?? "unknown"}' is outside the first-floor scope; rendering is only supported for bedroom, bathroom, and living rooms.`,
        },
        { status: 400 },
      );
    }

    // Compose the restyle prompt: style template + selected-SKU materials +
    // (optional) KG context + (optional) tweak. Everything that changes the
    // output goes into `prompt` so the cache key below is exact.
    let prompt = buildEditPrompt({
      styleKey: styleKey as StyleKey,
      roomType: promptRoomType,
    });

    // Material grounding: append a Materials: clause listing the user's chosen
    // vendor SKUs. Best-effort — no selections (or no table) yields "".
    const materials = await fetchSelectedMaterials(
      supabase as unknown as SupabaseClient,
      project_id,
    );
    const materialsClause = buildMaterialsClause(materials);
    if (materialsClause) {
      prompt = `${prompt} ${materialsClause}`;
    }

    if (tweak && tweak.trim()) {
      prompt = `${prompt} — modified: ${tweak.trim()}`;
    }

    // KG grounding (feature-flagged, safe fallback). getKgContext never throws.
    const { context: kgContext, bundleId: kgBundleId } = await getKgContext({
      styleKey,
      project,
    });
    if (kgContext) {
      prompt = `${prompt}\n\n${kgContext}`;
      console.log(
        `[api/render] KG context injected (bundle=${kgBundleId}) — composed prompt:\n${prompt}`,
      );
    }

    // P7 furniture staging (flagged). Appended AFTER the KG context so real KG
    // fixtures keep precedence for fixed elements — staging only dresses movable
    // furniture. Persisted to renders.staging_set for tracing + the optional BoQ
    // feed. Staging only appends to the prompt (which is the cache key), so
    // caching + the tweak/iterate flow are untouched: flag off vs on simply
    // produce two distinct prompts → two distinct cache entries.
    let stagingSet: StagingSet | null = null;
    if (process.env.STAGING_ENABLED === "true") {
      const stagingRoom = stagingRoomTypeFromDb(room.room_type);
      const staging = stagingRoom
        ? buildStagingBlock(styleKey, stagingRoom)
        : null;
      if (staging) {
        prompt = `${prompt}\n\n${staging.block}`;
        stagingSet = staging.set;
      }
    }

    // Latest uploaded photo for this room, if any. Its presence decides the
    // pipeline path (and therefore the cache key).
    const { data: photo } = await supabase
      .from("room_photos")
      .select("public_url")
      .eq("room_id", room_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const photoUrl = photo?.public_url ?? null;
    const mode: "photo" | "offplan" = photoUrl ? "photo" : "offplan";

    // Cache check: identical prompt AND path for this room → return the prior
    // render instead of paying Replicate again (and, for the off-plan path,
    // skips the base-image generation too). Keying on `mode` stops a stale
    // off-plan render from being served after a photo is uploaded; for the
    // photo path we additionally require the same source photo so replacing
    // the photo forces a fresh render.
    let cacheQuery = supabase
      .from("renders")
      .select("id, image_url, prompt")
      .eq("room_id", room_id)
      .eq("prompt", prompt)
      .eq("mode", mode)
      .eq("status", "succeeded");
    if (photoUrl) {
      cacheQuery = cacheQuery.eq("source_image_url", photoUrl);
    }
    const { data: existing } = await cacheQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && existing.image_url && existing.prompt) {
      return NextResponse.json({
        render_id: existing.id,
        image_url: existing.image_url,
        prompt: existing.prompt,
        mode,
        cached: true,
      });
    }

    // In-flight cap: at most IN_FLIGHT_CAP pending renders per project (within
    // the staleness window). Protects Replicate spend and keeps the UI honest.
    const sinceIso = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString();
    const { count: inFlight } = await supabase
      .from("renders")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("status", "pending")
      .gte("created_at", sinceIso);
    if ((inFlight ?? 0) >= IN_FLIGHT_CAP) {
      return NextResponse.json(
        {
          error: `Too many renders in progress (max ${IN_FLIGHT_CAP} at once). Wait for one to finish.`,
        },
        { status: 429 },
      );
    }

    const replicate = new Replicate({ auth: apiKey });
    const editModel = getRenderModel();

    // The moodboard style reference (data URI) is passed to nano-banana as a
    // second image input. null when the file is missing.
    const moodboardDataUri = await loadMoodboardDataUri(
      styleKey,
      promptRoomType,
    );

    // Resolve the source image the edit pass restyles.
    //   - photo present  → restyle the real room photo (mode "photo").
    //   - no photo       → synthesise an empty-room shell with the base model
    //                      first, then restyle it (mode "offplan").
    let sourceImageUrl: string;

    if (photoUrl) {
      sourceImageUrl = photoUrl;
    } else {
      const dims = roomDimensions(room);
      const basePrompt = buildOffplanBasePrompt({
        roomType: promptRoomType,
        widthM: dims?.widthM,
        depthM: dims?.depthM,
      });
      try {
        const baseOutput = await runWithTimeout(
          replicate.run(MODEL_OFFPLAN_BASE, {
            input: buildBaseInput(basePrompt),
          }),
        );
        sourceImageUrl = extractImageUrl(baseOutput);
      } catch (err) {
        console.error("[api/render] base image error", err);
        const message =
          err instanceof Error ? err.message : "Base image generation failed.";
        const isTimeout = message.includes("timed out");
        return NextResponse.json(
          { error: message },
          { status: isTimeout ? 504 : 502 },
        );
      }
    }

    // Style/restyle pass — kicked off as an async prediction so the client can
    // poll /api/render/status for progress instead of holding one long request.
    const editImages = moodboardDataUri
      ? [sourceImageUrl, moodboardDataUri]
      : [sourceImageUrl];

    let prediction;
    try {
      prediction = await createRenderPrediction(
        apiKey,
        editModel,
        buildEditInput(editModel, prompt, editImages),
      );
    } catch (err) {
      console.error("[api/render] prediction create error", err);
      const message =
        err instanceof Error ? err.message : "Replicate call failed.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Persist a PENDING row now; /api/render/status finalises it (image_url +
    // QA) when the prediction completes.
    const { data: renderRow, error: insertErr } = await supabase
      .from("renders")
      .insert({
        project_id,
        room_id,
        prompt,
        image_url: null,
        parent_render_id: null,
        source_image_url: sourceImageUrl,
        model: editModel,
        mode,
        prediction_id: prediction.id,
        status: "pending",
        // Only include kg_bundle_id when KG grounding actually ran.
        ...(kgBundleId ? { kg_bundle_id: kgBundleId } : {}),
      })
      .select("id")
      .single();

    if (insertErr || !renderRow) {
      console.error("[api/render] insert error", insertErr);
      return NextResponse.json(
        { error: insertErr?.message ?? "Failed to save render." },
        { status: 500 },
      );
    }

    // P7: record which staging set dressed this render — best-effort in a
    // separate update so the render flow is untouched whether or not migration
    // 021 (renders.staging_set) has been applied.
    if (stagingSet) {
      try {
        await supabase
          .from("renders")
          .update({ staging_set: stagingSet })
          .eq("id", renderRow.id);
      } catch {
        /* staging_set column absent → traced only via the prompt */
      }
    }

    void trackServer(AnalyticsEvent.RenderStarted, {
      projectId: project_id,
      room_id,
      model: editModel,
      mode,
    });

    return NextResponse.json({
      render_id: renderRow.id,
      prediction_id: prediction.id,
      status: "pending",
      prompt,
      mode,
      model: editModel,
    });
  } catch (err) {
    console.error("[api/render] error", err);
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Render failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
