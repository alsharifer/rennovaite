// =============================================================================
// lib/boq/garden-takeoff.ts — deterministic landscape take-off (garden pilot G2).
//
// Zones, runs, discrete units and points → priced ScopeItems, using the Villa 94
// net rates in lib/ground-truth/villa94-garden.ts. Pure: same input → identical
// output, no LLM, no I/O.
//
// This is a SEPARATE take-off from lib/boq/takeoff.ts rather than more branches
// inside it. The interior take-off's rules are F-xx formulas over rooms with
// ceilings and wet walls; a garden shares none of that, and the one thing the
// two must never do is leak into each other — G1 already put landscape zones in
// their own bucket (lib/boq/rules.ts LANDSCAPE_TYPES) precisely so a lawn could
// not be priced as a terrace floor.
//
// Rates come from the ground-truth module, NOT from lib/boq/rates.ts. The
// RateResolver is driven by RATE_RULES over labour_rates + pricing_skus and
// throws on an unknown item_key, so routing garden keys through it would have
// meant either inventing labour_rates rows or editing interior rules. Neither
// is acceptable when the requirement is that zero interior rows move.
// =============================================================================

import {
  GARDEN_RATES,
  INCLUSIVE_SCOPE,
  ABSORBED_SCOPE,
  PERGOLA_INCLUDED_DOWNLIGHTS,
  PUBLIC_SOURCE_LABEL,
  QUANTITY_INCLUSIONS,
  getGardenRate,
} from "@/lib/ground-truth/villa94-garden";

import type { PomiSection, ScopeItem } from "./schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Input -------------------------------------------------------------------

/** A drawn zone (a `rooms` row with an outdoor type — see lib/plan/zones.ts). */
export interface GardenZone {
  id: string;
  name: string;
  /** Outdoor token: paving | artificial_grass | planting_bed | deck | path | structure | pool */
  kind: string;
  area_m2: number;
}

/**
 * A linear run (a `plan_elements` row — see lib/plan/elements.ts).
 *
 * `variant` exists for one reason: a BBQ counter and a bar counter are both
 * `counter_run` in the plan vocabulary but differ by AED 968/lm, because one
 * carries a sink, water, drainage and sockets. Defaulting to the bar rate is
 * the conservative choice — a counter nobody has described as a BBQ should not
 * silently price as one.
 */
export interface GardenRun {
  id: string;
  kind: "boundary_wall" | "bench_run" | "planter_run" | "counter_run";
  length_m: number;
  variant?: "bbq" | "bar";
}

/** A discrete built item that is neither a zone nor a run. */
export interface GardenUnit {
  id: string;
  kind: "planter_box" | "wall_feature" | "bbq_grill";
}

/** A placed point (a `plan_fixtures` row). `zone_id` is its room_id. */
export interface GardenPoint {
  id: string;
  type: string;
  zone_id: string | null;
}

export interface GardenTakeoffInput {
  zones: GardenZone[];
  runs?: GardenRun[];
  units?: GardenUnit[];
  points?: GardenPoint[];
}

/** One row per (zone or element) × work item — the per-element ground truth
 *  behind an aggregated BoQ line, so a zone can be traced to what it costs. */
export interface GardenTakeoffElement {
  item_key: string;
  /** Zone id, run id, unit id or point id. */
  element_id: string;
  qty: number;
  unit: string;
}

export interface GardenTakeoff {
  items: ScopeItem[];
  /** Per-element breakdown; Σ qty per item_key equals that item's quantity. */
  elements: GardenTakeoffElement[];
  summary: {
    pavedAreaM2: number;
    grassAreaM2: number;
    plantingAreaM2: number;
    structurePlanAreaM2: number;
    /** Lighting points actually priced, after the pergola deduction. */
    lightingPoints: number;
    /** Points suppressed because a pergola's rate already carries them. */
    lightingPointsIncludedInStructures: number;
    boundaryLightPoints: number;
  };
}

// --- Section map -------------------------------------------------------------

const SECTION: Record<string, PomiSection> = {
  "garden.preliminaries": "Preliminaries",
  "garden.mobilization": "Preliminaries",
  "garden.demolition": "Demolition",
  "garden.pcc_base": "Hardscape & Structures",
  "garden.paving_install": "Hardscape & Structures",
  "garden.tile_supply": "Hardscape & Structures",
  "garden.counter_bbq": "Hardscape & Structures",
  "garden.counter_bar": "Hardscape & Structures",
  "garden.bench_run": "Hardscape & Structures",
  "garden.planter_bench_run": "Hardscape & Structures",
  "garden.planter_box": "Hardscape & Structures",
  "garden.wall_feature": "Hardscape & Structures",
  "garden.pergola": "Hardscape & Structures",
  "garden.bbq_grill": "Hardscape & Structures",
  "garden.grass_supply": "Soft Landscaping",
  "garden.grass_install": "Soft Landscaping",
  "garden.irrigation": "Irrigation",
  "garden.light_cabling": "Electrical & Lighting",
  "garden.light_fitting": "Electrical & Lighting",
  "garden.boundary_light": "Electrical & Lighting",
};

/** Zone kinds that get a hard paved surface (PCC + install + tile supply). */
const PAVED_KINDS = new Set(["paving", "path"]);

/**
 * Villa 94 quoted 75 m² of PCC against 87 m² of paving install. The sheet flags
 * the quote areas as generous; carrying the discrepancy forward as a rule would
 * bake one contractor's estimating slack into every future garden, so the rule
 * measures both off the drawn area and the dry-run reports the gap instead.
 */
const VILLA94_PCC_VS_PAVING_NOTE =
  "PCC and paving measured off the same drawn area; the reference project quoted 75 m² PCC against 87 m² paving";

/**
 * Irrigation is an ALLOWANCE, not a formula.
 *
 * The reference project gives one lump against 7.8 lm of planter and no
 * separately recorded planting area. Turning that into a per-metre rate would
 * dress a single datapoint up as something that scales, and it would be wrong
 * in a way nobody could see: the line would look measured. So the take-off
 * emits ONE lump at three coarse sizes, flagged both site_assessment (the rate
 * needs confirming against the actual garden) and qty_derived (the size band is
 * inferred, not measured).
 *
 * The bands earn a real driver at n >= 3 comparable gardens. Until then a
 * coarse band is the honest shape: it says "about this much", which is what we
 * actually know.
 */
const IRRIGATION_BANDS: readonly { max_driver: number; factor: number; label: string }[] = [
  { max_driver: 4, factor: 0.6, label: "small" },
  { max_driver: 16, factor: 1, label: "comparable" },
  { max_driver: Infinity, factor: 1.6, label: "large" },
];

// --- Rules -------------------------------------------------------------------

function rate(item_key: string): number {
  const g = getGardenRate(item_key);
  if (!g) throw new Error(`No garden rate for "${item_key}".`);
  return g.net_rate;
}

function label(item_key: string): string {
  return getGardenRate(item_key)?.label ?? item_key;
}

function unitOf(item_key: string): string {
  return getGardenRate(item_key)?.unit ?? "no";
}

function item(
  rule_id: string,
  item_key: string,
  quantity: number,
  measurement: string,
  extra: Partial<ScopeItem> = {},
): ScopeItem {
  const section = SECTION[item_key];
  if (!section) throw new Error(`No POMI section mapped for "${item_key}".`);
  return {
    rule_id,
    work_section: section,
    item_key,
    description: label(item_key),
    quantity: round2(quantity),
    unit: unitOf(item_key),
    measurement,
    ...extra,
  };
}

/**
 * Compute the landscape take-off.
 *
 * Every emitted line is a quantity the drawing supports. Where a quantity is
 * inferred rather than measured (the irrigation lump), the line says so.
 */
export function computeGardenTakeoff(input: GardenTakeoffInput): GardenTakeoff {
  const zones = input.zones ?? [];
  const runs = input.runs ?? [];
  const units = input.units ?? [];
  const points = input.points ?? [];

  const areaOf = (kinds: Set<string> | string) =>
    round2(
      zones
        .filter((z) => (typeof kinds === "string" ? z.kind === kinds : kinds.has(z.kind)))
        .reduce((s, z) => s + (z.area_m2 || 0), 0),
    );

  const pavedAreaM2 = areaOf(PAVED_KINDS);
  const grassAreaM2 = areaOf("artificial_grass");
  const plantingAreaM2 = areaOf("planting_bed");
  const structureZones = zones.filter((z) => z.kind === "structure");
  const structurePlanAreaM2 = round2(
    structureZones.reduce((s, z) => s + (z.area_m2 || 0), 0),
  );

  const items: ScopeItem[] = [];
  const elements: GardenTakeoffElement[] = [];
  const per = (item_key: string, rows: { id: string; qty: number }[]) => {
    const unit = unitOf(item_key);
    for (const r of rows) {
      if (r.qty > 0) elements.push({ item_key, element_id: r.id, qty: round2(r.qty), unit });
    }
  };
  const zonesOf = (kinds: Set<string> | string) =>
    zones
      .filter((z) => (typeof kinds === "string" ? z.kind === kinds : kinds.has(z.kind)))
      .map((z) => ({ id: z.id, qty: z.area_m2 || 0 }));

  // --- Project lumps (GL-01..03) ---------------------------------------------
  // Emitted only when there is garden scope at all, so an interior project that
  // somehow reaches this function gets an empty take-off rather than three lumps.
  const hasScope =
    zones.length > 0 || runs.length > 0 || units.length > 0 || points.length > 0;
  if (hasScope) {
    items.push(
      item("GL-01", "garden.preliminaries", 1, "per project — approvals, admin, shop drawings"),
      item("GL-02", "garden.mobilization", 1, "per project — debris removal, setting out, protection, supervision"),
      item(
        "GL-03",
        "garden.demolition",
        1,
        `per project — strip-out of ${round2(pavedAreaM2 + grassAreaM2)} m² existing hardscape and grass (lump for a garden this size, not scaled)`,
      ),
    );
  }

  // --- Hardscape (GL-04..06) -------------------------------------------------
  //
  // The paved SURFACE includes the ground under a structure zone. A pergola
  // standing on a terrace does not remove the paving beneath it: the slab is
  // poured, the tile is laid, and only the pergola's own superstructure is in
  // its all-in rate. Measuring the surface as "paved zones minus structures"
  // under-measured every hardscape line by the structure footprint.
  const pavedSurfaceM2 = round2(pavedAreaM2 + structurePlanAreaM2);
  const surfaceNote =
    structurePlanAreaM2 > 0
      ? `${pavedAreaM2} m² paved zones + ${structurePlanAreaM2} m² under structures`
      : `paved zone area = ${pavedAreaM2} m²`;
  if (pavedSurfaceM2 > 0) {
    items.push(
      item("GL-04", "garden.pcc_base", pavedSurfaceM2, `${surfaceNote} (${VILLA94_PCC_VS_PAVING_NOTE})`),
      item("GL-05", "garden.paving_install", pavedSurfaceM2, surfaceNote),
      // The supply rate is per m² PURCHASED, and the reference order covered all
      // paving AND cladding from 66.24 m² against 87 m² of quoted paving. Drawn
      // area is therefore an upper bound on what gets bought, and the line goes
      // to the QS flagged rather than priced as though it were measured.
      item("GL-06", "garden.tile_supply", pavedSurfaceM2, `${surfaceNote}; tile is bought per m² PURCHASED, which site setting-out usually reduces`, {
        rate_status: "site_assessment",
      }),
    );
    const pavedRows = [...zonesOf(PAVED_KINDS), ...zonesOf("structure")];
    per("garden.pcc_base", pavedRows);
    per("garden.paving_install", pavedRows);
    per("garden.tile_supply", pavedRows);
  }

  // --- Softscape (GL-07..08) -------------------------------------------------
  if (grassAreaM2 > 0) {
    items.push(
      item("GL-07", "garden.grass_supply", grassAreaM2, `artificial grass zone area = ${grassAreaM2} m²`),
      // Inclusive of base prep, black sand and PCC borders — see INCLUSIVE_SCOPE.
      item("GL-08", "garden.grass_install", grassAreaM2, `artificial grass zone area = ${grassAreaM2} m² (incl. base prep, sand bed and borders)`),
    );
    const grassRows = zonesOf("artificial_grass");
    per("garden.grass_supply", grassRows);
    per("garden.grass_install", grassRows);
  }

  // --- Runs (GL-09..11) ------------------------------------------------------
  // `variant` matches EXACTLY — an untyped counter is not a bar counter, it is
  // an unanswered question, and the two are totalled separately below.
  const runTotal = (kind: GardenRun["kind"], variant?: GardenRun["variant"]) =>
    round2(
      runs
        .filter((r) => r.kind === kind && (variant === undefined || r.variant === variant))
        .reduce((s, r) => s + (r.length_m || 0), 0),
    );

  const runRows = (kind: GardenRun["kind"], variant?: GardenRun["variant"]) =>
    runs
      .filter((r) => r.kind === kind && (variant === undefined || r.variant === variant))
      .map((r) => ({ id: r.id, qty: r.length_m || 0 }));

  const benchLm = runTotal("bench_run");
  if (benchLm > 0) {
    items.push(item("GL-09", "garden.bench_run", benchLm, `Σ bench run length = ${benchLm} lm`));
    per("garden.bench_run", runRows("bench_run"));
  }
  const planterLm = runTotal("planter_run");
  if (planterLm > 0) {
    items.push(item("GL-10", "garden.planter_bench_run", planterLm, `Σ planter run length = ${planterLm} lm`));
    per("garden.planter_bench_run", runRows("planter_run"));
  }
  const bbqLm = runTotal("counter_run", "bbq");
  if (bbqLm > 0) {
    // Inclusive of its own water, drainage and sockets — see INCLUSIVE_SCOPE.
    items.push(item("GL-11a", "garden.counter_bbq", bbqLm, `Σ BBQ counter length = ${bbqLm} lm (incl. sink, water, drainage and sockets)`));
    per("garden.counter_bbq", runRows("counter_run", "bbq"));
  }
  // A counter nobody has typed is priced as a bar counter — the cheaper of the
  // two — and flagged for it. Silently defaulting would understate by AED
  // 968/lm AND lose the MEP inclusion that stops the sockets being counted
  // twice, so the default must be visible on the line rather than implied.
  const barChosenLm = runTotal("counter_run", "bar");
  const barUntypedLm = round2(
    runs.filter((r) => r.kind === "counter_run" && r.variant === undefined)
      .reduce((s, r) => s + (r.length_m || 0), 0),
  );
  if (barChosenLm > 0 || barUntypedLm > 0) {
    const total = round2(barChosenLm + barUntypedLm);
    items.push(
      item("GL-11b", "garden.counter_bar", total, `Σ bar counter length = ${total} lm${barUntypedLm > 0 ? ` (${barUntypedLm} lm not yet typed — priced as a bar counter, the cheaper of the two)` : ""}`,
        barUntypedLm > 0 ? { rate_status: "needs_selection" } : {}),
    );
    per("garden.counter_bar", [
      ...runRows("counter_run", "bar"),
      ...runs.filter((r) => r.kind === "counter_run" && r.variant === undefined)
        .map((r) => ({ id: r.id, qty: r.length_m || 0 })),
    ]);
  }

  // --- Discrete units (GL-12..13, GL-19) -------------------------------------
  const unitCount = (kind: GardenUnit["kind"]) => units.filter((u) => u.kind === kind).length;
  const planterBoxes = unitCount("planter_box");
  const unitRows = (kind: GardenUnit["kind"]) =>
    units.filter((u) => u.kind === kind).map((u) => ({ id: u.id, qty: 1 }));
  if (planterBoxes > 0) {
    items.push(item("GL-12", "garden.planter_box", planterBoxes, `${planterBoxes} standalone planter box`));
    per("garden.planter_box", unitRows("planter_box"));
  }
  const wallFeatures = unitCount("wall_feature");
  if (wallFeatures > 0) {
    items.push(item("GL-13", "garden.wall_feature", wallFeatures, `${wallFeatures} wall feature with bench`));
    per("garden.wall_feature", unitRows("wall_feature"));
  }

  // --- Pergola (GL-14) -------------------------------------------------------
  if (structurePlanAreaM2 > 0) {
    // Inclusive of its 8 recessed downlights and the wood-effect coating.
    items.push(
      item("GL-14", "garden.pergola", structurePlanAreaM2, `Σ structure zone plan area = ${structurePlanAreaM2} m² (all-in rate: structure, coating and its ${PERGOLA_INCLUDED_DOWNLIGHTS} recessed downlights)`),
    );
    per("garden.pergola", zonesOf("structure"));
  }

  // --- Irrigation (GL-15) ----------------------------------------------------
  const irrigationDriver = round2(plantingAreaM2 + planterLm);
  if (irrigationDriver > 0) {
    const band = IRRIGATION_BANDS.find((b) => irrigationDriver <= b.max_driver)!;
    items.push(
      item(
        "GL-15",
        "garden.irrigation",
        band.factor,
        `allowance, ${band.label} garden — planting ${plantingAreaM2} m² + planter ${planterLm} lm. Sized by band against one comparable project, NOT measured; confirm on site.`,
        {
          // Both flags, and they say different things. The rate was paid on a
          // real job (site_assessment: confirm it against THIS garden). The size
          // band is inferred from a single comparable (qty_derived).
          rate_status: "site_assessment",
          qty_derived: true,
        },
      ),
    );
  }

  // --- Lighting (GL-16..18) --------------------------------------------------
  // A pergola's rate already carries its downlights, so points inside a
  // structure zone are deducted — up to the number that rate includes. Beyond
  // that they are extra fittings somebody added and are priced.
  const perStructure =
    QUANTITY_INCLUSIONS["garden.pergola"]?.find((q) => q.item_key === "garden.light_cabling")
      ?.qty_per_unit ?? PERGOLA_INCLUDED_DOWNLIGHTS;
  const gardenLights = points.filter((p) => p.type === "garden_light");
  let includedInStructures = 0;
  for (const z of structureZones) {
    const inZone = gardenLights.filter((p) => p.zone_id === z.id).length;
    includedInStructures += Math.min(inZone, perStructure);
  }
  const lightingPoints = Math.max(0, gardenLights.length - includedInStructures);
  const deductionNote =
    includedInStructures > 0
      ? ` less ${includedInStructures} carried by the structure rate`
      : "";
  if (lightingPoints > 0) {
    items.push(
      item("GL-16", "garden.light_cabling", lightingPoints, `${gardenLights.length} garden light point(s)${deductionNote}`),
      item("GL-17", "garden.light_fitting", lightingPoints, `${gardenLights.length} garden light point(s)${deductionNote}`),
    );
  }
  const boundaryLightPoints = points.filter((p) => p.type === "boundary_light").length;
  if (boundaryLightPoints > 0) {
    items.push(item("GL-18", "garden.boundary_light", boundaryLightPoints, `${boundaryLightPoints} boundary wall light point(s)`));
  }

  // --- Client-supplied equipment (GL-19) -------------------------------------
  const grills = unitCount("bbq_grill");
  if (grills > 0) {
    items.push(item("GL-19", "garden.bbq_grill", grills, `${grills} built-in BBQ grill (client-supplied equipment)`));
    per("garden.bbq_grill", unitRows("bbq_grill"));
  }

  return {
    items,
    elements,
    summary: {
      pavedAreaM2,
      grassAreaM2,
      plantingAreaM2,
      structurePlanAreaM2,
      lightingPoints,
      lightingPointsIncludedInStructures: includedInStructures,
      boundaryLightPoints,
    },
  };
}

// --- Pricing -----------------------------------------------------------------

export interface GardenPricedLine extends ScopeItem {
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
}

/** Price a take-off at the Villa 94 net rates. Deterministic. */
export function priceGardenTakeoff(items: readonly ScopeItem[]): GardenPricedLine[] {
  return items.map((i) => {
    const r = rate(i.item_key);
    return {
      ...i,
      rate_aed: r,
      total_aed: Math.round(i.quantity * r * 100) / 100,
      // Never the contractor's name. See the identity rule in the ground-truth
      // module: this string reaches the BoQ, and the BoQ reaches the client.
      vendor_or_source: PUBLIC_SOURCE_LABEL,
    };
  });
}

// --- Anti-double-count guard -------------------------------------------------

export interface DoubleCountViolation {
  kind: "inclusive" | "absorbed";
  /** The composite line whose rate already covers `included`. */
  parent?: string;
  /** The item that must not have been emitted. */
  offender: string;
  why: string;
}

/**
 * The sheet's closing note, enforced.
 *
 * Two failure modes, both of which inflate a garden BoQ while looking like
 * diligence: emitting a line for something a composite rate already covers (a
 * socket the BBQ counter includes), and emitting a line for something the
 * contract absorbed and never charged for (manhole covers). Every included item
 * is a real thing that really exists on site, which is exactly why a separate
 * line for it does not read as wrong.
 */
export function findDoubleCounts(items: readonly ScopeItem[]): DoubleCountViolation[] {
  const emitted = new Set(items.map((i) => i.item_key));
  const out: DoubleCountViolation[] = [];

  for (const [parent, included] of Object.entries(INCLUSIVE_SCOPE)) {
    if (!emitted.has(parent)) continue;
    for (const child of included) {
      if (emitted.has(child)) {
        out.push({
          kind: "inclusive",
          parent,
          offender: child,
          why: `${label(parent)} is priced inclusive of ${child}`,
        });
      }
    }
  }

  for (const key of ABSORBED_SCOPE) {
    if (emitted.has(key)) {
      out.push({
        kind: "absorbed",
        offender: key,
        why: `${key} was absorbed into the contract price — it was never charged separately`,
      });
    }
  }

  return out;
}

/** Every item_key the landscape rate catalogue can price. */
export const GARDEN_ITEM_KEYS: readonly string[] = GARDEN_RATES.map((g) => g.item_key);
