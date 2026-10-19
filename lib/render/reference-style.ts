// =============================================================================
// lib/render/reference-style.ts — the look the client's reference photos share,
// in words (bathroom pilot B2: "style from references — text first").
//
// B0 (d′): image conditioning pulled the layout off on gardens (passes 10/13 →
// 4/13), and nothing on the interior path checked placement. So the client's
// references reach a restyle first as TEXT: a vision model reads them together
// and writes one style brief — materials, colours, fixture finishes, lighting,
// mood — never layout, never quantities (the moodboard descriptor rule). The
// first three reference images also go to the edit model, after the photo
// (PHOTO_VIEW_IMAGE_REFS) — on, by Abdallah's ruling of 18 Oct, after B2 measured
// style 4/5 with them vs 5/15 without, at a layout pass rate of 4/5 vs 13/15.
//
// References arrive as phone screenshots (Pinterest): `referenceCropBox` finds
// the photo inside the app chrome, `cropReference` cuts it out.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

import { CHECK_MODEL, checkCostUsd, type ImageInput } from "./photo-check";
import type { StyleBrief } from "./photo-restyle";

export const REFERENCES_LINE = "Style follows your references";

/**
 * The client's first three reference images go to the edit model after the
 * photo. ON (ruled 18 Oct): the style gain (4/5 vs 5/15) is worth a possible
 * one-in-five layout cost (4/5 vs 13/15) — the placement check still holds every
 * render to the photo. See docs/BATHROOM_PILOT_B2.md.
 */
export const PHOTO_VIEW_IMAGE_REFS = true;

export interface ReferenceStyle {
  text: string;
  elements: { element: string; finish: string }[];
  item_ids: string[];
  model: string;
  at: string;
}

const block = (img: ImageInput): Anthropic.Messages.ImageBlockParam => ("url" in img ? { type: "image", source: { type: "url", url: img.url } } : { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });

const CROP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["x0", "y0", "x1", "y1", "is_screenshot"],
  properties: { x0: { type: "number" }, y0: { type: "number" }, x1: { type: "number" }, y1: { type: "number" }, is_screenshot: { type: "boolean" } },
} as const;

/** The photo inside a phone screenshot, in % of the image — the largest rectangle free of app chrome and overlay buttons. */
export async function referenceCropBox(img: ImageInput): Promise<{ box: [number, number, number, number]; is_screenshot: boolean; usd: number }> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: CHECK_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema: CROP_SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: "user",
        content: [
          block(img),
          { type: "text", text: "This may be a phone screenshot of an image in an app (status bar, app header, buttons, captions, icons overlaid on the image, navigation bar). Give the largest rectangle that is ONLY the photograph itself — no status bar, no app UI, no text, no overlaid icons or buttons — in PERCENT of the screenshot (x0, y0, x1, y1; 0–100, x from the left, y from the top). If it is not a screenshot, return 0, 0, 100, 100 and is_screenshot false." },
        ],
      },
    ],
  });
  const j = JSON.parse(res.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as { x0: number; y0: number; x1: number; y1: number; is_screenshot: boolean };
  const c = (v: number) => Math.max(0, Math.min(100, v));
  return { box: [c(Math.min(j.x0, j.x1)), c(Math.min(j.y0, j.y1)), c(Math.max(j.x0, j.x1)), c(Math.max(j.y0, j.y1))], is_screenshot: !!j.is_screenshot, usd: checkCostUsd(res.usage) };
}

/** Cut the photo out of a screenshot (JPEG out). */
export async function cropReference(bytes: Uint8Array, box: [number, number, number, number]): Promise<Buffer> {
  const meta = await sharp(Buffer.from(bytes)).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  const left = Math.round((box[0] / 100) * W), top = Math.round((box[1] / 100) * H);
  const width = Math.max(1, Math.round(((box[2] - box[0]) / 100) * W)), height = Math.max(1, Math.round(((box[3] - box[1]) / 100) * H));
  return sharp(Buffer.from(bytes)).extract({ left, top, width: Math.min(width, W - left), height: Math.min(height, H - top) }).jpeg({ quality: 90 }).toBuffer();
}

const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "elements"],
  properties: {
    text: { type: "string" },
    elements: { type: "array", items: { type: "object", additionalProperties: false, required: ["element", "finish"], properties: { element: { type: "string" }, finish: { type: "string" } } } },
  },
} as const;

export const STYLE_PROMPT = [
  "These are a client's reference photos for their bathroom renovation — the look they want.",
  "Write ONE style brief the photos share, for an image model restyling the client's own bathroom photo:",
  "- text: one paragraph, at most 90 words: floor and wall tile (colour, tone, format, grout), vanity (construction, wood tone, top), mirror (shape, lighting), taps and fittings (finish), shower (glass, niche), lighting (cove, downlights, colour temperature), accents and dressing. Name what the photos share; where one photo differs, leave it out or say 'optionally'.",
  "- elements: the same as a list — element (floor, walls, vanity, mirror, fittings, shower, lighting, accents) and its finish.",
  "STYLE ONLY: never describe the layout, where things are, room size or how many there are — the client's own room keeps its layout.",
].join("\n");

/** One style brief from the references (style words only). */
export async function describeReferences(images: readonly ImageInput[]): Promise<{ text: string; elements: { element: string; finish: string }[]; usd: number; model: string }> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: CHECK_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: STYLE_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: [...images.flatMap((img, i) => [{ type: "text" as const, text: `REFERENCE ${i + 1}:` }, block(img)]), { type: "text", text: STYLE_PROMPT }] }],
  });
  if (res.stop_reason === "refusal") throw new Error("the model declined to read the references");
  const j = JSON.parse(res.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as { text: string; elements: { element: string; finish: string }[] };
  return { text: j.text.trim(), elements: j.elements, usd: checkCostUsd(res.usage), model: CHECK_MODEL };
}

/** The style a photo view is restyled to: the client's references when described, else the project's direction. */
export function styleBriefFrom(ref: ReferenceStyle | null, preset: { name_en: string; prompt?: string | null } | null): StyleBrief {
  if (ref?.text) return { text: ref.text, source: "references", line: REFERENCES_LINE, elements: ref.elements };
  if (preset) return { text: preset.prompt?.trim() || `${preset.name_en} interior finishes`, source: "preset", line: `Style: ${preset.name_en} (no references described yet)` };
  return { text: "warm, calm, contemporary finishes", source: "preset", line: "Style: a neutral default — add references or choose a direction" };
}
