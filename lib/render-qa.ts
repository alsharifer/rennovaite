// Post-render QA gate — one Claude vision call comparing the source image
// (room photo or off-plan base shell) against the finished render.
//
// Fail-OPEN by design: if the API key is missing, the call errors, or the
// output can't be validated, we return null and the caller treats the render
// as passing. QA is a guardrail, not a hard dependency — it must never block a
// render the user is waiting on because of an unrelated Anthropic hiccup.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Match the model used elsewhere for Claude reasoning (see api/generate-boq).
const MODEL = "claude-sonnet-4-6";

export const QaVerdictSchema = z.object({
  structure_preserved: z.boolean(),
  artifacts: z.boolean(),
  photorealistic: z.boolean(),
  reason: z.string(),
});
export type QaVerdict = z.infer<typeof QaVerdictSchema>;

// A render passes when it kept the room's structure, has NO wireframe/grid/
// warp artifacts, and looks photorealistic.
export function qaPassed(v: QaVerdict): boolean {
  return v.structure_preserved && !v.artifacts && v.photorealistic;
}

const SYSTEM_PROMPT = `You are a strict QA reviewer for an AI interior-render pipeline. You are given two images: IMAGE 1 is the SOURCE (the real room photo, or an empty-room base shell). IMAGE 2 is the RENDER produced from it.

Judge only these three things:
- structure_preserved: does the render keep the SOURCE's room architecture — wall positions, window and door locations, and camera angle? Furniture and finishes are expected to change; geometry must not.
- artifacts: does the render contain generation artifacts OR physically impossible elements? This is true if you see ANY of: wireframe/grid/box lines; warped, melted, or duplicated geometry; impossible perspective; text; a top-down/isometric view; OR anything that could not exist in a real buildable room — floating or levitating furniture, a bed with no floor contact, a glass/aquarium/water panel or window set into the FLOOR, a window or door opening onto an impossible space, or objects defying gravity. true means such problems ARE present.
- photorealistic: does it read as a real interior photograph (not a cartoon, sketch, or obviously synthetic render)?

A room can be unusual or bold and still pass — only fail the artifacts check for things that are physically impossible or clearly a generation glitch, not merely for adventurous design.

Reply with ONLY a single JSON object, no prose, no markdown fences:
{"structure_preserved": boolean, "artifacts": boolean, "photorealistic": boolean, "reason": "one short sentence"}`;

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  let out = "";
  for (const block of content) {
    if (block.type === "text") out += block.text;
  }
  return out;
}

function parseVerdict(text: string): QaVerdict | null {
  // Tolerate stray prose / code fences around the JSON object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = QaVerdictSchema.safeParse(obj);
  return parsed.success ? parsed.data : null;
}

/**
 * Run the QA gate. Returns the validated verdict, or null when QA could not be
 * performed (missing key, API error, unparseable output) — callers treat null
 * as "pass" (fail-open).
 */
export async function runQaGate(
  sourceImageUrl: string,
  renderImageUrl: string,
): Promise<QaVerdict | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "IMAGE 1 — SOURCE:" },
            { type: "image", source: { type: "url", url: sourceImageUrl } },
            { type: "text", text: "IMAGE 2 — RENDER:" },
            { type: "image", source: { type: "url", url: renderImageUrl } },
            {
              type: "text",
              text: "Return the JSON verdict for IMAGE 2 versus IMAGE 1.",
            },
          ],
        },
      ],
    });
    return parseVerdict(extractText(response.content));
  } catch (err) {
    console.warn("[render-qa] QA call failed (treating as pass):", err);
    return null;
  }
}
