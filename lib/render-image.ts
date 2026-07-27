import Replicate from "replicate";

// Shared Replicate helpers for the render pipeline.
//
// Two model roles:
//   - EDIT model (RENDER_MODEL, default google/nano-banana): restyles an
//     existing image (a room photo or a generated base shell) while preserving
//     structure. Accepts one or more input images.
//   - BASE model (flux-1.1-pro): pure text-to-image, used to synthesise an
//     empty-room shell for the off-plan path when no photo exists.

// Replicate's `run()` types its first argument as an `owner/model` (optionally
// `:version`) template string, so plain `string` isn't assignable.
export type ModelRef =
  | `${string}/${string}`
  | `${string}/${string}:${string}`;

// Off-plan base image: clean empty-room shell from a dimensions prompt, no
// control image.
export const MODEL_OFFPLAN_BASE: ModelRef = "black-forest-labs/flux-1.1-pro";

// The edit/restyle model. Overridable via RENDER_MODEL so we can A/B
// nano-banana against flux-kontext-pro / qwen-image-edit without a deploy.
export function getRenderModel(): ModelRef {
  const fromEnv = process.env.RENDER_MODEL?.trim();
  if (fromEnv && fromEnv.includes("/")) return fromEnv as ModelRef;
  return "google/nano-banana";
}

// Build the input payload for the edit model. Input-image shape differs by
// model family:
//   - nano-banana takes `image_input` (array) — so it can consume a photo AND
//     a moodboard style reference together.
//   - flux-kontext-pro / qwen-image-edit take a single `input_image` string;
//     they only see the primary image (the photo/base), not the moodboard.
export function buildEditInput(
  model: string,
  prompt: string,
  imageUrls: string[],
): Record<string, unknown> {
  const images = imageUrls.filter((u) => typeof u === "string" && u.length > 0);
  if (model.includes("nano-banana")) {
    return { prompt, image_input: images, output_format: "jpg" };
  }
  return { prompt, input_image: images[0], output_format: "jpg" };
}

// Text-to-image input for the off-plan base shell. 3:2 matches the render
// stage's display aspect so the later edit pass doesn't reframe.
export function buildBaseInput(prompt: string): Record<string, unknown> {
  return {
    prompt,
    aspect_ratio: "3:2",
    output_format: "jpg",
    output_quality: 90,
  };
}

// Replicate SDK outputs are inconsistent across models: a bare URL string, a
// string[], a FileOutput with a .url() method, or an object with `.output`.
// Normalise all of them to a single URL string.
export function extractImageUrl(output: unknown): string {
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

// --- Async predictions ------------------------------------------------------
//
// Renders run as Replicate predictions (create → poll) so the UI shows progress
// instead of one long blocking request. Only the official edit models
// (nano-banana / flux-kontext) are driven this way; the off-plan base and the
// upscaler stay on the blocking run() helper.

// Server-side cap on concurrent renders per project (pending rows in the last
// IN_FLIGHT_WINDOW_MS). The window stops abandoned pending rows — a closed tab
// mid-render — from wedging the cap forever.
export const IN_FLIGHT_CAP = 3;
export const IN_FLIGHT_WINDOW_MS = 10 * 60_000;

export type PredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type RenderPrediction = {
  id: string;
  status: PredictionStatus;
  output: unknown;
  error: unknown;
};

export async function createRenderPrediction(
  apiKey: string,
  model: ModelRef,
  input: Record<string, unknown>,
): Promise<RenderPrediction> {
  const replicate = new Replicate({ auth: apiKey });
  // Official models accept a `model` slug (no version pin).
  const p = await replicate.predictions.create({ model, input });
  return p as unknown as RenderPrediction;
}

export async function getRenderPrediction(
  apiKey: string,
  predictionId: string,
): Promise<RenderPrediction> {
  const replicate = new Replicate({ auth: apiKey });
  const p = await replicate.predictions.get(predictionId);
  return p as unknown as RenderPrediction;
}

export const REPLICATE_TIMEOUT_MS = 90_000;

// Race a Replicate call against a hard timeout so a stuck prediction can't hang
// the request for the whole serverless maxDuration.
export async function runWithTimeout<T>(
  work: Promise<T>,
  timeoutMs = REPLICATE_TIMEOUT_MS,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(
      () =>
        reject(
          new Error(`Render timed out after ${Math.round(timeoutMs / 1000)}s.`),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}
