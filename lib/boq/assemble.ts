// =============================================================================
// lib/boq/assemble.ts — a project's BoQ, from its stored state (H3).
//
// Moved out of app/api/generate-boq/route.ts unchanged in behaviour, so three
// callers share ONE assembly: the route (both engine paths load their inputs
// here; the deterministic path is priced here), the flag-invariance test, and
// read-only scripts that regenerate a project in-process against a database
// they must not write to (scripts/boq-dry-run-diff.ts).
//
// H3 — PRICING DOES NOT DEPEND ON FEATURE FLAGS. Nothing in this module's
// import graph reads a feature flag (lib/boq/__tests__/flag-invariance.test.ts
// walks it and fails on one). Flags decide what the UI shows; they never
// decide what a BoQ contains. U7 did this for the six element sections; H3
// did it for the P2 overlay feed, the last flag in the pricing path.
//
// `dryRun` writes nothing: no takeoff_items, no garden take-off rows. The
// caller decides whether to store the result.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAccessoryOverrides } from "@/lib/accessories/load";
import { applyElementMapping, persistTakeoffItems } from "@/lib/boq/element-map";
import { generateDeterministicBoq } from "@/lib/boq/engine";
import { appendGardenSections } from "@/lib/boq/garden-boq-feed";
import { appendJoineryAluminumSections } from "@/lib/boq/joinery-aluminum";
import { quantifyPlan, type TakeoffItem } from "@/lib/boq/quantify";
import { elementPricer } from "@/lib/boq/rates";
import type { EngineRoom, LabourRate as EngineLabourRate, PricingSku as EnginePricingSku } from "@/lib/boq/schema";
import { appendOverlaySections } from "@/lib/overlays/boq-feed";
import { derivePlanGraph } from "@/lib/plan/derive";
import { findOverlaps } from "@/lib/plan/overlaps";
import { getProposedGraph } from "@/lib/plan/snapshots";
import { loadProjectFirmOverlay, type FirmOverlay } from "@/lib/rates/firm";
import { applyOhp } from "@/lib/rates/ohp";
import { loadReferenceRows, type ReferenceRateRow } from "@/lib/rates/reference";

// Categories from pricing_skus relevant to a residential first-floor
// refit. The brief named lowercase tokens ('tile', 'sanitary', etc.) but the
// seeded CSV uses Title Case ('Tiles', 'Sanitaryware', ...) — these are the
// actual values in the table.
export const RELEVANT_SKU_CATEGORIES = [
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

export type LabourRateRow = {
  work_section: string | null;
  description: string | null;
  unit: string | null;
  rate_low_aed: number | null;
  rate_mid_aed: number | null;
  rate_high_aed: number | null;
};

export type PricingSkuRow = {
  sku: string | null;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  description_en: string | null;
  unit: string | null;
  price_aed: number | null;
  vendor: string | null;
};

export type BoqRoomRow = {
  id: string;
  name_en: string | null;
  room_type: string | null;
  area_m2: number | null;
  polygon: unknown;
};

export interface BoqInputs {
  project: { id: string; name: string | null; city: string | null };
  plan: { id: string; total_area_m2: number; parsed_json: unknown };
  rooms: BoqRoomRow[];
  labourRates: LabourRateRow[];
  skus: PricingSkuRow[];
  chosenStyleKey: string | null;
  approvedCount: number;
  takeoffItems: TakeoffItem[];
  /** L1: the project's firm overlay (tiers 1–2) — FirmOverlay.none() without a firm. */
  firm: FirmOverlay;
  /** L1: the reference book (tiers 3 and 5). */
  referenceRows: ReferenceRateRow[];
}

/** Why a project cannot be priced: the HTTP status and body the route answers with. */
export interface BoqRefusal {
  status: number;
  body: Record<string, unknown>;
}

export type LoadedBoqInputs = { inputs: BoqInputs; refusal?: never } | { inputs?: never; refusal: BoqRefusal };

const refuse = (status: number, body: Record<string, unknown>): LoadedBoqInputs => ({ refusal: { status, body: { success: false, ...body } } });

/** Everything a BoQ is priced from, loaded from the project's stored state. */
export async function loadBoqInputs(supabase: SupabaseClient, projectId: string, opts: { dryRun: boolean }): Promise<LoadedBoqInputs> {
  // 1. Load project + plan + rooms in parallel with reference data.
  const [projectRes, plansRes, labourRes, skuRes, stylesRes, approvedRes] = await Promise.all([
    supabase.from("projects").select("id, name, city").eq("id", projectId).single<BoqInputs["project"]>(),
    supabase
      .from("plans")
      .select("id, total_area_m2, parsed_json")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<{ id: string; total_area_m2: number | null; parsed_json: unknown }[]>(),
    supabase
      .from("labour_rates")
      .select("work_section, description, unit, rate_low_aed, rate_mid_aed, rate_high_aed")
      .returns<LabourRateRow[]>(),
    supabase
      .from("pricing_skus")
      .select("sku, brand, category, subcategory, description_en, unit, price_aed, vendor")
      .in("category", RELEVANT_SKU_CATEGORIES)
      .returns<PricingSkuRow[]>(),
    supabase
      .from("style_choices")
      .select("style_key, room_id, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .returns<{ style_key: string | null; room_id: string | null; created_at: string | null }[]>(),
    supabase.from("approved_designs").select("room_id, render_id").eq("project_id", projectId),
  ]);

  if (projectRes.error || !projectRes.data) return refuse(404, { error: "Project not found." });
  const project = projectRes.data;

  if (plansRes.error || !plansRes.data || plansRes.data.length === 0) {
    return refuse(400, { error: "Project has no plan yet — run /api/parse-plan first." });
  }
  const planRow = plansRes.data[0]!;
  if (!planRow.total_area_m2 || planRow.total_area_m2 <= 0) return refuse(400, { error: "Plan has no total_area_m2." });
  const plan = { ...planRow, total_area_m2: planRow.total_area_m2 };

  const { data: rooms, error: roomsErr } = await supabase
    .from("rooms")
    .select("id, name_en, room_type, area_m2, polygon")
    .eq("plan_id", plan.id)
    .returns<BoqRoomRow[]>();
  if (roomsErr || !rooms || rooms.length === 0) return refuse(400, { error: "Plan has no rooms. Re-run /api/parse-plan." });

  // D3: refuse to price a plan whose rooms overlap.
  //
  // This is the right blocking point. Overlapping rooms are fine to SAVE —
  // they are a normal transient state mid-edit — but they double-count floor
  // area (two rooms claiming the same m²) and wall area (shared-edge
  // derivation sees walls that are not there). A BoQ built on them is wrong
  // in a way no downstream check would catch. Here the user is asking for an
  // output rather than editing, so refusing is information, not interruption.
  //
  // Assessed live from the rooms just loaded, not read from plans.has_overlaps
  // — that column is a cache for the UI, and a stale cache must never be the
  // thing that decides whether a quantity is trustworthy.
  // G5: a site-reference zone the design removes is not in the garden, so a
  // zone drawn over its footprint does not overlap it.
  let removedZoneIds = new Set<string>();
  try {
    const { data: removed } = await supabase
      .from("rooms")
      .select("id")
      .eq("plan_id", plan.id)
      .eq("site_reference", true)
      .eq("disposition", "remove")
      .returns<{ id: string }[]>();
    removedZoneIds = new Set((removed ?? []).map((r) => r.id));
  } catch {
    /* pre-037 */
  }
  const overlaps = findOverlaps(
    rooms.filter((r) => !removedZoneIds.has(r.id)).map((r) => ({ id: r.id, name: r.name_en ?? "Room", polygon: r.polygon })),
  );
  if (overlaps.has_overlaps) {
    return refuse(409, {
      error: `This plan has ${overlaps.room_names.length} overlapping rooms. Resolve them on the plan before costing — overlapping rooms double-count floor and wall area.`,
      code: "plan_has_overlaps",
      overlap_pairs: overlaps.pairs,
      overlap_room_names: overlaps.room_names,
    });
  }

  if (labourRes.error || !labourRes.data || labourRes.data.length === 0) {
    return refuse(500, { error: "labour_rates table is empty — run scripts/seed-labour-rates.ts." });
  }
  if (skuRes.error || !skuRes.data || skuRes.data.length === 0) {
    return refuse(500, { error: "pricing_skus returned no rows for the curated categories — run scripts/seed-pricing.ts." });
  }

  const chosenStyleKey = stylesRes.data && stylesRes.data.length > 0 ? stylesRes.data[0]!.style_key : null;
  const approvedCount = approvedRes.data?.length ?? 0;

  // P4: per-element take-off (ground truth for element↔BoQ mapping);
  // best-effort. The mapped POMI sections are rebuilt so their quantities =
  // Σ per-room take-off and their element_refs are real element ids, and
  // takeoff_items persist for the per-room views + the tap-to-inspect panel.
  //
  // U7: this used to be gated on VIEWER_3D_ENABLED, so the six element
  // sections priced through the element take-off (a firm's `wall_plaster`
  // rate applied) with the flag ON and through the engine's rule lines
  // (`plaster.make_good`; the same firm rate ignored) with it OFF — a UI flag
  // deciding a pricing path. The mapping now runs whenever the plan yields a
  // take-off; the viewer flag gates only the viewer and inspect UI.
  let takeoffItems: TakeoffItem[] = [];
  try {
    const graph = await derivePlanGraph(projectId);
    const proposed = await getProposedGraph(projectId);
    takeoffItems = quantifyPlan(graph, { proposed });
    if (!opts.dryRun) await persistTakeoffItems(projectId, takeoffItems, supabase);
  } catch (e) {
    console.warn("[boq/assemble] P4 take-off skipped:", e instanceof Error ? e.message : e);
  }

  // L1: the books behind every rate. The project's firm overlay (tiers 1–2 —
  // FirmOverlay.none() for a project with no firm, which is every project
  // before L1) and the reference book (tiers 3 and 5). Order documented in
  // lib/rates/tiers.ts.
  const firm = await loadProjectFirmOverlay(supabase, projectId);
  const referenceRows = await loadReferenceRows(supabase);

  return {
    inputs: { project, plan, rooms, labourRates: labourRes.data, skus: skuRes.data, chosenStyleKey, approvedCount, takeoffItems, firm, referenceRows },
  };
}

/**
 * The DEFAULT path — the fully deterministic financial model (lib/boq).
 * Quantities, rate selection, SKU picks and totals are all rules-driven; no
 * LLM in the pricing path.
 */
export async function priceDeterministicBoq(supabase: SupabaseClient, projectId: string, inputs: BoqInputs, opts: { dryRun: boolean }) {
  const { rooms, labourRates, skus, chosenStyleKey, takeoffItems, firm, referenceRows } = inputs;
  const engineRooms: EngineRoom[] = rooms.map((r) => ({
    id: r.id,
    name: r.name_en ?? "(unnamed)",
    room_type: r.room_type ?? "other",
    area_m2: r.area_m2 ?? 0,
    polygon: Array.isArray(r.polygon) ? (r.polygon as unknown as number[][]) : null,
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
    referenceRows,
    firm,
  });

  // P4: rebuild mapped POMI sections from the take-off (element_refs + true
  // per-room quantities). No-op when there are no take-off items.
  // T3b: the element sections resolve through the same firm overlay.
  const mappedBoq = applyElementMapping(engineBoq, takeoffItems, elementPricer(firm, engineBoq.engine.tier));
  // P2: append Electrical Installations + Plumbing & Sanitary sections from
  // plan_fixtures counts (best-effort, no-op when there are none). H3: not
  // flag-gated — OVERLAYS_ENABLED shows the overlay layer, it does not price.
  const overlaid = await appendOverlaySections(mappedBoq, projectId, supabase);
  // Ground-truth: append Joinery + Aluminum & Glass sections (Atrium/Global
  // Creation actuals; aluminum = site_assessment allowances). Core, additive.
  const withJoinery = appendJoineryAluminumSections(overlaid, rooms);
  // G3: append the landscape sections from the drawn garden (zones, runs,
  // units, points) priced at the calibrated landscape rates. No-op for a
  // project with no outdoor zones, which is every interior project.
  const gardened = await appendGardenSections(withJoinery, projectId, supabase, { persist: !opts.dryRun, firm });
  // L1: the firm's OH&P, LAST — its own summary line over the priced
  // subtotal, never inside a rate. A no-op without a firm book.
  return applyOhp(gardened, firm.ohpPct);
}

/** Load + price in one call (the dry-run scripts and the invariance test). */
export async function assembleDeterministicBoq(supabase: SupabaseClient, projectId: string, opts: { dryRun: boolean }) {
  const loaded = await loadBoqInputs(supabase, projectId, opts);
  if (loaded.refusal) return { refusal: loaded.refusal } as const;
  return { boq: await priceDeterministicBoq(supabase, projectId, loaded.inputs, opts), inputs: loaded.inputs } as const;
}
