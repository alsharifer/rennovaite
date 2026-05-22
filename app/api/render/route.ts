import { NextResponse, type NextRequest } from "next/server";
import Replicate from "replicate";
import { z } from "zod";

import {
  buildControlImageBase64,
  buildDepthControlImageBase64,
} from "@/lib/control-image";
import {
  STYLE_KEYS,
  buildRenderPrompt,
  roomTypeFromDb,
  type StyleKey,
} from "@/lib/render-prompts";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const REPLICATE_TIMEOUT_MS = 90_000;
const MODEL_CANNY = "black-forest-labs/flux-canny-pro";
const MODEL_DEPTH = "black-forest-labs/flux-depth-pro";

// Replicate output URLs are presigned + TTL-bound (~1 hour). Persisting them
// directly into `renders.image_url` means every consumer of that field
// (dashboard, /my-projects, project hub, render workspace) breaks once the
// signature expires. We re-host into Supabase Storage so the URL is stable.
const RENDER_BUCKET = "renders";
const RENDER_FETCH_TIMEOUT_MS = 30_000;

// Lower than the default 30 so the prompt's style/room cues have more weight
// than the spatial-structure hint from the control image. The old value of
// 30 was overpowering the prompt and producing literal hexagons of the cube
// wireframe.
const GUIDANCE = 25;

const BodySchema = z.object({
  project_id: z.string().uuid(),
  room_id: z.string().uuid(),
  tweak: z.string().min(1).max(500).optional(),
  // Default to canny. Send `"depth"` to A/B against flux-depth-pro.
  mode: z.enum(["canny", "depth"]).optional().default("canny"),
});

const VALID_STYLE_KEYS = new Set<string>(STYLE_KEYS);

// Fetches the Replicate output URL and uploads it to Supabase Storage,
// returning the public URL that will survive after Replicate's signature
// expires. Throws on any failure so the caller can decide how to handle it.
async function rehostReplicateImage(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  replicateUrl: string,
  projectId: string,
): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), RENDER_FETCH_TIMEOUT_MS);
  let blob: Blob;
  try {
    const res = await fetch(replicateUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(
        `Failed to download Replicate output (${res.status} ${res.statusText}).`,
      );
    }
    blob = await res.blob();
  } finally {
    clearTimeout(t);
  }

  const contentType = blob.type || "image/jpeg";
  const ext = contentType === "image/png" ? "png" : "jpg";
  const path = `${projectId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(RENDER_BUCKET)
    .upload(path, blob, {
      contentType,
      upsert: false,
    });
  if (uploadErr) {
    throw uploadErr;
  }

  const { data } = supabase.storage.from(RENDER_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function extractImageUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  if (
    output &&
    typeof output === "object" &&
    "url" in output &&
    typeof (output as { url: unknown }).url === "function"
  ) {
    const u = (output as { url: () => string | URL }).url();
    return typeof u === "string" ? u : u.toString();
  }
  if (
    output &&
    typeof output === "object" &&
    "output" in output &&
    typeof (output as { output: unknown }).output === "string"
  ) {
    return (output as { output: string }).output;
  }
  throw new Error(
    `Replicate returned an unexpected output shape: ${JSON.stringify(output).slice(0, 200)}`,
  );
}

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
    const { project_id, room_id, tweak, mode } = parsed.data;

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

    // Control image: line-art for canny, gradient for depth.
    let controlBase64: string;
    try {
      controlBase64 =
        mode === "depth"
          ? await buildDepthControlImageBase64(room)
          : await buildControlImageBase64(room);
    } catch (err) {
      console.error("[api/render] control image build failed", err);
      const message =
        err instanceof Error ? err.message : "Failed to build control image.";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    let prompt = buildRenderPrompt({
      styleKey: styleKey as StyleKey,
      roomType: promptRoomType,
    });
    if (tweak && tweak.trim()) {
      prompt = `${prompt} — modified: ${tweak.trim()}`;
    }

    // Cache check: if a render with this exact prompt for this room already
    // exists, return it instead of paying Replicate again. This handles the
    // case where the user navigates back to a room they already rendered.
    const { data: existing } = await supabase
      .from("renders")
      .select("id, image_url, prompt")
      .eq("room_id", room_id)
      .eq("prompt", prompt)
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

    const replicate = new Replicate({ auth: apiKey });
    const model = mode === "depth" ? MODEL_DEPTH : MODEL_CANNY;

    // Note: flux-canny-pro and flux-depth-pro do NOT accept a separate
    // `negative_prompt` field — the negatives are baked into PROMPT_TAIL
    // in lib/render-prompts.ts. They also have no `control_strength`
    // parameter; `guidance` is the closest analog and we've lowered it to 25.
    const replicatePromise = replicate.run(model, {
      input: {
        prompt,
        control_image: `data:image/png;base64,${controlBase64}`,
        guidance: GUIDANCE,
        output_format: "jpg",
        output_quality: 85,
      },
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () =>
          reject(
            new Error(
              `Render timed out after ${Math.round(REPLICATE_TIMEOUT_MS / 1000)}s.`,
            ),
          ),
        REPLICATE_TIMEOUT_MS,
      );
    });

    let replicateUrl: string;
    try {
      const output = await Promise.race([replicatePromise, timeoutPromise]);
      replicateUrl = extractImageUrl(output);
    } catch (err) {
      console.error("[api/render] replicate error", err);
      const message =
        err instanceof Error ? err.message : "Replicate call failed.";
      const isTimeout = message.includes("timed out");
      return NextResponse.json(
        { error: message },
        { status: isTimeout ? 504 : 502 },
      );
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    // Re-host the Replicate output in Supabase Storage so the persisted URL
    // doesn't go dead when Replicate's signature expires (~1 hour). Falls back
    // to the raw Replicate URL if storage round-trip fails — that's still
    // viewable for the immediate session even though it'll expire later.
    let imageUrl: string;
    try {
      imageUrl = await rehostReplicateImage(supabase, replicateUrl, project_id);
    } catch (err) {
      console.error("[api/render] rehost failed; using replicate URL", err);
      imageUrl = replicateUrl;
    }

    const { data: renderRow, error: insertErr } = await supabase
      .from("renders")
      .insert({
        project_id,
        room_id,
        prompt,
        image_url: imageUrl,
        parent_render_id: null,
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

    return NextResponse.json({
      render_id: renderRow.id,
      image_url: imageUrl,
      prompt,
      mode,
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
