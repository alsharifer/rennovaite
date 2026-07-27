import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AnalyticsEvent, recordFeedback, trackServer } from "@/lib/analytics";
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
export const maxDuration = 120;

const BodySchema = z.object({
  project_id: z.string().uuid(),
  room_id: z.string().uuid(),
  parent_render_id: z.string().uuid(),
  tweak: z.string().min(1).max(500),
});

// Take the current render's description + a one-line tweak, and return ONE
// concise EDIT INSTRUCTION for the image-edit model (nano-banana). The model
// already has the current image — it edits that image in place — so the
// instruction must describe ONLY the change. Restating the unchanged scene
// (style, furniture, camera, "keep everything the same") tells an edit model
// to leave the image alone and suppresses the tweak. We only expand the user's
// vague words into concrete visual vocabulary so the edit is unmistakable.
const REWRITE_SYSTEM_PROMPT = `You convert a homeowner's vague tweak into ONE concrete edit instruction for an image-editing model. The model already has the current render of the room and will apply your instruction directly to that image.

Rules:

- Output ONLY the change the user asked for, as a direct imperative instruction. Do NOT re-describe the room, its style, furniture, walls, camera angle, lighting, or image quality — anything the user did not ask to change. Restating unchanged elements makes an edit model keep them identical and cancels your edit.
- Expand vague words into specific, concrete visual vocabulary — exact colours, materials, textures, finishes, lighting:
  - "darker floor" → "Make the floor a deep charcoal-stained oak with visible grain."
  - "make the rug darker" → "Change the rug to a deep charcoal-grey low-pile wool rug."
  - "more sun" → "Flood the room with bright warm morning sunlight from the side window, casting soft pools of light on the floor."
  - "warmer" → "Shift the palette warmer: add amber lighting, brass accents, and layered cream textiles."
  - "different bed" → "Replace the headboard with a curved cream boucle one."
- Keep it to one or two sentences. Never add camera, resolution, or negative ("no hexagon") clauses.

Output ONLY the edit instruction as a single line of plain text. No JSON. No markdown. No preamble. No quotes.`;

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
  const userMessage = `Current render (context only — describes what is already in the image; do NOT restate it):\n\n${previousPrompt}\n\nUser tweak: ${tweak}\n\nReturn the single edit instruction.`;

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
      .select("id, project_id, room_id, prompt, image_url, kg_bundle_id")
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
    if (!parent.image_url) {
      return NextResponse.json(
        { error: "Parent render has no image to edit." },
        { status: 400 },
      );
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

    // 2. In-flight cap: shared with the base render route (pending rows/project).
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

    // 3. Localized edit as an async prediction: feed the PARENT render's image
    // to the edit model with the rewritten tweak as the instruction, so only
    // the requested element changes instead of re-rolling the whole scene.
    const editModel = getRenderModel();
    let prediction;
    try {
      prediction = await createRenderPrediction(
        replicateKey,
        editModel,
        buildEditInput(editModel, newPrompt, [parent.image_url]),
      );
    } catch (err) {
      console.error("[api/render-iterate] prediction create error", err);
      const message =
        err instanceof Error ? err.message : "Replicate call failed.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // 4. Persist a PENDING row with parent_render_id set; /api/render/status
    // finalises it when the prediction completes (no QA gate for tweaks).
    const { data: renderRow, error: insertErr } = await supabase
      .from("renders")
      .insert({
        project_id,
        room_id,
        prompt: newPrompt,
        image_url: null,
        parent_render_id,
        source_image_url: parent.image_url,
        model: editModel,
        mode: "tweak",
        prediction_id: prediction.id,
        status: "pending",
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

    void trackServer(AnalyticsEvent.RenderTweaked, {
      projectId: project_id,
      room_id,
      model: editModel,
      mode: "tweak",
    });

    return NextResponse.json({
      render_id: renderRow.id,
      prediction_id: prediction.id,
      status: "pending",
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
