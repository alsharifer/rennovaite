// =============================================================================
// lib/boq/garden-takeoff.ts — deterministic landscape take-off (garden pilot G2).
//
// Zones, runs, discrete units and points → priced ScopeItems, priced at the
// landscape rate book passed in (rate_book rows at runtime — see
// lib/boq/garden-rates.ts). Pure: same input + same book → identical output, no
// LLM, no I/O.
//
// This is a SEPARATE take-off from lib/boq/takeoff.ts rather than more branches
// inside it. The interior take-off's rules are F-xx formulas over rooms with
// ceilings and wet walls; a garden shares none of that, and the one thing the
// two must never do is leak into each other — G1 already put landscape zones in
// their own bucket (lib/boq/rules.ts LANDSCAPE_TYPES) precisely so a lawn could
// not be priced as a terrace floor.
//
// Rates come from a GardenRateBook (lib/boq/garden-rates.ts), NOT from
// lib/boq/rates.ts. The RateResolver is driven by RATE_RULES over labour_rates +
// pricing_skus and throws on an unknown item_key, so routing garden keys through
// it would have meant either inventing labour_rates rows or editing interior
// rules. Neither is acceptable when the requirement is that zero interior rows
// move.
//
// T1.0: until then the rates were read straight off the ground-truth module's
// constants. They are now `rate_book` rows, and the book is a parameter: the
// runtime passes the book read from the database, the offline calibration passes
// the transcription. The ground-truth module still supplies each key's label and
// unit — vocabulary, not price.
// =============================================================================

import {
  GARDEN_RATES,
  INCLUSIVE_SCOPE,
  ABSORBED_SCOPE,
  PERGOLA_INCLUDED_DOWNLIGHTS,
  QUANTITY_INCLUSIONS,
  getGardenRate,
} from "@/lib/ground-truth/villa94-garden";

import { DERIVED_QTY_NOTE, isDemolished, isNewWork, isUndecided, type Disposition } from "@/lib/plan/site-reference";

export { DERIVED_QTY_NOTE };

import { isFirmTier, type RateTier } from "@/lib/rates/tiers";

import { GARDEN_TIER_LABEL, type GardenRateBook } from "./garden-rates";
import type { PomiSection, ScopeItem } from "./schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Input -------------------------------------------------------------------

/**
 * G5: every input may be an existing feature placed from site photos, with the
 * designer's call on it (lib/plan/site-reference.ts), and may sit on DERIVED
 * geometry. Absent fields mean a designed item on measured geometry — exactly
 * what every garden before G5 was.
 */
export interface SiteRefFields {
  site_reference?: boolean;
  disposition?: Disposition | null;
  /** The quantity this item contributes is derived from a reference layout. */
  dims_derived?: boolean;
  /** Replaced by a different design element — demolition only here. */
  replaced_by?: string | null;
}

/** A drawn zone (a `rooms` row with an outdoor type — see lib/plan/zones.ts). */
export interface GardenZone extends SiteRefFields {
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
export interface GardenRun extends SiteRefFields {
  id: string;
  kind: "boundary_wall" | "bench_run" | "planter_run" | "counter_run" | "stepping_path" | "string_light_run";
  /** For removal rows and notes. */
  name?: string;
  length_m: number;
  variant?: "bbq" | "bar";
}

/** A discrete built item that is neither a zone nor a run. */
export interface GardenUnit extends SiteRefFields {
  id: string;
  kind: "planter_box" | "wall_feature" | "bbq_grill" | "tree" | "shed";
  name?: string;
}

/** A placed point (a `plan_fixtures` row). `zone_id` is its room_id. */
export interface GardenPoint extends SiteRefFields {
  id: string;
  type: string;
  zone_id: string | null;
}

export interface GardenTakeoffInput {
  zones: GardenZone[];
  runs?: GardenRun[];
  units?: GardenUnit[];
  points?: GardenPoint[];
  /** G5: site-reference context (e.g. a boundary wall) — never new work, but removable. */
  context?: (SiteRefFields & { id: string; name: string; kind: string })[];
}

/** G5: an existing item the design takes out (remove or replace). */
export interface GardenRemoval {
  element_id: string;
  name: string;
  qty: number;
  unit: string;
  disposition: "remove" | "replace";
  replaced_by?: string;
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
  /** G5: what the demolition lump takes out, per element. A kept item is never here. */
  removals: GardenRemoval[];
  /** G5: site-reference items kept — excluded from demolition and new work. */
  kept: { element_id: string; name: string }[];
  /** G5: site-reference items with no decision yet (the pack refuses to export). */
  undecided: { element_id: string; name: string }[];
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
  "garden.deck": "Hardscape & Structures",
  "garden.pool": "Hardscape & Structures",
  "garden.stepping_path": "Hardscape & Structures",
  "garden.string_lights": "Electrical & Lighting",
  "garden.tree": "Soft Landscaping",
  "garden.planting_bed": "Soft Landscaping",
  "garden.water_tap": "Plumbing",
  "garden.shed": "Hardscape & Structures",
  "garden.drainage_point": "Plumbing",
};

/**
 * G5: work the drawing supports but the landscape rate book has no rate for.
 * Before G5 a deck or pool zone was simply not priced — a silent gap. It is now a
 * visible line at rate 0, flagged needs_qs, so the gap reaches the QS instead of
 * vanishing from the total.
 */
export const UNPRICED_GARDEN_ITEMS: Record<string, { label: string; unit: string }> = {
  "garden.deck": { label: "Timber / composite deck (no reference rate — QS to price)", unit: "m2" },
  "garden.pool": { label: "Pool or water feature (no reference rate — QS to price)", unit: "m2" },
  "garden.stepping_path": { label: "Stepping-stone path, slabs set in lawn (no reference rate — QS to price)", unit: "lm" },
  "garden.string_lights": { label: "Festoon string lights (no reference rate — QS to price)", unit: "lm" },
  "garden.tree": { label: "Tree supply and planting (no reference rate — QS to price)", unit: "no" },
  // G5c: a planting bed was measured (it sized irrigation) but carried no line of
  // its own — soil preparation and planting are real work with no reference rate.
  "garden.planting_bed": { label: "Planting beds — soil preparation and planting (no reference rate — QS to price)", unit: "m2" },
  "garden.water_tap": { label: "Outdoor water tap (hose bib) with isolation valve (no reference rate — QS to price)", unit: "no" },
  "garden.shed": { label: "Garden shed, supply and install (no reference rate — QS to price)", unit: "no" },
  // G5d: L-402 drew two drainage points and the BoQ priced none — exactly the gap
  // the parity gate exists for. The reference contract absorbed its drainage points
  // at no charge, so there is no reference rate: a visible line at rate 0 for the QS,
  // never a charged one (the absorbed-scope rule is about inventing a COST).
  "garden.drainage_point": { label: "Drainage point / gully in paving (absorbed at no charge in the reference project — QS to confirm)", unit: "no" },
};

/** The source label on a line with no reference rate. Never the market-reference label. */
export const UNPRICED_SOURCE_LABEL = "rate to be confirmed — not in the landscape rate book";



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

/**
 * THE garden rate choke point: every priced garden figure comes through here.
 * Throws on a key the book does not carry — never an invented rate.
 */
function rate(book: GardenRateBook, item_key: string): number {
  const r = book.resolve(item_key);
  if (!r) throw new Error(`No garden rate for "${item_key}" in the landscape rate book.`);
  return r.rate_aed;
}

function label(item_key: string): string {
  return getGardenRate(item_key)?.label ?? UNPRICED_GARDEN_ITEMS[item_key]?.label ?? item_key;
}

function unitOf(item_key: string): string {
  return getGardenRate(item_key)?.unit ?? UNPRICED_GARDEN_ITEMS[item_key]?.unit ?? "no";
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
export function computeGardenTakeoff(input: GardenTakeoffInput, book: GardenRateBook): GardenTakeoff {
  const allZones = input.zones ?? [];
  const allRuns = input.runs ?? [];
  const allUnits = input.units ?? [];
  const allPoints = input.points ?? [];
  const allContext = input.context ?? [];

  // G5: only NEW WORK is measured below. A kept site-reference item is excluded
  // here, before any rule sees it; a removed one counts only toward demolition.
  const zones = allZones.filter(isNewWork);
  const runs = allRuns.filter(isNewWork);
  const units = allUnits.filter((u) => isNewWork(u) && u.kind !== "tree" && u.kind !== "shed");
  const newSheds = allUnits.filter((u) => isNewWork(u) && u.kind === "shed");
  const newTrees = allUnits.filter((u) => isNewWork(u) && u.kind === "tree");
  const points = allPoints.filter(isNewWork);

  const removals: GardenRemoval[] = [];
  const kept: { element_id: string; name: string }[] = [];
  const undecided: { element_id: string; name: string }[] = [];
  const RUN_NAME: Record<GardenRun["kind"], string> = {
    boundary_wall: "boundary wall", bench_run: "bench run", planter_run: "planter run", counter_run: "counter run",
    stepping_path: "stepping-stone path", string_light_run: "string lights",
  };
  const siteItems: { id: string; name: string; qty: number; unit: string; t: SiteRefFields }[] = [
    ...allZones.map((z) => ({ id: z.id, name: z.name, qty: z.area_m2 || 0, unit: "m2", t: z })),
    ...allRuns.map((r) => ({ id: r.id, name: r.name ?? RUN_NAME[r.kind], qty: r.length_m || 0, unit: "lm", t: r })),
    ...allUnits.map((u) => ({ id: u.id, name: u.name ?? u.kind.replace(/_/g, " "), qty: 1, unit: "no", t: u })),
    ...allPoints.map((p) => ({ id: p.id, name: p.type.replace(/_/g, " "), qty: 1, unit: "no", t: p })),
    ...allContext.map((c) => ({ id: c.id, name: c.name, qty: 1, unit: "no", t: c })),
  ];
  for (const s of siteItems) {
    if (!s.t.site_reference) continue;
    if (isDemolished(s.t)) removals.push({ element_id: s.id, name: s.name, qty: round2(s.qty), unit: s.unit, disposition: s.t.disposition as "remove" | "replace", ...(s.t.replaced_by ? { replaced_by: s.t.replaced_by } : {}) });
    else if (isUndecided(s.t)) undecided.push({ element_id: s.id, name: s.name });
    else kept.push({ element_id: s.id, name: s.name });
  }

  // Derived geometry, per element: a line measured off any derived element says so.
  const derivedIds = new Set([...zones, ...runs, ...newTrees, ...newSheds].filter((x) => x.dims_derived).map((x) => x.id));
  const derivedExtra = (ids: readonly string[]): Partial<ScopeItem> =>
    ids.some((id) => derivedIds.has(id)) ? { qty_derived: true } : {};
  const withDerivedNote = (measurement: string, ids: readonly string[]) =>
    ids.some((id) => derivedIds.has(id)) ? `${measurement} — ${DERIVED_QTY_NOTE}` : measurement;

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
    zones.length > 0 || runs.length > 0 || units.length > 0 || points.length > 0 || newTrees.length > 0 || removals.length > 0;
  if (hasScope) {
    const removalNote =
      removals.length > 0
        ? `; takes out ${removals.map((r) => `${r.name} (${r.qty} ${r.unit}, ${r.replaced_by ? `replaced by ${r.replaced_by}` : r.disposition})`).join(", ")}`
        : "";
    const keptNote = kept.length > 0 ? `; retained and excluded: ${kept.map((k) => k.name).join(", ")}` : "";
    items.push(
      item("GL-01", "garden.preliminaries", 1, "per project — approvals, admin, shop drawings"),
      item("GL-02", "garden.mobilization", 1, "per project — debris removal, setting out, protection, supervision"),
      item(
        "GL-03",
        "garden.demolition",
        1,
        `per project — strip-out of ${round2(pavedAreaM2 + grassAreaM2)} m² existing hardscape and grass (lump for a garden this size, not scaled)${removalNote}${keptNote}`,
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
  const pavedIds = zones.filter((z) => PAVED_KINDS.has(z.kind) || z.kind === "structure").map((z) => z.id);
  if (pavedSurfaceM2 > 0) {
    items.push(
      item("GL-04", "garden.pcc_base", pavedSurfaceM2, withDerivedNote(`${surfaceNote} (${VILLA94_PCC_VS_PAVING_NOTE})`, pavedIds), derivedExtra(pavedIds)),
      item("GL-05", "garden.paving_install", pavedSurfaceM2, withDerivedNote(surfaceNote, pavedIds), derivedExtra(pavedIds)),
      // The supply rate is per m² PURCHASED, and the reference order covered all
      // paving AND cladding from 66.24 m² against 87 m² of quoted paving. Drawn
      // area is therefore an upper bound on what gets bought, and the line goes
      // to the QS flagged rather than priced as though it were measured.
      item("GL-06", "garden.tile_supply", pavedSurfaceM2, withDerivedNote(`${surfaceNote}; tile is bought per m² PURCHASED, which site setting-out usually reduces`, pavedIds), {
        rate_status: "site_assessment",
        ...derivedExtra(pavedIds),
      }),
    );
    const pavedRows = [...zonesOf(PAVED_KINDS), ...zonesOf("structure")];
    per("garden.pcc_base", pavedRows);
    per("garden.paving_install", pavedRows);
    per("garden.tile_supply", pavedRows);
  }

  // --- Softscape (GL-07..08) -------------------------------------------------
  if (grassAreaM2 > 0) {
    const grassRows = zonesOf("artificial_grass");
    const ids = grassRows.map((r) => r.id);
    items.push(
      item("GL-07", "garden.grass_supply", grassAreaM2, withDerivedNote(`artificial grass zone area = ${grassAreaM2} m²`, ids), derivedExtra(ids)),
      // Inclusive of base prep, black sand and PCC borders — see INCLUSIVE_SCOPE.
      item("GL-08", "garden.grass_install", grassAreaM2, withDerivedNote(`artificial grass zone area = ${grassAreaM2} m² (incl. base prep, sand bed and borders)`, ids), derivedExtra(ids)),
    );
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
    const ids = runRows("bench_run").map((r) => r.id);
    items.push(item("GL-09", "garden.bench_run", benchLm, withDerivedNote(`Σ bench run length = ${benchLm} lm`, ids), derivedExtra(ids)));
    per("garden.bench_run", runRows("bench_run"));
  }
  const planterLm = runTotal("planter_run");
  if (planterLm > 0) {
    const ids = runRows("planter_run").map((r) => r.id);
    items.push(item("GL-10", "garden.planter_bench_run", planterLm, withDerivedNote(`Σ planter run length = ${planterLm} lm`, ids), derivedExtra(ids)));
    per("garden.planter_bench_run", runRows("planter_run"));
  }
  const bbqLm = runTotal("counter_run", "bbq");
  if (bbqLm > 0) {
    // Inclusive of its own water, drainage and sockets — see INCLUSIVE_SCOPE.
    const ids = runRows("counter_run", "bbq").map((r) => r.id);
    items.push(item("GL-11a", "garden.counter_bbq", bbqLm, withDerivedNote(`Σ BBQ counter length = ${bbqLm} lm (incl. sink, water, drainage and sockets)`, ids), derivedExtra(ids)));
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
    const ids = runs.filter((r) => r.kind === "counter_run" && r.variant !== "bbq").map((r) => r.id);
    items.push(
      item("GL-11b", "garden.counter_bar", total, withDerivedNote(`Σ bar counter length = ${total} lm${barUntypedLm > 0 ? ` (${barUntypedLm} lm not yet typed — priced as a bar counter, the cheaper of the two)` : ""}`, ids),
        { ...(barUntypedLm > 0 ? { rate_status: "needs_selection" as const } : {}), ...derivedExtra(ids) }),
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
    const ids = structureZones.map((z) => z.id);
    items.push(
      item("GL-14", "garden.pergola", structurePlanAreaM2, withDerivedNote(`Σ structure zone plan area = ${structurePlanAreaM2} m² (all-in rate: structure, coating and its ${PERGOLA_INCLUDED_DOWNLIGHTS} recessed downlights)`, ids), derivedExtra(ids)),
    );
    per("garden.pergola", zonesOf("structure"));
  }

  // --- Irrigation (GL-15) ----------------------------------------------------
  const irrigationDriver = round2(plantingAreaM2 + planterLm);
  if (irrigationDriver > 0) {
    const band = IRRIGATION_BANDS.find((b) => irrigationDriver <= b.max_driver)!;
    // G5c: ONE allowance line — quantity 1, the band carried by the rate factor.
    const reference = rate(book, "garden.irrigation");
    // L1: say whose lump it is. Unchanged wording for the reference book.
    const whose = isFirmTier(book.resolve("garden.irrigation", "lump")?.tier) ? "contractor's" : "reference";
    items.push(
      item(
        "GL-15",
        "garden.irrigation",
        1,
        `allowance, ${band.label} band = ${band.factor} × the ${whose} irrigation lump (AED ${reference.toLocaleString("en-US")}) = AED ${Math.round(reference * band.factor).toLocaleString("en-US")}; band set by planting ${plantingAreaM2} m² + planter ${planterLm} lm (small ≤ 4, comparable ≤ 16, large above). Sized against one comparable project, NOT measured; confirm on site.`,
        {
          rate_factor: band.factor,
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

  // --- Work with no reference rate (GL-20..24, G5) ---------------------------
  const unpriced = (rule: string, key: string, rows: { id: string; qty: number }[], measurement: string) => {
    const qty = round2(rows.reduce((s, r) => s + r.qty, 0));
    if (qty <= 0) return;
    const ids = rows.map((r) => r.id);
    items.push(item(rule, key, qty, withDerivedNote(measurement.replace("{q}", String(qty)), ids), { rate_status: "needs_qs", ...derivedExtra(ids) }));
    per(key, rows);
  };
  unpriced("GL-20", "garden.deck", zonesOf("deck"), "deck zone area = {q} m²");
  unpriced("GL-21", "garden.pool", zonesOf("pool"), "pool zone area = {q} m²");
  unpriced("GL-22", "garden.stepping_path", runRows("stepping_path"), "Σ stepping-stone path length = {q} lm");
  unpriced("GL-23", "garden.string_lights", runRows("string_light_run"), "Σ string light run length = {q} lm");
  unpriced("GL-24", "garden.tree", newTrees.map((t) => ({ id: t.id, qty: 1 })), "{q} tree(s) to supply and plant");
  unpriced("GL-25", "garden.planting_bed", zonesOf("planting_bed"), "Σ planting bed area = {q} m² (soil preparation, planting; plant schedule to follow)");
  unpriced("GL-26", "garden.water_tap", points.filter((p) => p.type === "water_tap").map((p) => ({ id: p.id, qty: 1 })), "{q} outdoor tap point(s) on the plan");
  unpriced("GL-27", "garden.shed", newSheds.map((u) => ({ id: u.id, qty: 1 })), "{q} garden shed(s)");
  unpriced("GL-28", "garden.drainage_point", points.filter((p) => p.type === "drainage_point").map((p) => ({ id: p.id, qty: 1 })), "{q} drainage point(s) on the plan (L-402)");

  // --- Client-supplied equipment (GL-19) -------------------------------------
  const grills = unitCount("bbq_grill");
  if (grills > 0) {
    items.push(item("GL-19", "garden.bbq_grill", grills, `${grills} built-in BBQ grill (client-supplied equipment)`));
    per("garden.bbq_grill", unitRows("bbq_grill"));
  }

  return {
    items,
    elements,
    removals,
    kept,
    undecided,
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
  /** L1: which tier of the resolution order answered (lib/rates/tiers.ts). */
  rate_tier: RateTier;
}

/**
 * Price a take-off at the landscape rate book. Deterministic for a given book.
 *
 * L1: the book may carry a firm overlay (withFirmOverlay). A firm's own rate is
 * the one thing that can price an item the reference book has no rate for — a
 * deck or a tree is QS-to-price for the market, but a firm that builds decks
 * knows its deck rate.
 */
export function priceGardenTakeoff(items: readonly ScopeItem[], book: GardenRateBook): GardenPricedLine[] {
  return items.map((i) => {
    const hit = book.resolve(i.item_key, i.unit);
    const firmPriced = hit != null && isFirmTier(hit.tier);
    // G5: a line with no reference rate goes to the QS at 0 — never at an
    // invented rate, and never under the market-reference label.
    if (UNPRICED_GARDEN_ITEMS[i.item_key] && !firmPriced) {
      return { ...i, rate_aed: 0, total_aed: 0, vendor_or_source: UNPRICED_SOURCE_LABEL, rate_tier: "unpriced" as const };
    }
    if (!hit) throw new Error(`No garden rate for "${i.item_key}" in the landscape rate book.`);
    // A banded allowance (G5c) is one lump at the book rate × its band factor.
    const r = i.rate_factor == null ? hit.rate_aed : Math.round(hit.rate_aed * i.rate_factor * 100) / 100;
    const priced: GardenPricedLine = {
      ...i,
      rate_aed: r,
      total_aed: Math.round(i.quantity * r * 100) / 100,
      // Never the contractor's name. See the identity rule in the ground-truth
      // module: this string reaches the BoQ, and the BoQ reaches the client. The
      // label is a constant per tier (GARDEN_TIER_LABEL), never a database string.
      vendor_or_source: GARDEN_TIER_LABEL[hit.tier],
      rate_tier: hit.tier,
    };
    // A firm rate on a QS-to-price item has been priced: the needs_qs flag goes.
    if (firmPriced && priced.rate_status === "needs_qs") delete priced.rate_status;
    return priced;
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
  // G5d: a QS-to-price line (rate 0, needs_qs) is visible, never charged — it cannot
  // double-count a cost, which is what both rules below protect against.
  const emitted = new Set(items.filter((i) => i.rate_status !== "needs_qs").map((i) => i.item_key));
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
