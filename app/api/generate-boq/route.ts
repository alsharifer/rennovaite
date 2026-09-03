import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { generateDeterministicBoq } from "@/lib/boq/engine";
import { loadAccessoryOverrides } from "@/lib/accessories/load";
import { applyElementMapping, persistTakeoffItems } from "@/lib/boq/element-map";
import { quantifyPlan, type TakeoffItem } from "@/lib/boq/quantify";
import { appendOverlaySections } from "@/lib/overlays/boq-feed";
import { appendJoineryAluminumSections } from "@/lib/boq/joinery-aluminum";
import { derivePlanGraph } from "@/lib/plan/derive";
import { getProposedGraph } from "@/lib/plan/snapshots";
import type {
  EngineRoom,
  LabourRate as EngineLabourRate,
  PricingSku as EnginePricingSku,
} from "@/lib/boq/schema";
import { getKgContext } from "@/lib/kg/context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getStyleByKey } from "@/lib/styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-6";

const BodySchema = z.object({
  project_id: z.string().uuid(),
});

// Categories from pricing_skus relevant to a residential first-floor
// refit. The brief named lowercase tokens ('tile', 'sanitary', etc.) but the
// seeded CSV uses Title Case ('Tiles', 'Sanitaryware', ...) — these are the
// actual values in the table.
const RELEVANT_SKU_CATEGORIES = [
  "Tiles",
  "Sanitaryware",
  "Bathware",
  "Bathroom Furniture",
  "Bathroom Accessories",
  "Kitchen",
  "Lighting",
  "Paint & Supplies",
  "Electrical",
  "Drywall & Ceilings",
  "Stone & Slabs",
  "Hardware",
  "Building Materials",
] as const;

const POMI_SECTIONS = [
  "Demolition",
  "Blockwork",
  "Plaster",
  "Floor Finishes",
  "Wall Finishes",
  "Joinery & Carpentry",
  "Sanitaryware",
  "Electrical",
  "Plumbing",
  "MEP / HVAC",
  "Lighting",
  "Decoration & Painting",
  "Preliminaries",
] as const;

const BoqLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1),
  rate_aed: z.number().nonnegative(),
  total_aed: z.number().nonnegative(),
  vendor_or_source: z.string(),
  notes: z.string().nullable(),
});

const BoqSectionSchema = z.object({
  work_section: z.enum(POMI_SECTIONS),
  lines: z.array(BoqLineSchema).min(1),
  section_total_aed: z.number().nonnegative(),
});

const BoqResponseSchema = z.object({
  sections: z.array(BoqSectionSchema).min(1),
  subtotal_aed: z.number().nonnegative(),
  contingency_pct: z.number().nonnegative(),
  contingency_aed: z.number().nonnegative(),
  vat_pct: z.number().nonnegative(),
  vat_aed: z.number().nonnegative(),
  grand_total_aed: z.number().nonnegative(),
});

type BoqResponse = z.infer<typeof BoqResponseSchema>;

type RoomRow = {
  id: string;
  name_en: string | null;
  room_type: string | null;
  area_m2: number | null;
};

type LabourRateRow = {
  work_section: string | null;
  description: string | null;
  unit: string | null;
  rate_low_aed: number | null;
  rate_mid_aed: number | null;
  rate_high_aed: number | null;
};

type PricingSkuRow = {
  sku: string | null;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  description_en: string | null;
  unit: string | null;
  price_aed: number | null;
  vendor: string | null;
};

type Quantity = {
  work_section: (typeof POMI_SECTIONS)[number];
  description: string;
  quantity: number;
  unit: string;
  suggested_rate_aed: number | null;
  notes: string | null;
};

// Rooms that have an FCU / receive AC. Excludes terraces, balconies, stairs,
// closets, powders, foyers, storage.
const HVAC_ROOM_TYPES = new Set([
  "master_bedroom",
  "bedroom",
  "bathroom",
  "ensuite",
  "living",
  "dining",
  "kitchen",
  "majlis",
]);
const BEDROOM_TYPES = new Set(["master_bedroom", "bedroom"]);
const BATHROOM_TYPES = new Set(["bathroom", "ensuite"]);

function computeQuantities(
  totalAreaM2: number,
  rooms: RoomRow[],
): { quantities: Quantity[]; counts: Record<string, number> } {
  const bedroomCount = rooms.filter((r) =>
    BEDROOM_TYPES.has(r.room_type ?? ""),
  ).length;
  const bathroomCount = rooms.filter((r) =>
    BATHROOM_TYPES.has(r.room_type ?? ""),
  ).length;
  const hvacRoomCount = rooms.filter((r) =>
    HVAC_ROOM_TYPES.has(r.room_type ?? ""),
  ).length;

  const counts = { bedroomCount, bathroomCount, hvacRoomCount };

  const quantities: Quantity[] = [
    {
      work_section: "Demolition",
      description:
        "Light soft strip — fixtures, finishes, no structural removal",
      quantity: round2(totalAreaM2 * 0.2),
      unit: "m3",
      suggested_rate_aed: null,
      notes: "Debris volume proxy = total_area × 0.20 m³. Refit, not strip-out.",
    },
    {
      work_section: "Plaster",
      description: "Internal plaster make-good / partial replaster",
      quantity: round2(totalAreaM2 * 1.5),
      unit: "m2",
      suggested_rate_aed: null,
      notes: "Partial wall surface (not full perimeter) — refit, not strip-out.",
    },
    {
      work_section: "Floor Finishes",
      description:
        "Floor finish (porcelain tile or engineered wood) — supply and install",
      quantity: round2(totalAreaM2),
      unit: "m2",
      suggested_rate_aed: null,
      notes:
        "Pick porcelain tile rate + supply, OR engineered wood, based on chosen style.",
    },
    {
      work_section: "Wall Finishes",
      description: "Bathroom wall tiling — supply and install",
      quantity: round2(bathroomCount * 28),
      unit: "m2",
      suggested_rate_aed: null,
      notes:
        "Typical Mudon bathroom wet-wall area = 28 m² per bathroom × " +
        `${bathroomCount} bathrooms.`,
    },
    {
      work_section: "Decoration & Painting",
      description: "Internal painting — walls and ceilings, full repaint",
      quantity: round2(totalAreaM2 * 2.4),
      unit: "m2",
      suggested_rate_aed: null,
      notes: "Surface area factor 2.4 = walls + ceiling.",
    },
    {
      work_section: "Electrical",
      description:
        "Rewire of light points, sockets, switches (no consumer-unit work)",
      quantity: round2(totalAreaM2),
      unit: "m2",
      suggested_rate_aed: 220,
      notes:
        "Per-area lump rate AED 220/m² already includes labour + cable + accessories.",
    },
    {
      work_section: "Plumbing",
      description: "Bathroom fit-out plumbing — supply lines, drainage, traps",
      quantity: bathroomCount,
      unit: "no",
      suggested_rate_aed: 9500,
      notes: "Per-bathroom lump for plumbing rough-in and fit-out.",
    },
    {
      work_section: "Sanitaryware",
      description:
        "Bathroom sanitaryware set — WC + basin + tap + shower or tub",
      quantity: bathroomCount,
      unit: "no",
      suggested_rate_aed: 11000,
      notes: "Pick representative SKUs from Sanitaryware/Bathware.",
    },
    {
      work_section: "MEP / HVAC",
      description: "Service or replace FCU per habitable room (no new ducting)",
      quantity: hvacRoomCount,
      unit: "no",
      suggested_rate_aed: 3500,
      notes: `Habitable rooms with FCU = ${hvacRoomCount}.`,
    },
    {
      work_section: "Joinery & Carpentry",
      description: "Built-in wardrobe — supply and install",
      quantity: bedroomCount,
      unit: "no",
      suggested_rate_aed: 14000,
      notes: `One wardrobe per bedroom × ${bedroomCount}.`,
    },
    {
      work_section: "Joinery & Carpentry",
      description: "Bathroom vanity cabinet with stone top",
      quantity: bathroomCount,
      unit: "no",
      suggested_rate_aed: 6500,
      notes: `One vanity per bathroom × ${bathroomCount}.`,
    },
    {
      work_section: "Joinery & Carpentry",
      description: "Internal door (flush or solid wood) — supply and hang",
      quantity: bedroomCount + bathroomCount,
      unit: "no",
      suggested_rate_aed: 2400,
      notes: `Bedrooms + bathrooms = ${bedroomCount + bathroomCount} doors.`,
    },
    {
      work_section: "Lighting",
      description:
        "Decorative + functional lighting fixtures — supply and install",
      quantity: round2(totalAreaM2),
      unit: "m2",
      suggested_rate_aed: 180,
      notes:
        "Per-area lump rate AED 180/m² covering pendants, downlights, track lighting.",
    },
  ];

  return { quantities, counts };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  let out = "";
  for (const block of content) {
    if (block.type === "text") out += block.text;
  }
  return out;
}

function formatLabourRates(rows: LabourRateRow[]): string {
  const lines = [
    "work_section | description | unit | low_aed | mid_aed | high_aed",
  ];
  for (const r of rows) {
    lines.push(
      [
        r.work_section ?? "",
        r.description ?? "",
        r.unit ?? "",
        r.rate_low_aed ?? "",
        r.rate_mid_aed ?? "",
        r.rate_high_aed ?? "",
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

function formatPricingSkus(rows: PricingSkuRow[]): string {
  const lines = [
    "sku | brand | category | subcategory | description | unit | price_aed | vendor",
  ];
  for (const r of rows) {
    lines.push(
      [
        r.sku ?? "",
        r.brand ?? "",
        r.category ?? "",
        r.subcategory ?? "",
        (r.description_en ?? "").replace(/\s+/g, " ").slice(0, 120),
        r.unit ?? "",
        r.price_aed ?? "",
        r.vendor ?? "",
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

// =============================================================================
// System prompt — static reference data + rules. Cached on the wire.
// =============================================================================

function buildSystemPrompt(
  labourRates: LabourRateRow[],
  skus: PricingSkuRow[],
): string {
  return `You are the BoQ (Bill of Quantities) generator for RennovAIte, an AI villa renovation platform in Dubai. You convert a set of pre-computed renovation quantities into a fully-priced BoQ formatted using POMI (Principles of Measurement International) work sections.

## Your job

You are given:
1. A list of pre-computed quantities for a specific villa renovation. Each entry already specifies the POMI work section, a description, the quantity, and the unit. For some entries a per-unit AED rate is supplied; use that rate as-is. For others you must pick a rate from the labour_rates table below, optionally combined with a material rate from pricing_skus.
2. The chosen renovation style and a brief project context.

You return a single JSON object with a fully-priced BoQ. The downstream system uses POMI section names for QS review — section names must match EXACTLY.

## Output schema

Return a JSON object with this exact shape. No prose, no markdown fences, no extra keys.

{
  "sections": [
    {
      "work_section": "<one of the POMI section names listed below>",
      "lines": [
        {
          "description": "<short human-readable line description>",
          "quantity": <number>,
          "unit": "<unit string, e.g. 'm2', 'm3', 'no', 'lm'>",
          "rate_aed": <number, AED per unit>,
          "total_aed": <number, rate_aed × quantity, rounded to nearest AED>,
          "vendor_or_source": "<labour_rates row reference OR pricing_skus SKU OR vendor name>",
          "notes": "<string OR null>"
        }
      ],
      "section_total_aed": <number, sum of line total_aed, rounded to nearest AED>
    }
  ],
  "subtotal_aed": <number, sum of all section_total_aed including Preliminaries>,
  "contingency_pct": 8,
  "contingency_aed": <number, 8% of subtotal_aed, rounded to nearest AED>,
  "vat_pct": 5,
  "vat_aed": <number, 5% of (subtotal_aed + contingency_aed), rounded to nearest AED>,
  "grand_total_aed": <number, subtotal_aed + contingency_aed + vat_aed>
}

## POMI work sections (use exactly these strings)

Demolition, Blockwork, Plaster, Floor Finishes, Wall Finishes, Joinery & Carpentry, Sanitaryware, Electrical, Plumbing, MEP / HVAC, Lighting, Decoration & Painting, Preliminaries

## Rules

1. **Use every supplied quantity.** Do not drop or merge them — each input quantity becomes at least one BoQ line. You may split a single input quantity across multiple lines (e.g. floor finish broken into material + labour) but the line totals must sum to a sensible figure for that quantity.
2. **Use the supplied rate when provided.** If the input quantity has \`suggested_rate_aed\`, set \`rate_aed\` to that value and compute \`total_aed = rate × quantity\`. Cite it as "computed per project brief" in vendor_or_source.
3. **For quantities without a supplied rate**, pick from \`labour_rates\` (mid band by default — flex to low if the style is value-oriented or high if it's premium). For material-heavy items (tile, sanitaryware, lighting) you may add a separate material line citing a specific SKU from \`pricing_skus\`. When you do, the unit and quantity must match — m² of tile material at AED X/m², plus m² of tiling labour at AED Y/m².
4. **Cite sources in vendor_or_source.** Either: (a) the labour_rates row description, (b) a pricing_skus SKU code, or (c) a vendor name from pricing_skus. Be specific — "RAK Ceramics — RAK-MRB-MAXIMUSC-60X60" is better than "tile supplier".
5. **Add a Preliminaries section** at 8% of the sum of all other section totals. Lines inside: site setup, permits, skip hire, etc. — split however is sensible, but the section_total_aed must equal 8% of (sum of every other section_total_aed). Round to nearest AED.
6. **subtotal_aed** = sum of ALL section totals INCLUDING Preliminaries.
7. **Round every line total and section total to the nearest AED.** No decimals on totals.
8. **POMI section names must be EXACT.** "MEP / HVAC" includes the space-slash-space. "Joinery & Carpentry" includes the ampersand. "Decoration & Painting" — same.
9. **Group lines by section.** Each work_section appears at most once in the sections array; merge all lines for that section into a single object.
10. **Use the chosen style** to bias material choices and rate band: budget styles (scandi-arabic, coastal-emirati, contemporary-majlis) lean toward low–mid; premium (luxe-minimal, andalusian-heritage, modern-hijazi) lean toward mid–high.

## Reference: labour_rates (all rows)

${formatLabourRates(labourRates)}

## Reference: pricing_skus (curated subset)

${formatPricingSkus(skus)}
`;
}

async function askClaude(
  anthropic: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  retry: { previous: string; error: string } | null,
): Promise<{ text: string; usage: Anthropic.Messages.Usage }> {
  const userText = retry
    ? `Your previous response could not be validated. Schema error:

${retry.error}

Previous response:
---BEGIN PREVIOUS---
${retry.previous}
---END PREVIOUS---

Reply AGAIN with ONLY a single valid JSON object matching the schema in the system prompt. Fix whatever was wrong. No prose. No markdown fences.`
    : userPrompt;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    thinking: { type: "disabled" },
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userText }],
  });

  return { text: extractText(response.content), usage: response.usage };
}

async function generateBoq(
  anthropic: Anthropic,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ boq: BoqResponse; usage: Anthropic.Messages.Usage[] }> {
  const usages: Anthropic.Messages.Usage[] = [];
  const first = await askClaude(anthropic, systemPrompt, userPrompt, null);
  usages.push(first.usage);
  try {
    const parsed = BoqResponseSchema.parse(
      JSON.parse(stripJsonFences(first.text)),
    );
    return { boq: normalizeTotals(parsed), usage: usages };
  } catch (firstErr) {
    const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    console.warn(
      "[api/generate-boq] first response failed schema validation, retrying:",
      errMsg,
    );
    const second = await askClaude(anthropic, systemPrompt, userPrompt, {
      previous: first.text,
      error: errMsg,
    });
    usages.push(second.usage);
    const parsed = BoqResponseSchema.parse(
      JSON.parse(stripJsonFences(second.text)),
    );
    return { boq: normalizeTotals(parsed), usage: usages };
  }
}

// Claude reliably produces correct line items and rates but occasionally slips
// on arithmetic (e.g. wrong subtotal_aed that doesn't sum the section totals).
// We trust the structure but recompute every derived total from line rates ×
// quantities, then apply the project-spec contingency/VAT chain on top.
function normalizeTotals(boq: BoqResponse): BoqResponse {
  const normalizedSections = boq.sections.map((section) => {
    const normalizedLines = section.lines.map((line) => ({
      ...line,
      total_aed: Math.round(line.quantity * line.rate_aed),
    }));
    const section_total_aed = normalizedLines.reduce(
      (sum, l) => sum + l.total_aed,
      0,
    );
    return { ...section, lines: normalizedLines, section_total_aed };
  });

  const subtotal_aed = normalizedSections.reduce(
    (sum, s) => sum + s.section_total_aed,
    0,
  );
  const contingency_pct = boq.contingency_pct || 8;
  const vat_pct = boq.vat_pct || 5;
  const contingency_aed = Math.round((subtotal_aed * contingency_pct) / 100);
  const vat_aed = Math.round(
    ((subtotal_aed + contingency_aed) * vat_pct) / 100,
  );
  const grand_total_aed = subtotal_aed + contingency_aed + vat_aed;

  return {
    sections: normalizedSections,
    subtotal_aed,
    contingency_pct,
    contingency_aed,
    vat_pct,
    vat_aed,
    grand_total_aed,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    const parsedBody = BodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false,
          error: "project_id (uuid) is required.",
        },
        { status: 400 },
      );
    }
    const projectId = parsedBody.data.project_id;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "ANTHROPIC_API_KEY is not configured. Add it to .env.local and restart.",
        },
        { status: 500 },
      );
    }

    const supabase = getSupabaseAdmin();
    // labour_rates and pricing_skus aren't in database.types.ts yet, so we
    // call them via an untyped facet of the same client.
    const supabaseUntyped = supabase as unknown as SupabaseClient;

    // 1. Load project + plan + rooms in parallel with reference data.
    const [
      projectRes,
      plansRes,
      labourRes,
      skuRes,
      stylesRes,
      approvedRes,
    ] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, city")
        .eq("id", projectId)
        .single(),
      supabase
        .from("plans")
        .select("id, total_area_m2, parsed_json")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1),
      supabaseUntyped
        .from("labour_rates")
        .select(
          "work_section, description, unit, rate_low_aed, rate_mid_aed, rate_high_aed",
        )
        .returns<LabourRateRow[]>(),
      supabaseUntyped
        .from("pricing_skus")
        .select(
          "sku, brand, category, subcategory, description_en, unit, price_aed, vendor",
        )
        .in("category", RELEVANT_SKU_CATEGORIES)
        .returns<PricingSkuRow[]>(),
      supabaseUntyped
        .from("style_choices")
        .select("style_key, room_id, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .returns<{ style_key: string | null; room_id: string | null; created_at: string | null }[]>(),
      supabase
        .from("approved_designs")
        .select("room_id, render_id")
        .eq("project_id", projectId),
    ]);

    if (projectRes.error || !projectRes.data) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 },
      );
    }
    const project = projectRes.data;

    if (plansRes.error || !plansRes.data || plansRes.data.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Project has no plan yet — run /api/parse-plan first.",
        },
        { status: 400 },
      );
    }
    const plan = plansRes.data[0]!;
    if (!plan.total_area_m2 || plan.total_area_m2 <= 0) {
      return NextResponse.json(
        { success: false, error: "Plan has no total_area_m2." },
        { status: 400 },
      );
    }

    const { data: rooms, error: roomsErr } = await supabase
      .from("rooms")
      .select("id, name_en, room_type, area_m2, polygon")
      .eq("plan_id", plan.id);
    if (roomsErr || !rooms || rooms.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Plan has no rooms. Re-run /api/parse-plan.",
        },
        { status: 400 },
      );
    }

    if (labourRes.error || !labourRes.data || labourRes.data.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "labour_rates table is empty — run scripts/seed-labour-rates.ts.",
        },
        { status: 500 },
      );
    }

    if (skuRes.error || !skuRes.data || skuRes.data.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "pricing_skus returned no rows for the curated categories — run scripts/seed-pricing.ts.",
        },
        { status: 500 },
      );
    }

    const labourRates = labourRes.data;
    const skus = skuRes.data;
    const chosenStyleKey =
      stylesRes.data && stylesRes.data.length > 0
        ? stylesRes.data[0]!.style_key
        : null;
    const chosenStyle = chosenStyleKey ? getStyleByKey(chosenStyleKey) : null;
    const approvedCount = approvedRes.data?.length ?? 0;

    // P4: per-element take-off (ground truth for element↔BoQ mapping). Gated
    // with the viewer/inspect feature; best-effort. When on, the mapped POMI
    // sections are rebuilt so their quantities = Σ per-room take-off and their
    // element_refs are real element ids, and takeoff_items persist for the
    // per-room views + the tap-to-inspect panel.
    const p4Enabled = process.env.VIEWER_3D_ENABLED === "true";
    let takeoffItems: TakeoffItem[] = [];
    if (p4Enabled) {
      try {
        const graph = await derivePlanGraph(projectId);
        const proposed = await getProposedGraph(projectId);
        takeoffItems = quantifyPlan(graph, { proposed });
        await persistTakeoffItems(projectId, takeoffItems, supabaseUntyped);
      } catch (e) {
        console.warn(
          "[api/generate-boq] P4 take-off skipped:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    // 2a. DEFAULT PATH — fully deterministic financial model (lib/boq).
    // Quantities, rate selection, SKU picks, and totals are all rules-driven;
    // no LLM in the pricing path. Set BOQ_ENGINE="llm" to fall back to the
    // legacy Claude-priced flow below.
    if (process.env.BOQ_ENGINE !== "llm") {
      const engineRooms: EngineRoom[] = rooms.map((r) => ({
        id: r.id,
        name: r.name_en ?? "(unnamed)",
        room_type: r.room_type ?? "other",
        area_m2: r.area_m2 ?? 0,
        polygon: Array.isArray(r.polygon)
          ? (r.polygon as unknown as number[][])
          : null,
      }));
      const { boq: engineBoq } = generateDeterministicBoq({
        rooms: engineRooms,
        labourRates: labourRates.map(
          (r): EngineLabourRate => ({
            work_section: r.work_section ?? "",
            description: r.description ?? "",
            unit: r.unit ?? "",
            rate_low_aed: r.rate_low_aed ?? 0,
            rate_mid_aed: r.rate_mid_aed ?? 0,
            rate_high_aed: r.rate_high_aed ?? 0,
          }),
        ),
        skus: skus.map(
          (s): EnginePricingSku => ({
            sku: s.sku ?? "",
            brand: s.brand ?? "",
            category: s.category ?? "",
            subcategory: s.subcategory ?? "",
            description_en: s.description_en ?? "",
            unit: s.unit ?? "",
            price_aed: s.price_aed ?? 0,
            vendor: s.vendor ?? "",
          }),
        ),
        styleKey: chosenStyleKey,
        // D1: user-chosen accessories replace the R-xx rate for their own
        // item_key only. `{}` before migration 028 or with nothing selected,
        // which reproduces the pre-D1 BoQ byte for byte.
        accessorySelections: await loadAccessoryOverrides(projectId),
      });

      // P4: rebuild mapped POMI sections from the take-off (element_refs + true
      // per-room quantities). No-op when there are no take-off items.
      const mappedBoq = applyElementMapping(engineBoq, takeoffItems);
      // P2: append Electrical Installations + Plumbing & Sanitary sections from
      // plan_fixtures counts (flagged, best-effort, no-op when off/empty).
      const overlaid = await appendOverlaySections(
        mappedBoq,
        projectId,
        supabaseUntyped,
      );
      // Ground-truth: append Joinery + Aluminum & Glass sections (Atrium/Global
      // Creation actuals; aluminum = site_assessment allowances). Core, additive.
      const boq = appendJoineryAluminumSections(overlaid, rooms);

      const { data: inserted, error: insertErr } = await supabase
        .from("boqs")
        .insert({
          project_id: projectId,
          total_aed: boq.grand_total_aed,
          sections: boq,
          locked_at: null,
        })
        .select("id")
        .single();
      if (insertErr || !inserted) {
        throw insertErr ?? new Error("Failed to insert BoQ row.");
      }
      console.log(
        `[api/generate-boq] deterministic engine project=${projectId} grand_total=AED ${boq.grand_total_aed}`,
      );
      return NextResponse.json({
        success: true,
        boq_id: inserted.id,
        grand_total_aed: boq.grand_total_aed,
      });
    }

    // 2b. LEGACY PATH — Claude prices the BoQ (kept behind BOQ_ENGINE="llm").
    const { quantities, counts } = computeQuantities(plan.total_area_m2, rooms);

    // KG grounding (feature-flagged, safe fallback). When active, the retrieved
    // design context grounds material/fixture/vendor picks and regulations. It
    // is advisory input only — the POMI grouping and zod schema below are
    // unchanged. getKgContext never throws; on failure it returns "" and the
    // BoQ is generated exactly as before.
    const { context: kgContext, bundleId: kgBundleId } = await getKgContext({
      styleKey: chosenStyleKey,
      project,
    });

    // 3. Build the prompts.
    const systemPrompt = buildSystemPrompt(labourRates, skus);

    const userPrompt = `# Project context

- Project: ${project.name ?? "Untitled"} (${project.city ?? "Dubai"})
- Plan total area: ${plan.total_area_m2} m²
- Room count: ${rooms.length} (${counts.bedroomCount} bedrooms, ${counts.bathroomCount} bathrooms, ${counts.hvacRoomCount} habitable rooms with FCU)
- Chosen style: ${
      chosenStyle
        ? `${chosenStyle.name_en} (${chosenStyle.key}) — ${chosenStyle.one_line}${
            chosenStyle.cost_delta_aed !== 0
              ? ` Style cost delta vs baseline: AED ${chosenStyle.cost_delta_aed >= 0 ? "+" : ""}${chosenStyle.cost_delta_aed}.`
              : ""
          }`
        : "none yet — assume a neutral mid-market direction"
    }
- Approved designs: ${approvedCount} room(s) have an approved render.

# Rooms on the plan

${rooms
  .map(
    (r) =>
      `- ${r.name_en ?? "(unnamed)"} | type=${r.room_type ?? "other"} | area=${r.area_m2 ?? 0} m²`,
  )
  .join("\n")}

# Pre-computed quantities (use ALL of these as inputs)

${quantities
  .map(
    (q, i) =>
      `${i + 1}. [${q.work_section}] ${q.description}\n   quantity=${q.quantity} ${q.unit}` +
      (q.suggested_rate_aed != null
        ? `, suggested_rate_aed=${q.suggested_rate_aed}`
        : "") +
      (q.notes ? `\n   notes: ${q.notes}` : ""),
  )
  .join("\n\n")}

Produce the priced BoQ as JSON per the schema in the system prompt. Reply with JSON only.`;

    // P4: inject computed room areas as ground truth so the LLM's floor/ceiling
    // quantities converge on the graph (and QS validation tightens).
    const roomAreaBlock =
      takeoffItems.length > 0
        ? "\n\n# ROOM AREAS (computed, do not re-estimate)\n" +
          takeoffItems
            .filter((t) => t.work_item_key === "floor_finish")
            .map((t) => `- room ${t.room_id}: ${t.qty} m²`)
            .join("\n")
        : "";

    const composedUserPrompt =
      (kgContext ? `${userPrompt}\n\n${kgContext}` : userPrompt) + roomAreaBlock;
    if (kgContext) {
      console.log(
        `[api/generate-boq] KG context injected (bundle=${kgBundleId}) — composed user prompt:\n${composedUserPrompt}`,
      );
    }

    // 4. Call Claude with retry.
    const anthropic = new Anthropic({ apiKey });
    const { boq: llmBoq, usage } = await generateBoq(
      anthropic,
      systemPrompt,
      composedUserPrompt,
    );

    // P4: rebuild mapped sections from the take-off, then P2 overlays, then the
    // ground-truth Joinery + Aluminum & Glass sections.
    const mappedLlm = applyElementMapping(llmBoq, takeoffItems);
    const overlaidLlm = await appendOverlaySections(mappedLlm, projectId, supabaseUntyped);
    const boq = appendJoineryAluminumSections(overlaidLlm, rooms);

    // 5. Save and return.
    const { data: inserted, error: insertErr } = await supabase
      .from("boqs")
      .insert({
        project_id: projectId,
        total_aed: boq.grand_total_aed,
        sections: boq,
        locked_at: null,
        // Only include kg_bundle_id when KG grounding actually ran. Omitting it
        // when null keeps this insert byte-identical to the pre-KG behaviour, so
        // the route works even before migration 008 adds the column.
        ...(kgBundleId ? { kg_bundle_id: kgBundleId } : {}),
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      throw insertErr ?? new Error("Failed to insert BoQ row.");
    }

    console.log(
      `[api/generate-boq] project=${projectId} grand_total=AED ${boq.grand_total_aed} attempts=${usage.length}`,
    );

    return NextResponse.json({
      success: true,
      boq_id: inserted.id,
      grand_total_aed: boq.grand_total_aed,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error("[api/generate-boq] anthropic error", err.status, err.message);
      return NextResponse.json(
        {
          success: false,
          error: `Claude API error (${err.status}): ${err.message}`,
        },
        { status: 502 },
      );
    }
    console.error("[api/generate-boq] error", err);
    const message = err instanceof Error ? err.message : "BoQ generation failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
