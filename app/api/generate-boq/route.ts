import { curateBoq, loadWithheldNames } from "@/lib/identity/curation";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { PACK_JOB_HEADER, packJobActor } from "@/lib/documents/pack-export/guard";
import { recordPilotEvent } from "@/lib/pilot/events";
import { applyElementMapping } from "@/lib/boq/element-map";
import { loadBoqInputs, priceDeterministicBoq, type LabourRateRow, type PricingSkuRow } from "@/lib/boq/assemble";
import { appendOverlaySections } from "@/lib/overlays/boq-feed";
import { appendGardenSections } from "@/lib/boq/garden-boq-feed";
import { elementPricer } from "@/lib/boq/rates";
import { applyOhp } from "@/lib/rates/ohp";
import { appendJoineryAluminumSections } from "@/lib/boq/joinery-aluminum";
import { getKgContext } from "@/lib/kg/context";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getStyleByKey } from "@/lib/styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-6";

const BodySchema = z.object({
  project_id: z.string().uuid(),
  /**
   * T1.0: assemble the BoQ exactly as a real run would and return it, but write
   * NOTHING — no boqs row, no takeoff_items, no pilot event. This is how a
   * pricing refactor proves it is byte-identical on a live project without
   * adding a BoQ (or a "time to first BoQ" event) to it. Engine path only.
   */
  dry_run: z.boolean().optional(),
});

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
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
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
    const dryRun = parsedBody.data.dry_run === true;
    // L5: the generation's duration and the signed-in actor ride on the pilot event.
    const startedAt = Date.now();
    // A pack export regenerates through this route carrying the session of
    // whoever started it (H1); inside a job the event is the JOB's — a member's
    // export is the firm's, a CLI run (a job with no actor) stays ours.
    const actor = request.headers.has(PACK_JOB_HEADER) ? await packJobActor(request) : caller.id;
    if (dryRun && process.env.BOQ_ENGINE === "llm") {
      return NextResponse.json(
        { success: false, error: "dry_run is only supported on the deterministic engine path." },
        { status: 400 },
      );
    }

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

    const supabase = getSupabaseAdmin() as unknown as SupabaseClient;

    // 1. Everything the BoQ is priced from (lib/boq/assemble.ts — shared with
    // the flag-invariance test and the read-only dry-run scripts). A refusal
    // (no plan, overlapping rooms, empty rate tables…) is answered as-is.
    const loaded = await loadBoqInputs(supabase, projectId, { dryRun });
    if (loaded.refusal) return NextResponse.json(loaded.refusal.body, { status: loaded.refusal.status });
    const { project, plan, rooms, labourRates, skus, chosenStyleKey, approvedCount, takeoffItems, firm } = loaded.inputs;
    const chosenStyle = chosenStyleKey ? getStyleByKey(chosenStyleKey) : null;

    // 2a. DEFAULT PATH — fully deterministic financial model (lib/boq).
    // Quantities, rate selection, SKU picks, and totals are all rules-driven;
    // no LLM in the pricing path. Set BOQ_ENGINE="llm" to fall back to the
    // legacy Claude-priced flow below. H3: no feature flag reaches the pricing.
    if (process.env.BOQ_ENGINE !== "llm") {
      const boq = await priceDeterministicBoq(supabase, projectId, loaded.inputs, { dryRun });

      if (dryRun) {
        return NextResponse.json({ success: true, dry_run: true, grand_total_aed: boq.grand_total_aed, boq: curateBoq(boq, await loadWithheldNames(supabase, projectId)) });
      }

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
      await recordBoqEvent(supabase, projectId, inserted.id, boq, { startedAt, actor });
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
    const mappedLlm = applyElementMapping(llmBoq, takeoffItems, elementPricer(firm, "mid"));
    const overlaidLlm = await appendOverlaySections(mappedLlm, projectId, supabase);
    const gardenedLlm = await appendGardenSections(overlaidLlm, projectId, supabase, { firm });
    const boq = applyOhp(appendJoineryAluminumSections(gardenedLlm, rooms), firm.ohpPct);

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

/**
 * G5 instrumentation: a BoQ is FULL when no counter is left untyped and no
 * site-reference item is left undecided — the first one is "time to first full
 * BoQ". L5: every project records (an interior BoQ has no garden gates and is
 * full by construction), with the generation's duration and the actor. Never throws.
 */
async function recordBoqEvent(
  supabase: SupabaseClient,
  projectId: string,
  boqId: string,
  boq: { grand_total_aed: number; garden?: { needs_selection: string[]; undecided: unknown[]; draft: { draft: boolean }; derived_lines: number } },
  opts: { startedAt: number; actor: string | null },
): Promise<void> {
  const g = boq.garden;
  await recordPilotEvent(
    supabase,
    projectId,
    "boq_generated",
    {
      boq_id: boqId,
      grand_total_aed: boq.grand_total_aed,
      full: g ? g.needs_selection.length === 0 && g.undecided.length === 0 : true,
      needs_selection: g?.needs_selection.length ?? 0,
      undecided: g?.undecided.length ?? 0,
      draft: g?.draft.draft ?? false,
      derived_lines: g?.derived_lines ?? 0,
      scope: g ? "garden" : "interior",
    },
    { actor: opts.actor, durationMs: Date.now() - opts.startedAt },
  );
}
