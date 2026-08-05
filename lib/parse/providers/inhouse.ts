// =============================================================================
// lib/parse/providers/inhouse.ts — default parse provider (Claude vision).
//
// Reworked from the old app/api/parse-plan inline logic. The prompt now asks for
// an ACCURATE room outline (an ordered polygon following the real walls, incl.
// diagonals / L-shapes — NOT a bounding box) plus a per-room confidence. Overlap
// elimination + metric conversion happen downstream (repair → buildPlanGraph),
// so this provider only produces the raw normalised parse.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { ParseAsset, ParseProvider, RawParseResult } from "./types";

const RoomSchema = z.object({
  id: z.string(),
  name_en: z.string(),
  name_ar: z.string().nullable(),
  room_type: z.string(),
  area_m2: z.number(),
  polygon: z.array(z.array(z.number())).min(3),
  confidence: z.number().min(0).max(1),
});

const PlanAnalysisSchema = z.object({
  scale: z.string(),
  units: z.enum(["metric", "imperial"]),
  total_area_m2: z.number(),
  rooms: z.array(RoomSchema),
});

// Dense enough to exceed the caching threshold so the system prompt caches on
// the 2nd+ call. Content must be byte-stable — do not interpolate per-request
// fields here.
const SYSTEM_PROMPT = `You are a senior architectural floorplan analyst for RennovAIte, an AI renovation platform for Dubai villas. Your job is to read a single floorplan image and emit a strictly-typed JSON description of the rooms, their areas, their true outlines, and your confidence, for downstream visualization and quantity take-off.

## Context

- Target properties: mid-market and premium villas in Dubai (Mudon, Arabian Ranches, Jumeirah, DAMAC Hills, etc.). Most plans are drawn in English. Arabic room labels may be present but are less common.
- A typical first-floor refit has 100–250 m² total interior area and 4–8 enclosed rooms.
- Typical room types: master bedroom, secondary bedrooms, en-suite bathrooms, shared bathrooms, powder room, walk-in closets, central living area, dining room, kitchen, majlis, maid's room, laundry, stairs, entrance foyer, balcony/terrace.
- The plan may include more than one floor side-by-side; if so, analyse only the single most prominent floor — do not merge rooms across floors.

## Output schema

Return a JSON object with EXACTLY this shape — no other top-level keys, no nesting changes:

{
  "scale": string,                    // e.g. "1:100", "1:50". If not shown, "unknown".
  "units": "metric" | "imperial",     // "metric" unless the drawing labels areas in ft² or dimensions in feet-inches.
  "total_area_m2": number,            // total enclosed interior floor area in square metres.
  "rooms": [
    {
      "id": string,                   // short stable slug: "master-bed-01", "bathroom-02". Lowercase, hyphens, unique.
      "name_en": string,              // English name, title case.
      "name_ar": string | null,       // Arabic transliteration when clear, else null.
      "room_type": string,            // One canonical token (below). Do not invent.
      "area_m2": number,              // Floor area in m². Convert ft² if needed (1 ft² = 0.0929 m²).
      "polygon": number[][],          // The room's TRUE outline as an ordered ring of [x, y] points in
                                      //   normalized image coordinates (x, y in [0, 1]; (0,0) = top-left).
                                      //   Trace the actual interior wall faces: follow the real corners.
                                      //   L-shaped, angled, and bay rooms MUST use the extra vertices needed
                                      //   to represent their shape (typically 4–12 points). Go clockwise,
                                      //   starting at the top-left-most corner. Do NOT output a bounding
                                      //   rectangle for a non-rectangular room, and do NOT let two rooms'
                                      //   polygons overlap — trace each room's own walls.
      "confidence": number            // 0.0–1.0: your confidence that this room's outline, type, and area are
                                      //   correct. Lower it for faint/ambiguous walls, guessed areas, unclear
                                      //   labels, or shapes you had to approximate.
    }
  ]
}

## Canonical room_type tokens

master_bedroom, bedroom, bathroom, ensuite, powder, closet, living, dining, kitchen, majlis, maid, laundry, foyer, stairs, balcony, terrace, storage, other

Guidance:
- "ensuite" = a bathroom that only opens from inside a bedroom.
- "powder" = a small guest WC, typically no shower.
- "majlis" = formal reception / sitting room.
- Use "other" only as a last resort.

## Rules

1. Your ENTIRE response MUST be a single valid JSON object. No prose, no markdown fences.
2. If the image is unreadable, blank, or not a floorplan, return: {"scale":"unknown","units":"metric","total_area_m2":0,"rooms":[]}
3. Exclude exterior structures that are not enclosed interior rooms: gardens, pools, driveways, detached garages, open courtyards.
4. Include enclosed balconies/terraces on the analysed floor, typed accordingly.
5. The polygon is the room's real footprint, used for quantities — trace it faithfully. Adjacent rooms share a wall line but their polygons must NOT overlap.
6. Slug ids must be unique. Two secondary bedrooms → "bedroom-01", "bedroom-02".
7. Prefer metric. Only set units="imperial" for clearly US/UK-conventional drawings.

## Example of correct output (shape only — do not copy values; note the L-shaped living room)

{
  "scale": "1:100",
  "units": "metric",
  "total_area_m2": 187.3,
  "rooms": [
    {"id":"master-bed-01","name_en":"Master Bedroom","name_ar":"غرفة النوم الرئيسية","room_type":"master_bedroom","area_m2":28.4,"polygon":[[0.05,0.08],[0.42,0.08],[0.42,0.44],[0.05,0.44]],"confidence":0.9},
    {"id":"living-01","name_en":"Central Living","name_ar":"صالة","room_type":"living","area_m2":36.2,"polygon":[[0.05,0.46],[0.62,0.46],[0.62,0.70],[0.34,0.70],[0.34,0.88],[0.05,0.88]],"confidence":0.82},
    {"id":"stairs-01","name_en":"Stairs","name_ar":"درج","room_type":"stairs","area_m2":4.8,"polygon":[[0.64,0.56],[0.78,0.56],[0.78,0.72],[0.64,0.72]],"confidence":0.7}
  ]
}
`;

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  let out = "";
  for (const block of content) if (block.type === "text") out += block.text;
  return out;
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

async function askClaude(
  anthropic: Anthropic,
  asset: ParseAsset,
  retry: { previous: string } | null,
): Promise<string> {
  const sourceBlock: Anthropic.Messages.ContentBlockParam =
    asset.kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: asset.data } }
      : { type: "image", source: { type: "base64", media_type: asset.mediaType, data: asset.data } };

  const userBlocks: Anthropic.Messages.ContentBlockParam[] = [
    sourceBlock,
    {
      type: "text",
      text: retry
        ? `Your previous response could not be parsed against the schema:\n\n---BEGIN PREVIOUS---\n${retry.previous}\n---END PREVIOUS---\n\nReply AGAIN with ONLY a single valid JSON object matching the system-prompt schema. No prose, no fences. Fix whatever was wrong — missing fields (including confidence), wrong types, invalid enum values, extra keys, or a bounding-box polygon where the room is non-rectangular.`
        : "Analyze this floorplan and return the structured JSON as specified.",
    },
  ];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    thinking: { type: "disabled" },
    output_config: { effort: "medium" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userBlocks }],
  });
  return extractText(response.content);
}

function toResult(parsed: z.infer<typeof PlanAnalysisSchema>): RawParseResult {
  return {
    scale: parsed.scale,
    units: parsed.units,
    total_area_m2: parsed.total_area_m2,
    rooms: parsed.rooms.map((r) => ({
      ...r,
      // Coerce each vertex to a fixed [x, y] pair for the geometry pipeline.
      polygon: r.polygon.map((p) => [p[0] ?? 0, p[1] ?? 0] as [number, number]),
    })),
  };
}

async function analyze(anthropic: Anthropic, asset: ParseAsset): Promise<RawParseResult> {
  const first = await askClaude(anthropic, asset, null);
  try {
    return toResult(PlanAnalysisSchema.parse(JSON.parse(stripJsonFences(first))));
  } catch {
    const second = await askClaude(anthropic, asset, { previous: first });
    try {
      return toResult(PlanAnalysisSchema.parse(JSON.parse(stripJsonFences(second))));
    } catch (secondErr) {
      const detail = secondErr instanceof Error ? secondErr.message : String(secondErr);
      throw new Error(`Claude's response did not match the required schema after one retry: ${detail}`);
    }
  }
}

export const inhouseProvider: ParseProvider = {
  name: "inhouse",
  async parse(asset: ParseAsset): Promise<RawParseResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not configured. Add it to .env.local and restart the dev server.",
      );
    }
    const anthropic = new Anthropic({ apiKey });
    return analyze(anthropic, asset);
  },
};
