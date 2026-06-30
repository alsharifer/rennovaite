import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import Replicate from "replicate";
import { z } from "zod";

import { recordFeedback } from "@/lib/analytics";
import { buildControlImageBase64 } from "@/lib/control-image";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const REPLICATE_TIMEOUT_MS = 90_000;
const MODEL_CANNY = "black-forest-labs/flux-canny-pro";
const GUIDANCE = 25;

const BodySchema = z.object({
  project_id: z.string().uuid(),
  room_id: z.string().uuid(),
  parent_render_id: z.string().uuid(),
  tweak: z.string().min(1).max(500),
});

// Take a previous prompt + a one-line tweak. Return ONE new prompt that makes
// the change UNMISTAKABLE in the next render — diffusion models under-respond
// to vague tweaks, so we expand the user's request into concrete visual
// vocabulary the model can latch onto.
const REWRITE_SYSTEM_PROMPT = `You are a prompt engineer for an AI interior render pipeline. The previous prompt produced an image. The user wants ONE specific change. Your job is to produce a new prompt that makes that change UNMISTAKABLE in the next render.

Hard rules:

- Keep the head clause EXACTLY, with no modification: "Architectural interior photograph, taken from inside the room at human eye height (approximately 1.6m), looking toward the back wall. Wide-angle 24mm lens."
- Keep the tail clause EXACTLY, with no modification: "Visible: floor, ceiling, side walls in perspective, with the back wall in the centre of frame. Magazine-quality interior photography, soft natural daylight from the side, 4k, ultra-detailed, no people, no text, no abstract objects, no sculpture, no geometric shape, no top-down view, no isometric view, no floating object, no hexagon, no cube, no render of a single piece of furniture, no bird's eye view."
- In the middle of the prompt, KEEP all unchanged style, material, and furniture details from the previous prompt. Do not silently rephrase them.

For the user's requested change:

- Place the change PROMINENTLY in the middle (early, not buried).
- Expand it into concrete visual vocabulary — specific colours, materials, textures, lighting qualities. Vague words ("nicer", "warmer", "more modern") get expanded into specific descriptors.
  - "make the rug darker" → "deep charcoal-grey low-pile area rug"
  - "more sun" → "bright morning sunlight streaming through the side window casting warm pools on the floor"
  - "different bed" → keep "low king-size platform bed against the back wall" but swap one detail, e.g. "with a curved boucle headboard"
  - "warmer" → "warm amber light, brass accents, layered cream textiles"
- If the change CONFLICTS with an existing detail in the previous prompt, REMOVE the conflicting detail.
- Do not invent unrelated additions. The change is the only delta.

Output ONLY the new prompt as a single line of plain text. No JSON. No markdown. No preamble. No closing remarks. No quotes around the prompt.`;

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  let out = "";
  for (const block of content) {
    if (block.type === "text") out += block.text;
  }
  return out;
}

function stripWrapping(text: string): string {
  let t = text.trim();
  // Common Claude wrappers despite "no quotes" instructions.
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith("`") && t.endsWith("`"))
  ) {
    t = t.slice(1, -1).trim();
  }
  // If Claude added a preamble like "Here is the new prompt:\n\n", drop it.
  const colonIdx = t.indexOf("\n");
  if (
    colonIdx > 0 &&
    /^(here|the new prompt|prompt)\b/i.test(t) &&
    /:\s*$/.test(t.slice(0, colonIdx))
  ) {
    t = t.slice(colonIdx + 1).trim();
  }
  return t;
}

async function rewritePrompt(
  anthropic: Anthropic,
  previousPrompt: string,
  tweak: string,
): Promise<string> {
  const userMessage = `Previous prompt:\n\n${previousPrompt}\n\nUser tweak: ${tweak}\n\nReturn the new prompt.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    system: REWRITE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = stripWrapping(extractText(response.content));
  if (!text) throw new Error("Claude returned an empty prompt.");
  return text;
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
    const { project_id, room_id, parent_render_id, tweak } = parsed.data;

    const replicateKey = process.env.REPLICATE_API_TOKEN;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!replicateKey) {
      return NextResponse.json(
        { error: "REPLICATE_API_TOKEN is not configured." },
        { status: 500 },
      );
    }
    if (!anthropicKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured." },
        { status: 500 },
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: parent, error: parentErr } = await supabase
      .from("renders")
      .select("id, project_id, room_id, prompt, kg_bundle_id")
      .eq("id", parent_render_id)
      .maybeSingle();
    if (parentErr || !parent) {
      return NextResponse.json(
        { error: "Parent render not found." },
        { status: 404 },
      );
    }
    if (parent.project_id !== project_id || parent.room_id !== room_id) {
      return NextResponse.json(
        {
          error: "Parent render does not belong to this project / room.",
        },
        { status: 400 },
      );
    }
    if (!parent.prompt) {
      return NextResponse.json(
        { error: "Parent render has no stored prompt." },
        { status: 400 },
      );
    }

    const { data: room } = await supabase
      .from("rooms")
      .select("id, polygon, area_m2")
      .eq("id", room_id)
      .maybeSingle();
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    // 1. Rewrite prompt via Claude.
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    let newPrompt: string;
    try {
      newPrompt = await rewritePrompt(anthropic, parent.prompt, tweak);
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        console.error(
          "[api/render-iterate] anthropic error",
          err.status,
          err.message,
        );
        return NextResponse.json(
          { error: `Claude API error (${err.status}): ${err.message}` },
          { status: 502 },
        );
      }
      console.error("[api/render-iterate] rewrite failed", err);
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "Failed to rewrite prompt.",
        },
        { status: 502 },
      );
    }

    // 2. Build the SAME control image (geometry hasn't changed).
    let controlBase64: string;
    try {
      controlBase64 = await buildControlImageBase64(room);
    } catch (err) {
      console.error("[api/render-iterate] control image failed", err);
      const message =
        err instanceof Error ? err.message : "Failed to build control image.";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    // 3. Replicate (with hard timeout).
    const replicate = new Replicate({ auth: replicateKey });
    const replicatePromise = replicate.run(MODEL_CANNY, {
      input: {
        prompt: newPrompt,
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

    let imageUrl: string;
    try {
      const output = await Promise.race([replicatePromise, timeoutPromise]);
      imageUrl = extractImageUrl(output);
    } catch (err) {
      console.error("[api/render-iterate] replicate error", err);
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

    // 4. Persist with parent_render_id set.
    const { data: renderRow, error: insertErr } = await supabase
      .from("renders")
      .insert({
        project_id,
        room_id,
        prompt: newPrompt,
        image_url: imageUrl,
        parent_render_id,
      })
      .select("id")
      .single();
    if (insertErr || !renderRow) {
      console.error("[api/render-iterate] insert error", insertErr);
      return NextResponse.json(
        { error: insertErr?.message ?? "Failed to save render." },
        { status: 500 },
      );
    }

    // Feedback: an iteration means the parent render wasn't quite right but the
    // direction is worth refining — an "iterated" signal carrying the tweak.
    // The KG bundle is inherited from the parent (only the base render is
    // grounded; iterations reuse its lineage).
    await recordFeedback({
      projectId: project_id,
      entityType: "render",
      entityId: renderRow.id,
      action: "iterated",
      kgBundleId: parent.kg_bundle_id ?? null,
      payload: { tweak, parent_render_id },
    });

    return NextResponse.json({
      render_id: renderRow.id,
      image_url: imageUrl,
      prompt: newPrompt,
    });
  } catch (err) {
    console.error("[api/render-iterate] error", err);
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Iteration failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
