// =============================================================================
// lib/ground-truth/villa94-garden.ts — Villa 94 garden contract + rate actuals.
//
// SOURCE OF TRUTH. Every figure here is transcribed from
// `data/garden pilot/Garden_Ground_Truth_Villa94.xlsx` (read by unzipping the
// workbook and parsing the sheet XML — NOT retyped from a prompt). Sheet and
// row refs are cited per record. Consumed by:
//   - lib/boq/garden-rates.ts        (the landscape rate catalogue)
//   - scripts/seed-rate-book-garden.ts (rate_book reseed)
//   - scripts/record-garden-outcome.ts (boq_outcomes entry #2)
//
// -----------------------------------------------------------------------------
// IDENTITY RULE — read before adding anything that renders.
//
// The contractor is a real, independent firm that has nothing to do with the
// client this pilot serves. Their name appears in EXACTLY one place: the
// `INTERNAL_REF` constant below, which exists so we can trace a rate back to its
// document. It must never reach a Newspace-facing surface, a BoQ line, a
// `rate_book.source` value, or a log line. `PUBLIC_SOURCE_LABEL` is what those
// surfaces say instead.
//
// That is not squeamishness about attribution: these are one firm's negotiated
// prices, handed over in confidence, and presenting them under their name to a
// competitor's client would be a straightforward breach.
// -----------------------------------------------------------------------------
//
// All AED, excl. VAT. The 12% discount is a STANDARD new-client discount
// (8–12% band), which is why the NET rates are treated as repeatable market
// prices rather than as relationship pricing the way the Mudon interior numbers
// are (see lib/ground-truth/mudon-actuals.ts).
// =============================================================================

import type { Provenance, Scope } from "./mudon-actuals";

/** What every rendered surface says about where these rates came from. */
export const PUBLIC_SOURCE_LABEL = "market reference — Dubai garden 2026";

/** Internal only. Written to `rate_book.internal_ref`, never to `source`, and
 *  never rendered. See the identity rule above. */
export const INTERNAL_REF =
  "KAME Landscape & Pools — Agreement A00074, 28 Aug 2025 (Villa 94, Mudon Al Naseem F2)";

/** Pre-discount → net. 12% off, inside the standard 8–12% new-client band. */
export const DISCOUNT_PCT = 0.12;
export const NET_FACTOR = 1 - DISCOUNT_PCT; // 0.88

/** Apply the contract discount. Rounded to fils — these are prices. */
export function netRate(listRate: number): number {
  return Math.round(listRate * NET_FACTOR * 10_000) / 10_000;
}

// --- Summary sheet -----------------------------------------------------------

export const TOTALS = {
  /** Sum of the quoted line items before the discount. */
  subtotal_pre_discount: 153_763,
  discount_aed: 18_451.56,
  /** Signed contract value, excl. VAT. */
  contract_excl_vat: 135_311.44,
  /** The only addition to the contract: 9 boundary lights at 315.00/point. */
  variation_boundary_lights: 2_835,
  /** THE calibration anchor for contractor scope. */
  contractor_total: 138_146.44,
  /** Client-supplied, outside the contractor's scope. */
  client_supplied: {
    outdoor_tile: 8_485.34, // 66.24 m² @ 128.10 net (list 210, 39% off)
    bbq_grill: 5_427.66, // Broil King Baron 420 class, 27 Sep 2025
    subtotal: 13_913,
  },
  /** Contractor + client-supplied. The project figure the pilot calibrates to. */
  project_total: 152_059.44,
} as const;

/**
 * Excluded from every figure above, by scope decision rather than by oversight:
 * plantation, pizza oven, pool. Sweet soil, manhole covers and drainage points
 * were ABSORBED into the contract price with no separate actual — which is why
 * the takeoff rules must not emit lines for them (see INCLUSIVE_SCOPE).
 */
export const EXCLUSIONS = ["plantation", "pizza oven", "pool"] as const;

/** Timeline & Templates sheet. n = 1, so this is an anchor, not a model. */
export const TIMELINE = {
  actual_days: 90,
  quoted_working_days: 120,
  note:
    "Mobilization → handover. The quote's 120 working days overestimated it. " +
    "Phase split was not recorded, so this is a TOTAL-duration anchor only and " +
    "any range built on it is wide.",
  payment_structure:
    "15% signature · 30% mobilization · 30% civil completion · 15% paving delivery · 10% completion",
} as const;

// --- KAME Contract sheet — quoted lines, pre-discount ------------------------

export interface ContractLine {
  ref: string;
  item: string;
  qty: number;
  unit: string;
  /** Pre-discount rate as quoted. */
  rate: number;
  amount: number;
  note?: string;
  /** true = quoted at zero because the scope was absorbed into other lines. */
  absorbed?: boolean;
}

export const CONTRACT_LINES: ContractLine[] = [
  { ref: "A.1", item: "Preliminaries: approvals, admin, shop drawings (permit fees excluded)", qty: 1, unit: "lump", rate: 4_000, amount: 4_000, note: "Shop drawings 10 working days." },
  { ref: "B.1", item: "Mobilization: debris removal, marking/grading, protection, final clean, PM/supervision", qty: 1, unit: "lump", rate: 5_000, amount: 5_000 },
  { ref: "C.1", item: "Demolition: tiles/gravel removal front, grass/floor tiles/planter removal, step tiles back, disposal to DM yard", qty: 1, unit: "lump", rate: 5_000, amount: 5_000 },
  { ref: "D1.1", item: "PCC concrete base for all tile areas (leveling, compaction, 1000g poly sheet, PCC)", qty: 75, unit: "m2", rate: 120, amount: 9_000 },
  { ref: "D1.2", item: "Front yard paving INSTALL only (tiles by client)", qty: 27, unit: "m2", rate: 80, amount: 2_160, note: "1200x600x20 porcelain." },
  { ref: "D1.3", item: "Backyard paving INSTALL only (tiles by client)", qty: 60, unit: "m2", rate: 80, amount: 4_800, note: "1200x600x20 porcelain." },
  { ref: "D1.4", item: "BBQ counter 3.0x0.9x0.9m: blockwork+slab, porcelain clad, SS sink+tap, MEP water/drain, sockets, aluminum door, appliance provisions", qty: 1, unit: "no", rate: 18_000, amount: 18_000, note: "Excludes grill/appliances (client-supplied)." },
  { ref: "D1.5", item: "Bar counter 3.4x0.45x1.0m: blockwork, porcelain finish", qty: 1, unit: "no", rate: 16_660, amount: 16_660, note: "≈4,900/lm." },
  { ref: "D1.6", item: "Olive planter box 1.8x1.8x0.45m: blockwork, waterproofed, porcelain clad", qty: 1, unit: "no", rate: 3_888, amount: 3_888 },
  { ref: "D1.7", item: "Wall feature with bench 2.5x0.3x1.8m (arch): blockwork, waterproofed, porcelain clad", qty: 1, unit: "no", rate: 7_500, amount: 7_500, note: "Arched feature per drawing C-A-001." },
  { ref: "D1.8", item: "L-shape seating bench 7.5x0.7x0.6m: blockwork, waterproofed, porcelain clad", qty: 7.5, unit: "lm", rate: 1_500, amount: 11_250 },
  { ref: "D1.9", item: "Planter box with seating bench 7.8x0.7x0.6m", qty: 7.8, unit: "lm", rate: 1_150, amount: 8_970 },
  { ref: "D2.1", item: "Manhole covers (recessed aluminum)", qty: 0, unit: "TBD", rate: 0, amount: 0, absorbed: true, note: "ABSORBED in contract — no separate charge." },
  { ref: "D3.1", item: "Drainage points on paving", qty: 0, unit: "TBD", rate: 0, amount: 0, absorbed: true, note: "ABSORBED in contract — no separate charge." },
  { ref: "E1.1", item: "Motorized louvered pergola 3.5x3.5x2.8m, alum 150x150 structure, 8 recessed LED downlights, wood-effect coating", qty: 12.25, unit: "m2 plan", rate: 1_553.06, amount: 19_025, note: "≈1,553/m² plan area, all-in." },
  { ref: "G1.1", item: "Artificial grass 32mm: supply 30/m² + install 80/m² (base prep, black sand 8cm, PCC borders)", qty: 71, unit: "m2", rate: 110, amount: 7_810 },
  { ref: "G2.1", item: "Sweet soil + border edging + fertilizer", qty: 0, unit: "TBD", rate: 0, amount: 0, absorbed: true, note: "ABSORBED — no separate charge." },
  { ref: "H.1", item: "Irrigation network: 2in main, 1in stations, battery drip system, 1.5HP pump, valve boxes", qty: 1, unit: "lump", rate: 12_500, amount: 12_500, note: "Covers planters/planting areas." },
  { ref: "I.1", item: "Garden lighting cabling in conduits", qty: 28, unit: "point", rate: 300, amount: 8_400 },
  { ref: "I.2", item: "LUMO light fittings: 7 inground 1W + 6 spike 8.5W + 7 spike 4.5W + 40lm LED strip", qty: 28, unit: "point", rate: 350, amount: 9_800, note: "Blended ≈350/point incl. strip." },
];

// --- Rate Calibration sheet → the rate-book seed -----------------------------

export interface GardenRate {
  /** Stable key the takeoff rules and rate_book share. */
  item_key: string;
  /** Work item, as the sheet names it. */
  label: string;
  unit: string;
  /** Pre-discount rate as quoted. */
  list_rate: number;
  /** The rate we actually price at. */
  net_rate: number;
  scope: Scope;
  /**
   * true = the sheet marks this rate as ALREADY NET, so the 12% must not be
   * applied again. Three rows are in this state and each for its own reason:
   * the tile is a client purchase at its own discount, the boundary lights were
   * a variation whose price IS net, and the grill is client-supplied equipment.
   * `ratesAreConsistent()` below is the guard that keeps it that way.
   */
  already_net: boolean;
  /** Rule driver / note, verbatim from the sheet where it exists. */
  note?: string;
}

const r = (
  item_key: string,
  label: string,
  unit: string,
  list_rate: number,
  scope: Scope,
  opts: { already_net?: boolean; note?: string } = {},
): GardenRate => ({
  item_key,
  label,
  unit,
  list_rate,
  net_rate: opts.already_net ? list_rate : netRate(list_rate),
  scope,
  already_net: opts.already_net ?? false,
  note: opts.note,
});

/** Rate Calibration sheet rows 4–23, in sheet order. */
export const GARDEN_RATES: GardenRate[] = [
  r("garden.preliminaries", "Garden preliminaries & approvals", "lump", 4_000, "install_only", { note: "Per project; scales weakly with scope." }),
  r("garden.mobilization", "Garden mobilization & site management", "lump", 5_000, "install_only", { note: "Per project." }),
  r("garden.demolition", "Garden demolition & strip-out", "lump", 5_000, "install_only", { note: "Driver: existing hardscape+grass area; lump for townhouse gardens this size." }),
  r("garden.pcc_base", "PCC base under paving", "m2", 120, "install_only", { note: "Qty = paved area (incl. counters footprint)." }),
  r("garden.paving_install", "Porcelain paving installation", "m2", 80, "install_only", { note: "Qty = paved area; tile supply separate." }),
  r("garden.tile_supply", "Outdoor porcelain tile supply (1200x600 R11 class)", "m2", 128.1, "supply_only", {
    already_net: true,
    note:
      "Client purchase at its own 39% discount (list 210). The order of 66.24 m² " +
      "covered ALL paving and cladding against 87 m² of quoted paving — the quote " +
      "areas were generous, and the rate is per m² PURCHASED, not per m² drawn. " +
      "Quantities on this line carry site_assessment for exactly that reason.",
  }),
  r("garden.counter_bbq", "BBQ counter (blockwork, clad, sink+MEP+sockets)", "lm", 6_000, "supply_and_install", { note: "3.0 lm unit = 18,000. Includes MEP water/drain + electrical. NO separate MEP/socket lines — dedupe rule." }),
  r("garden.counter_bar", "Bar counter (blockwork, clad)", "lm", 4_900, "supply_and_install", { note: "3.4 lm unit = 16,660." }),
  r("garden.planter_box", "Planter box, standalone (per unit ~1.8x1.8x0.45)", "no", 3_888, "supply_and_install", { note: "Waterproofed + clad." }),
  r("garden.wall_feature", "Wall feature with bench (arch, per unit ~2.5m w)", "no", 7_500, "supply_and_install"),
  r("garden.bench_run", "Seating bench, L-shape (0.7x0.6 section)", "lm", 1_500, "supply_and_install"),
  r("garden.planter_bench_run", "Planter + bench combo (0.7x0.6)", "lm", 1_150, "supply_and_install"),
  r("garden.pergola", "Motorized louvered pergola (alum, LED, coated)", "m2 plan", 1_553.06, "supply_and_install", { note: "Plan area driver; includes 8 downlights + wood-effect coating." }),
  r("garden.grass_supply", "Artificial grass supply", "m2", 30, "supply_only", { note: "32mm class." }),
  r("garden.grass_install", "Artificial grass installation (base+sand+borders)", "m2", 80, "install_only"),
  r("garden.irrigation", "Irrigation system (drip, pump, valves)", "lump", 12_500, "supply_and_install", { note: "Townhouse garden w/ planters; driver: planter lm + planting area." }),
  r("garden.light_cabling", "Garden lighting cabling", "point", 300, "install_only", { note: "Conduit + cable per point." }),
  r("garden.light_fitting", "Garden light fittings (blended LUMO class)", "point", 350, "supply_and_install", { note: "Mix inground/spike/strip." }),
  r("garden.boundary_light", "Boundary wall lights (supply+install)", "point", 315, "supply_and_install", { already_net: true, note: "From variation: 9 no = 2,835. NOT discounted — the variation price IS net." }),
  r("garden.bbq_grill", "BBQ grill, built-in (client-supplied equipment class)", "no", 5_427.66, "supply_only", { already_net: true, note: "Broil King Baron 420 class; equipment line, no install margin in the actual." }),
];

/** Every garden rate is `actual_transaction` — each one was paid. */
export const GARDEN_PROVENANCE: Provenance = "actual_transaction";

const BY_KEY = new Map(GARDEN_RATES.map((g) => [g.item_key, g] as const));

export function getGardenRate(item_key: string): GardenRate | null {
  return BY_KEY.get(item_key) ?? null;
}

/**
 * Guard for the one mistake this sheet is easy to make: re-applying the 12% to a
 * rate that is already net. Returns the offending keys rather than throwing, so
 * a test can name them.
 */
export function ratesAreConsistent(): string[] {
  const bad: string[] = [];
  for (const g of GARDEN_RATES) {
    const expected = g.already_net ? g.list_rate : netRate(g.list_rate);
    if (Math.abs(g.net_rate - expected) > 1e-9) bad.push(g.item_key);
  }
  return bad;
}

// --- Anti-double-count invariants (Rate Calibration sheet, row 24) -----------

/**
 * What each composite rate ALREADY covers. A takeoff that emits one of these
 * items must not also emit anything in its list.
 *
 * This is the sheet's closing note turned into data, because it is the failure
 * mode that inflates a garden BoQ without looking wrong: every included item is
 * a real thing that really exists on site, so a separate line for it reads as
 * diligence rather than as double counting.
 */
export const INCLUSIVE_SCOPE: Record<string, readonly string[]> = {
  // "Includes MEP water/drain + electrical. NO separate MEP/socket lines."
  "garden.counter_bbq": [
    "garden.mep_point",
    "garden.socket",
    "garden.drainage_point",
    "garden.sink",
  ],
  // "includes ... wood-effect coating". NOT the lighting lines: a pergola
  // carries EIGHT downlights, not every light in the garden, so its lighting
  // inclusion is a quantity deduction rather than a suppressed line — see
  // QUANTITY_INCLUSIONS. Listing the lighting keys here was the first version,
  // and it would have stopped a garden pricing any lighting at all the moment a
  // pergola appeared in it.
  "garden.pergola": ["garden.coating"],
  // "(base+sand+borders)" — plus the sweet soil / edging line the contract absorbed.
  "garden.grass_install": [
    "garden.base_prep",
    "garden.black_sand",
    "garden.border_edging",
    "garden.sweet_soil",
    "garden.fertilizer",
  ],
};

/** Scope the contract absorbed with no separate charge — never its own line. */
export const ABSORBED_SCOPE: readonly string[] = [
  "garden.manhole_cover",
  "garden.drainage_point",
  "garden.sweet_soil",
  "garden.border_edging",
  "garden.fertilizer",
];

/** The pergola's own lighting, which its m²-plan rate already carries. */
export const PERGOLA_INCLUDED_DOWNLIGHTS = 8;

/**
 * Inclusions that reduce a QUANTITY rather than suppress a line.
 *
 * The distinction matters and is easy to get wrong. A BBQ counter's sockets are
 * a line-level inclusion: there is no such thing as "the sockets the counter
 * does not cover", so the line must never exist. A pergola's downlights are a
 * quantity inclusion: the rate carries eight of them and a garden usually has
 * more, so the lighting line stays and its quantity comes down by eight per
 * structure. Suppressing the line instead would zero out every garden light the
 * moment somebody drew a pergola.
 */
export const QUANTITY_INCLUSIONS: Record<
  string,
  readonly { item_key: string; qty_per_unit: number; note: string }[]
> = {
  "garden.pergola": [
    { item_key: "garden.light_cabling", qty_per_unit: PERGOLA_INCLUDED_DOWNLIGHTS, note: "recessed downlights carried by the pergola rate" },
    { item_key: "garden.light_fitting", qty_per_unit: PERGOLA_INCLUDED_DOWNLIGHTS, note: "recessed downlights carried by the pergola rate" },
  ],
};
