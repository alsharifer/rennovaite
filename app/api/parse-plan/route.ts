import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RoomSchema = z.object({
  id: z.string(),
  name_en: z.string(),
  name_ar: z.string().nullable(),
  room_type: z.string(),
  area_m2: z.number(),
  polygon: z.array(z.array(z.number())),
});

const PlanAnalysisSchema = z.object({
  scale: z.string(),
  units: z.enum(["metric", "imperial"]),
  total_area_m2: z.number(),
  rooms: z.array(RoomSchema),
});

type PlanAnalysis = z.infer<typeof PlanAnalysisSchema>;

// Dense enough to exceed Sonnet 4.6's 2048-token caching threshold so the
// system prompt caches on the 2nd+ call. Content must be byte-stable — do
// not interpolate timestamps, request IDs, or per-user fields here.
const SYSTEM_PROMPT = `You are a senior architectural floorplan analyst for RennovAIte, an AI renovation platform for Dubai villas. Your job is to read a single floorplan image and emit a strictly-typed JSON description of the rooms, their approximate areas, and their rough locations for downstream visualization.

## Context

- Target properties: mid-market and premium villas in Dubai (Mudon, Arabian Ranches, Jumeirah, DAMAC Hills, etc.). Most plans are drawn in English. Arabic room labels may be present but are less common.
- A typical first-floor refit has 100–250 m² total interior area and 4–8 enclosed rooms.
- Typical room types you will see: master bedroom, secondary bedrooms, en-suite bathrooms, shared bathrooms, powder room, walk-in closets, central living area, dining room, kitchen, majlis, maid's room, laundry, stairs, entrance foyer, balcony/terrace.
- The plan may include the ground floor; the first floor; roof. If the drawing obviously shows more than one floor side-by-side, analyse only the single most prominent floor — do not merge rooms across floors.

## Output schema

Return a JSON object with EXACTLY this shape — no other top-level keys, no nesting changes:

{
  "scale": string,                    // e.g. "1:100", "1:50", "1:75". If not shown, "unknown".
  "units": "metric" | "imperial",     // "metric" unless the drawing labels areas in ft² or dimensions in feet-inches.
  "total_area_m2": number,            // total enclosed interior floor area in square metres.
                                      // If the plan prints a total, use it. Otherwise sum the rooms.
  "rooms": [
    {
      "id": string,                   // short stable slug like "master-bed-01", "bathroom-02", "living-01".
                                      //   Lowercase. Hyphens only. No spaces. Unique within this response.
      "name_en": string,              // English name, title case ("Master Bedroom", "Bedroom 2", "Ensuite 1").
      "name_ar": string | null,       // Arabic transliteration when room type is clear ("غرفة النوم الرئيسية",
                                      //   "غرفة نوم", "حمام", "مطبخ", "صالة", "مجلس"). null if unclear.
      "room_type": string,            // One of the canonical tokens listed below. Do not invent new values.
      "area_m2": number,              // Floor area in m². If the drawing shows ft², convert (1 ft² = 0.0929 m²).
                                      //   If not labelled, estimate from the drawing + declared scale.
      "polygon": number[][]           // FOUR [x, y] points approximating the room's bounding rectangle in
                                      //   normalized image coordinates, where x and y are both in [0, 1],
                                      //   (0, 0) is top-left of the image, and (1, 1) is bottom-right.
                                      //   Start at top-left and go clockwise: TL, TR, BR, BL.
                                      //   Axis-aligned is fine; we do not need true vertices.
    }
  ]
}

## Canonical room_type tokens

Use exactly one of these strings. Pick the closest match — do not invent:

master_bedroom, bedroom, bathroom, ensuite, powder, closet,
living, dining, kitchen, majlis, maid, laundry,
foyer, stairs, balcony, terrace, storage, other

Guidance:
- "ensuite" = a bathroom that only opens from inside a bedroom.
- "powder" = a small guest WC, typically no shower.
- "majlis" = formal reception / sitting room (common in Emirati homes).
- Use "other" only as a last resort.

## Rules

1. Your ENTIRE response MUST be a single valid JSON object. No prose before or after. No markdown code fences.
2. If the image is unreadable, blank, or clearly not a floorplan, return:
   {"scale":"unknown","units":"metric","total_area_m2":0,"rooms":[]}
3. Exclude exterior structures that are not enclosed interior rooms: gardens, pools, driveways, detached garages, open courtyards.
4. Include enclosed balconies and terraces with their type set accordingly, but only if they are part of the floor being analysed.
5. The polygon is a rough visualization hint, not a survey. Axis-aligned bounding rectangles are fine. Do not spend effort on geometric precision.
6. Slug ids must be unique across the rooms array. If you have two secondary bedrooms, use "bedroom-01" and "bedroom-02".
7. Prefer metric. Only set units="imperial" if the drawing is clearly US/UK-conventional (ft-in dimensions, ft² areas).

## Example of correct output (for shape only — do not copy values)

{
  "scale": "1:100",
  "units": "metric",
  "total_area_m2": 187.3,
  "rooms": [
    {"id":"master-bed-01","name_en":"Master Bedroom","name_ar":"غرفة النوم الرئيسية","room_type":"master_bedroom","area_m2":28.4,"polygon":[[0.05,0.08],[0.42,0.08],[0.42,0.44],[0.05,0.44]]},
    {"id":"ensuite-01","name_en":"Master Ensuite","name_ar":"حمام رئيسي","room_type":"ensuite","area_m2":7.1,"polygon":[[0.42,0.08],[0.60,0.08],[0.60,0.26],[0.42,0.26]]},
    {"id":"bedroom-01","name_en":"Bedroom 2","name_ar":"غرفة نوم 2","room_type":"bedroom","area_m2":14.2,"polygon":[[0.62,0.08],[0.92,0.08],[0.92,0.30],[0.62,0.30]]},
    {"id":"bedroom-02","name_en":"Bedroom 3","name_ar":"غرفة نوم 3","room_type":"bedroom","area_m2":13.8,"polygon":[[0.62,0.32],[0.92,0.32],[0.92,0.54],[0.62,0.54]]},
    {"id":"bathroom-01","name_en":"Shared Bathroom","name_ar":"حمام","room_type":"bathroom","area_m2":6.4,"polygon":[[0.48,0.28],[0.60,0.28],[0.60,0.42],[0.48,0.42]]},
    {"id":"living-01","name_en":"Central Living","name_ar":"صالة","room_type":"living","area_m2":36.2,"polygon":[[0.05,0.46],[0.62,0.46],[0.62,0.88],[0.05,0.88]]},
    {"id":"stairs-01","name_en":"Stairs","name_ar":"درج","room_type":"stairs","area_m2":4.8,"polygon":[[0.64,0.56],[0.78,0.56],[0.78,0.72],[0.64,0.72]]}
  ]
}
`;

type Asset =
  | { kind: "pdf"; data: string }
  | { kind: "image"; data: string; mediaType: "image/png" | "image/jpeg" };

async function loadAssetFromUrl(url: string): Promise<Asset> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch source asset (${res.status}): ${url.slice(0, 200)}`,
    );
  }
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const bytes = Buffer.from(await res.arrayBuffer());
  const lower = url.toLowerCase();

  if (contentType.includes("pdf") || lower.endsWith(".pdf")) {
    return { kind: "pdf", data: bytes.toString("base64") };
  }
  if (contentType.includes("png") || lower.endsWith(".png")) {
    return {
      kind: "image",
      data: bytes.toString("base64"),
      mediaType: "image/png",
    };
  }
  if (
    contentType.includes("jpeg") ||
    contentType.includes("jpg") ||
    /\.(jpe?g)$/.test(lower)
  ) {
    return {
      kind: "image",
      data: bytes.toString("base64"),
      mediaType: "image/jpeg",
    };
  }
  throw new Error(
    `Unsupported source type (${contentType || "unknown"}); expected PDF, PNG, or JPG.`,
  );
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractText(
  content: Anthropic.Messages.ContentBlock[],
): string {
  let out = "";
  for (const block of content) {
    if (block.type === "text") out += block.text;
  }
  return out;
}

async function askClaude(
  anthropic: Anthropic,
  asset: Asset,
  retry: { previous: string } | null,
): Promise<{ text: string; usage: Anthropic.Messages.Usage }> {
  const sourceBlock: Anthropic.Messages.ContentBlockParam =
    asset.kind === "pdf"
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: asset.data,
          },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: asset.mediaType,
            data: asset.data,
          },
        };

  const userBlocks: Anthropic.Messages.ContentBlockParam[] = [
    sourceBlock,
    {
      type: "text",
      text: retry
        ? `Your previous response could not be parsed against the schema. Here was the invalid response:

---BEGIN PREVIOUS---
${retry.previous}
---END PREVIOUS---

Reply AGAIN with ONLY a single valid JSON object matching the schema in the system prompt. No prose. No markdown fences. Fix whatever was wrong — missing fields, wrong types, invalid enum values, extra keys, or leading/trailing text.`
        : "Analyze this floorplan and return the structured JSON as specified.",
    },
  ];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    thinking: { type: "disabled" },
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userBlocks }],
  });

  return { text: extractText(response.content), usage: response.usage };
}

async function analyze(
  anthropic: Anthropic,
  asset: Asset,
): Promise<PlanAnalysis> {
  const first = await askClaude(anthropic, asset, null);
  try {
    return PlanAnalysisSchema.parse(JSON.parse(stripJsonFences(first.text)));
  } catch (firstErr) {
    console.warn(
      "[api/parse-plan] first response failed schema validation, retrying:",
      firstErr instanceof Error ? firstErr.message : firstErr,
    );
    const second = await askClaude(anthropic, asset, { previous: first.text });
    try {
      return PlanAnalysisSchema.parse(JSON.parse(stripJsonFences(second.text)));
    } catch (secondErr) {
      const detail =
        secondErr instanceof Error ? secondErr.message : String(secondErr);
      throw new Error(
        `Claude's response did not match the required schema after one retry: ${detail}`,
      );
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { plan_id?: unknown }
      | null;
    const planId = typeof body?.plan_id === "string" ? body.plan_id : null;
    if (!planId) {
      return NextResponse.json(
        { success: false, error: "plan_id is required" },
        { status: 400 },
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "ANTHROPIC_API_KEY is not configured. Add it to .env.local and restart the dev server.",
        },
        { status: 500 },
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: plan, error: planErr } = await supabase
      .from("plans")
      .select("id, pdf_url")
      .eq("id", planId)
      .single();

    if (planErr || !plan) {
      return NextResponse.json(
        { success: false, error: "Plan not found." },
        { status: 404 },
      );
    }
    if (!plan.pdf_url) {
      return NextResponse.json(
        { success: false, error: "Plan has no source URL." },
        { status: 400 },
      );
    }

    const asset = await loadAssetFromUrl(plan.pdf_url);

    const anthropic = new Anthropic({ apiKey });
    const parsed = await analyze(anthropic, asset);

    const { error: updErr } = await supabase
      .from("plans")
      .update({
        parsed_json: parsed,
        total_area_m2: parsed.total_area_m2,
      })
      .eq("id", planId);
    if (updErr) throw updErr;

    if (parsed.rooms.length > 0) {
      const rows = parsed.rooms.map((r) => ({
        plan_id: planId,
        name_en: r.name_en,
        name_ar: r.name_ar,
        room_type: r.room_type,
        area_m2: r.area_m2,
        polygon: r.polygon,
      }));
      const { error: roomsErr } = await supabase.from("rooms").insert(rows);
      if (roomsErr) throw roomsErr;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(
        "[api/parse-plan] anthropic error",
        err.status,
        err.message,
      );
      return NextResponse.json(
        { success: false, error: `Claude API error (${err.status}): ${err.message}` },
        { status: 502 },
      );
    }
    console.error("[api/parse-plan] error", err);
    const message = err instanceof Error ? err.message : "Parse failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
