import { NextResponse, type NextRequest } from "next/server";
import Replicate from "replicate";

import { AnalyticsEvent, recordFeedback, trackServer } from "@/lib/analytics";
import {
  buildEditInput,
  extractImageUrl,
  getRenderModel,
  getRenderPrediction,
  runWithTimeout,
  type ModelRef,
} from "@/lib/render-image";
import { qaPassed, runQaGate, type QaVerdict } from "@/lib/render-qa";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// QA runs on every render that has a source image. The AUTO-RETRY, however,
// only fires for fresh base renders (photo / off-plan): a tweak is an explicit
// user request, so we surface its QA verdict but never re-roll it.
function retryApplies(mode: string | null): boolean {
  return mode === "photo" || mode === "offplan";
}

// One localized retry when QA fails: re-edit the SAME source with the QA
// reason appended as a correction. No moodboard on the retry — keep the signal
// focused on the fix.
async function retryRender(
  apiKey: string,
  model: ModelRef,
  prompt: string,
  reason: string,
  sourceImageUrl: string,
): Promise<string> {
  const correctedPrompt = `${prompt}\n\nCorrection: ${reason} Fix this while keeping the room's architecture, wall/window/door positions, and camera angle identical.`;
  const replicate = new Replicate({ auth: apiKey });
  const output = await runWithTimeout(
    replicate.run(model, {
      input: buildEditInput(model, correctedPrompt, [sourceImageUrl]),
    }),
  );
  return extractImageUrl(output);
}

export async function GET(request: NextRequest) {
  try {
    const predictionId = request.nextUrl.searchParams.get("prediction_id");
    if (!predictionId) {
      return NextResponse.json(
        { error: "prediction_id query parameter is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: row } = await supabase
      .from("renders")
      .select(
        "id, project_id, room_id, prompt, image_url, source_image_url, model, mode, status, qa, parent_render_id",
      )
      .eq("prediction_id", predictionId)
      .maybeSingle();

    if (!row) {
      return NextResponse.json(
        { error: "No render is tracking that prediction." },
        { status: 404 },
      );
    }

    // Already finalised (idempotent — the client may poll once more after the
    // succeeding response).
    if (row.status === "succeeded" && row.image_url) {
      return NextResponse.json({
        status: "succeeded",
        render_id: row.id,
        image_url: row.image_url,
        prompt: row.prompt,
        mode: row.mode,
        qa: qaResult(row.qa),
        qa_reason: qaReason(row.qa),
      });
    }
    if (row.status === "failed") {
      return NextResponse.json({
        status: "failed",
        render_id: row.id,
        error: "Render failed.",
      });
    }

    const apiKey = process.env.REPLICATE_API_TOKEN;
    if (!apiKey) {
      return NextResponse.json(
        { error: "REPLICATE_API_TOKEN is not configured." },
        { status: 500 },
      );
    }

    const prediction = await getRenderPrediction(apiKey, predictionId);

    if (prediction.status === "starting" || prediction.status === "processing") {
      return NextResponse.json({ status: "processing" });
    }

    if (prediction.status === "failed" || prediction.status === "canceled") {
      await supabase
        .from("renders")
        .update({ status: "failed" })
        .eq("id", row.id);
      const message =
        typeof prediction.error === "string"
          ? prediction.error
          : "Render prediction failed.";
      return NextResponse.json({
        status: "failed",
        render_id: row.id,
        error: message,
      });
    }

    // Succeeded — extract the image, then run the QA gate.
    let imageUrl: string;
    try {
      imageUrl = extractImageUrl(prediction.output);
    } catch (err) {
      console.error("[api/render/status] bad output", err);
      await supabase
        .from("renders")
        .update({ status: "failed" })
        .eq("id", row.id);
      return NextResponse.json({
        status: "failed",
        render_id: row.id,
        error: "Render produced no image.",
      });
    }

    let finalImage = imageUrl;
    let verdict: QaVerdict | null = null;
    let qaFailed = false;

    if (row.source_image_url) {
      try {
        verdict = await runQaGate(row.source_image_url, imageUrl);
        // verdict === null → QA couldn't run (fail-open, treated as pass).
        qaFailed = verdict ? !qaPassed(verdict) : false;

        // Auto-retry ONCE, base renders only, when QA failed.
        if (qaFailed && retryApplies(row.mode)) {
          const model = (row.model as ModelRef) ?? getRenderModel();
          const retryImage = await retryRender(
            apiKey,
            model,
            row.prompt ?? "",
            verdict!.reason,
            row.source_image_url,
          );
          finalImage = retryImage;
          // Re-QA the retry so the stored verdict describes the FINAL image.
          // null → QA couldn't re-run; fail-open and store no verdict rather
          // than a stale one that contradicts `passed`.
          const second = await runQaGate(row.source_image_url, retryImage);
          verdict = second;
          qaFailed = second ? !qaPassed(second) : false;
        }
      } catch (err) {
        // QA/retry problems must not sink a completed render.
        console.warn("[api/render/status] QA gate error (passing):", err);
      }
    }

    const qaJson = verdict ? { ...verdict, passed: !qaFailed } : null;

    const { error: updErr } = await supabase
      .from("renders")
      .update({ image_url: finalImage, status: "succeeded", qa: qaJson })
      .eq("id", row.id);
    if (updErr) {
      console.error("[api/render/status] finalise error", updErr);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    if (row.project_id) {
      void trackServer(AnalyticsEvent.RenderCompleted, {
        projectId: row.project_id,
        room_id: row.room_id,
        model: row.model,
        mode: row.mode,
        qa: qaFailed ? "failed" : "passed",
      });
      if (qaFailed) {
        void trackServer(AnalyticsEvent.RenderQaFailed, {
          projectId: row.project_id,
          room_id: row.room_id,
          model: row.model,
          mode: row.mode,
          reason: verdict?.reason ?? null,
        });
        // Durable signal for the KG loop: a QA-rejected render.
        void recordFeedback({
          projectId: row.project_id,
          entityType: "render",
          entityId: row.id,
          action: "rejected",
          payload: { reason: "qa_failed", qa: verdict ?? null },
        });
      }
    }

    return NextResponse.json({
      status: "succeeded",
      render_id: row.id,
      image_url: finalImage,
      prompt: row.prompt,
      mode: row.mode,
      qa: verdict ? (qaFailed ? "failed" : "passed") : null,
      qa_reason: qaFailed ? (verdict?.reason ?? null) : null,
    });
  } catch (err) {
    console.error("[api/render/status] error", err);
    const message =
      err instanceof Error ? err.message : "Status check failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Normalise the stored qa jsonb into a compact "passed" | "failed" | null.
function qaResult(qa: unknown): "passed" | "failed" | null {
  if (qa && typeof qa === "object" && "passed" in qa) {
    return (qa as { passed: unknown }).passed ? "passed" : "failed";
  }
  return null;
}

// The QA reason, surfaced only when the render failed QA.
function qaReason(qa: unknown): string | null {
  if (
    qa &&
    typeof qa === "object" &&
    "passed" in qa &&
    !(qa as { passed: unknown }).passed &&
    "reason" in qa &&
    typeof (qa as { reason: unknown }).reason === "string"
  ) {
    return (qa as { reason: string }).reason;
  }
  return null;
}
