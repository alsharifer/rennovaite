// =============================================================================
// lib/render/room-spec.ts — one design across a room's views (bathroom pilot B4).
//
// The first view the user locks anchors the room (room_anchors, 064). A vision
// reading of the anchor's render gives the ROOM DESIGN SPEC — floor tile, wall
// tile + tiled height, vanity, mirror, WC, shower screen, fittings finish,
// palette — in words a restyle prompt and a QS can both read. Every other view
// of the room is rendered against the anchor's image and this spec, and checked
// against them ("Finishes follow Photo 2 (locked) ✓").
//
// The spec is the hook to 03 Specification and the BoQ (a vanity read here is
// the vanity the client will be priced for) — NOT wired here; next step.
//
// Pure helpers first (client-safe types, the judge, the lines); the three vision
// calls (`extractRoomSpec`, `checkFollows`, `describeChange`) are server-only and
// share photo-check's model, pricing and structured-output pattern.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";

import { CHECK_MODEL, type ImageInput } from "./photo-check";
import { CHANGE_ELEMENTS, judgeFollows, SPEC_FIELDS, type FollowsResult, type FollowsVerdict, type RoomDesignSpec, type SpecField } from "./room-spec-vocab";

export * from "./room-spec-vocab";



// --- the vision calls (server) ------------------------------------------------------------

const block = (img: ImageInput): Anthropic.Messages.ImageBlockParam => ("url" in img ? { type: "image", source: { type: "url", url: img.url } } : { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
const usageOf = (r: Anthropic.Messages.Message) => ({ input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens });
const textOf = (r: Anthropic.Messages.Message) => r.content.map((b) => (b.type === "text" ? b.text : "")).join("");

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("check unavailable: ANTHROPIC_API_KEY not set");
  return new Anthropic();
}

const SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...SPEC_FIELDS],
  properties: Object.fromEntries(SPEC_FIELDS.map((f) => [f, { type: "string" }])),
} as const;

export const SPEC_PROMPT = [
  "This is a render of a client's renovated bathroom — the view they locked as THE design of the room.",
  "Read its design as a short specification, one phrase per field (at most 14 words), in the words a tiler, joiner and supplier would use: colour, tone, material, format, finish.",
  "floor_tile, wall_tile (and tiled_height: 'full height', 'to 1.2 m', …), vanity (construction, wood tone, top, basin), mirror (shape, lighting), wc (shape, colour and finish — never how it is mounted), shower_screen (glass, frame, door), fittings_finish (taps, shower, accessories), palette (the 3–4 colours that set the look).",
  "Describe ONLY what the image shows; a field it does not show is an empty string. Never describe the layout, positions or sizes.",
].join("\n");

/** Read the room design spec from the anchor render. */
export async function extractRoomSpec(image: ImageInput): Promise<{ spec: RoomDesignSpec; usage: { input_tokens: number; output_tokens: number }; model: string }> {
  const res = await client().messages.create({
    model: CHECK_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SPEC_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: [block(image), { type: "text", text: SPEC_PROMPT }] }],
  });
  if (res.stop_reason === "refusal") throw new Error("the model declined to read the anchor");
  const j = JSON.parse(textOf(res)) as Record<SpecField, string | null>;
  const spec = Object.fromEntries(SPEC_FIELDS.map((f) => [f, typeof j[f] === "string" && j[f]!.trim() ? j[f]!.trim() : null])) as unknown as RoomDesignSpec;
  return { spec, usage: usageOf(res), model: CHECK_MODEL };
}

const FOLLOWS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["elements"],
  properties: {
    elements: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["element", "verdict", "note"], properties: { element: { type: "string" }, verdict: { type: "string", enum: ["same", "partly", "different", "not_visible"] }, note: { type: "string" } } },
    },
  },
} as const;

/** The render beside the anchor: is each element of the spec the SAME finish? */
export async function checkFollows(render: ImageInput, anchor: ImageInput, elements: readonly { element: string; finish: string }[]): Promise<FollowsResult> {
  const res = await client().messages.create({
    model: CHECK_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema: FOLLOWS_SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "IMAGE 1 — the locked view of a renovated bathroom (the room's agreed design):" },
          block(anchor),
          { type: "text", text: "IMAGE 2 — another view of the SAME room, rendered from a different photo:" },
          block(render),
          {
            type: "text",
            text: `The two images look at the room from different places, so the layout and what is in frame differ — that is expected. For EACH element below, judge only whether IMAGE 2 has the SAME finish and design as IMAGE 1 — ignore where things are, their size and how a WC or bidet is mounted: "same", "partly" (close but visibly different in colour, material or form), "different", or "not_visible" (IMAGE 2 does not show it). A few words why.\n\n${elements.map((e) => `${e.element}: ${e.finish}`).join("\n")}`,
          },
        ],
      },
    ],
  });
  const j = JSON.parse(textOf(res)) as { elements: { element: string; verdict: FollowsVerdict; note: string }[] };
  return { ...judgeFollows(j.elements), usage: usageOf(res) };
}

const CHANGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["changed", "summary"],
  properties: {
    changed: { type: "array", items: { type: "string", enum: [...CHANGE_ELEMENTS] } },
    summary: { type: "string" },
  },
} as const;

/** Before / after an "Ask for a change": which elements changed (from CHANGE_ELEMENTS) and in a few words. */
export async function describeChange(before: ImageInput, after: ImageInput, request: string): Promise<{ changed: string[]; summary: string; usage: { input_tokens: number; output_tokens: number } }> {
  const res = await client().messages.create({
    model: CHECK_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: CHANGE_SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "IMAGE 1 — a bathroom render before an edit:" },
          block(before),
          { type: "text", text: "IMAGE 2 — the same render after the edit:" },
          block(after),
          { type: "text", text: `The client asked for: "${request}". Which elements VISIBLY changed between IMAGE 1 and IMAGE 2 (only what really changed, from the list), and a summary of at most 10 words of what changed.` },
        ],
      },
    ],
  });
  const j = JSON.parse(textOf(res)) as { changed: string[]; summary: string };
  return { changed: [...new Set(j.changed)].filter((c) => c !== "other" || j.changed.length === 1), summary: j.summary.trim(), usage: usageOf(res) };
}
