// 2× upscale/finish pass for approved renders.
//
// philz1337x/clarity-upscaler input schema (verified July 2026):
//   image: string (URL), scale_factor: number (default 2), output_format: enum.
// It's a COMMUNITY model, so run() MUST carry a pinned version — the
// model-slug endpoint (owner/name with no version) is official-models-only and
// 404s for community models. Returns the upscaled image URL, or null on any
// failure — upscaling is a bonus on top of a successful approval and must
// never break the lock.

import Replicate from "replicate";

import { extractImageUrl, runWithTimeout } from "@/lib/render-image";

const UPSCALER_MODEL =
  "philz1337x/clarity-upscaler:dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e" as const;

// Upscaling tiles the image and runs a diffusion pass — slower than an edit.
// Give it a longer ceiling than a normal render.
const UPSCALE_TIMEOUT_MS = 120_000;

export async function upscaleRender(
  apiKey: string,
  imageUrl: string,
): Promise<string | null> {
  try {
    const replicate = new Replicate({ auth: apiKey });
    const output = await runWithTimeout(
      replicate.run(UPSCALER_MODEL, {
        input: {
          image: imageUrl,
          scale_factor: 2,
          output_format: "jpg",
        },
      }),
      UPSCALE_TIMEOUT_MS,
    );
    return extractImageUrl(output);
  } catch (err) {
    console.warn("[render-upscale] upscale failed:", err);
    return null;
  }
}
