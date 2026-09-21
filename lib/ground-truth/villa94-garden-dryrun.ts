// =============================================================================
// lib/ground-truth/villa94-garden-dryrun.ts — the calibration comparison (G3/G4).
//
// One definition of the Villa 94 dry-run, used by the printed report
// (scripts/garden-dry-run.ts) and by the stored delta-log record
// (scripts/garden-dry-run-live.ts → boq_outcomes.delta_lines). Before G4 the
// classification lived only in the report script, so the REASONING behind a
// delta — why PCC is 14% under the contract, and what says so — survived only
// as console output. Now every line carries its class, its reason and, where it
// exists, the independent evidence that corroborates it.
//
// Nothing here tunes a rate. If a line is wrong, the fix is the rule.
// =============================================================================

import {
  computeGardenTakeoff,
  findDoubleCounts,
  priceGardenTakeoff,
} from "@/lib/boq/garden-takeoff";
import { transcriptionGardenBook } from "@/lib/boq/garden-rates";

import { VILLA94_GARDEN } from "./villa94-garden-plan";
import {
  CONTRACT_LINES,
  NET_FACTOR,
  TOTALS,
  getGardenRate,
} from "./villa94-garden";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type DeltaClass = "match" | "explained" | "rule_gap" | "drawing_gap" | "variation";

export interface Corroboration {
  /** What the independent evidence is. */
  evidence: string;
  /** Where it comes from. Never the contractor's name — see the identity rule. */
  source: string;
  /** How directly it bears on this line. */
  strength: "direct" | "indirect";
}

export interface DeltaLine {
  item_key: string;
  label: string;
  unit: string;
  refs: string[];
  platform_qty: number;
  platform_aed: number;
  actual_qty: number;
  actual_aed: number;
  delta_aed: number;
  delta_pct: number;
  class: DeltaClass;
  reason: string | null;
  /** Quantity-driven lines are held to the ±10% target; lumps are not. */
  quantity_driven: boolean;
  within_10pct: boolean;
  rate_status: string | null;
  corroboration?: Corroboration;
}

export interface DryRunResult {
  lines: DeltaLine[];
  platform_total: number;
  actual_total: number;
  delta_aed: number;
  delta_pct: number;
  quantity_driven_within: number;
  quantity_driven_count: number;
  violations: ReturnType<typeof findDoubleCounts>;
  lighting: { priced: number; includedInStructures: number };
}

const netOf = (refs: string[]) =>
  r2(CONTRACT_LINES.filter((l) => refs.includes(l.ref)).reduce((s, l) => s + l.amount, 0) * NET_FACTOR);
const qtyOf = (refs: string[]) =>
  r2(CONTRACT_LINES.filter((l) => refs.includes(l.ref)).reduce((s, l) => s + l.qty, 0));

/**
 * The tile the client actually bought: 66.24 m² covering all outdoor paving and
 * cladding, against 87 m² of paving quoted. It is the one measurement in the
 * workbook that was not made by the party who quoted the work, which is what
 * makes it corroboration rather than a second opinion.
 */
export const TILE_PURCHASE: Corroboration = {
  evidence:
    "Client's tile order: 66.24 m² bought to cover ALL outdoor paving and cladding, against 87 m² of paving quoted — the quote areas ran generous.",
  source: "client-supplied tile invoice (net 128.10/m², 8,485.34)",
  strength: "direct",
};

interface Row {
  item_key: string;
  refs: string[];
  actual_qty: number;
  actual_aed: number;
  klass?: DeltaClass;
  why?: string;
  quantity_driven: boolean;
}

// Crosswalk: platform item_key → the contract line(s) it answers. Deliberately
// explicit; nothing disappears into a catch-all.
const MAP: Row[] = [
  { item_key: "garden.preliminaries", refs: ["A.1"], actual_qty: 1, actual_aed: netOf(["A.1"]), quantity_driven: false },
  { item_key: "garden.mobilization", refs: ["B.1"], actual_qty: 1, actual_aed: netOf(["B.1"]), quantity_driven: false },
  { item_key: "garden.demolition", refs: ["C.1"], actual_qty: 1, actual_aed: netOf(["C.1"]), quantity_driven: false },
  { item_key: "garden.pcc_base", refs: ["D1.1"], actual_qty: qtyOf(["D1.1"]), actual_aed: netOf(["D1.1"]), quantity_driven: true },
  { item_key: "garden.paving_install", refs: ["D1.2", "D1.3"], actual_qty: qtyOf(["D1.2", "D1.3"]), actual_aed: netOf(["D1.2", "D1.3"]), quantity_driven: true },
  { item_key: "garden.tile_supply", refs: ["client tile"], actual_qty: 66.24, actual_aed: TOTALS.client_supplied.outdoor_tile, quantity_driven: true },
  { item_key: "garden.counter_bbq", refs: ["D1.4"], actual_qty: 3, actual_aed: netOf(["D1.4"]), quantity_driven: true },
  { item_key: "garden.counter_bar", refs: ["D1.5"], actual_qty: 3.4, actual_aed: netOf(["D1.5"]), quantity_driven: true },
  { item_key: "garden.planter_box", refs: ["D1.6"], actual_qty: 1, actual_aed: netOf(["D1.6"]), quantity_driven: true },
  { item_key: "garden.wall_feature", refs: ["D1.7"], actual_qty: 1, actual_aed: netOf(["D1.7"]), quantity_driven: true },
  { item_key: "garden.bench_run", refs: ["D1.8"], actual_qty: 7.5, actual_aed: netOf(["D1.8"]), quantity_driven: true },
  { item_key: "garden.planter_bench_run", refs: ["D1.9"], actual_qty: 7.8, actual_aed: netOf(["D1.9"]), quantity_driven: true },
  { item_key: "garden.pergola", refs: ["E1.1"], actual_qty: 12.25, actual_aed: netOf(["E1.1"]), quantity_driven: true },
  { item_key: "garden.grass_supply", refs: ["G1.1 (supply half)"], actual_qty: 71, actual_aed: r2(71 * 30 * NET_FACTOR), quantity_driven: true },
  { item_key: "garden.grass_install", refs: ["G1.1 (install half)"], actual_qty: 71, actual_aed: r2(71 * 80 * NET_FACTOR), quantity_driven: true },
  { item_key: "garden.irrigation", refs: ["H.1"], actual_qty: 1, actual_aed: netOf(["H.1"]), quantity_driven: false },
  { item_key: "garden.light_cabling", refs: ["I.1"], actual_qty: 28, actual_aed: netOf(["I.1"]), quantity_driven: true },
  { item_key: "garden.light_fitting", refs: ["I.2"], actual_qty: 28, actual_aed: netOf(["I.2"]), quantity_driven: true },
  {
    item_key: "garden.boundary_light",
    refs: ["variation"],
    actual_qty: 9,
    actual_aed: TOTALS.variation_boundary_lights,
    klass: "variation",
    why: "added after signature; the platform prices it because the points are on the plan",
    quantity_driven: false,
  },
  { item_key: "garden.bbq_grill", refs: ["client grill"], actual_qty: 1, actual_aed: TOTALS.client_supplied.bbq_grill, quantity_driven: false },
];

/** Lines where the contract over-measured the drawing. */
const OVER_MEASURED = new Set([
  "garden.pcc_base",
  "garden.paving_install",
  "garden.grass_supply",
  "garden.grass_install",
]);

function classify(
  row: Row,
  platformQty: number,
  deltaPct: number,
): { k: DeltaClass; why: string | null; corroboration?: Corroboration } {
  if (row.klass) return { k: row.klass, why: row.why ?? null };
  if (Math.abs(deltaPct) <= 10) return { k: "match", why: null };

  if (OVER_MEASURED.has(row.item_key)) {
    const surface = row.item_key.startsWith("garden.grass") ? "lawn" : "paved surface";
    return {
      k: "explained",
      why: `contract quantity (${row.actual_qty} m²) exceeds the drawn ${surface} — the platform measures ${platformQty} m² off the geometry`,
      corroboration:
        surface === "lawn"
          ? {
              ...TILE_PURCHASE,
              strength: "indirect",
              evidence: `${TILE_PURCHASE.evidence} The same quote measured the lawn; its paving areas are the ones an independent purchase checks, and they ran 31% over.`,
            }
          : TILE_PURCHASE,
    };
  }
  if (row.item_key === "garden.irrigation") {
    return { k: "rule_gap", why: "banded allowance from one comparable — earns a driver at n>=3" };
  }
  return { k: "rule_gap", why: "no rule explains this delta yet" };
}

export function compareVilla94(): DryRunResult {
  // The dry-run calibrates the TRANSCRIPTION against the contract, so it prices
  // at the transcription book — not whatever the database holds today.
  const book = transcriptionGardenBook();
  const takeoff = computeGardenTakeoff(VILLA94_GARDEN, book);
  const priced = priceGardenTakeoff(takeoff.items, book);
  const byKey = new Map(priced.map((l) => [l.item_key, l] as const));

  const lines: DeltaLine[] = MAP.map((row) => {
    const line = byKey.get(row.item_key);
    const meta = getGardenRate(row.item_key)!;
    const pQty = line?.quantity ?? 0;
    const pAed = line?.total_aed ?? 0;
    const deltaAed = r2(pAed - row.actual_aed);
    const deltaPct = row.actual_aed === 0 ? 0 : r2((deltaAed / row.actual_aed) * 100);
    const { k, why, corroboration } = classify(row, pQty, deltaPct);
    return {
      item_key: row.item_key,
      label: meta.label,
      unit: meta.unit,
      refs: row.refs,
      platform_qty: pQty,
      platform_aed: pAed,
      actual_qty: row.actual_qty,
      actual_aed: row.actual_aed,
      delta_aed: deltaAed,
      delta_pct: deltaPct,
      class: k,
      reason: why,
      quantity_driven: row.quantity_driven,
      within_10pct: Math.abs(deltaPct) <= 10,
      rate_status: line?.rate_status ?? null,
      ...(corroboration ? { corroboration } : {}),
    };
  });

  const platform_total = r2(lines.reduce((s, l) => s + l.platform_aed, 0));
  const actual_total = r2(lines.reduce((s, l) => s + l.actual_aed, 0));
  const qd = lines.filter((l) => l.quantity_driven);
  return {
    lines,
    platform_total,
    actual_total,
    delta_aed: r2(platform_total - actual_total),
    delta_pct: r2(((platform_total - actual_total) / actual_total) * 100),
    quantity_driven_within: qd.filter((l) => l.within_10pct).length,
    quantity_driven_count: qd.length,
    violations: findDoubleCounts(takeoff.items),
    lighting: {
      priced: takeoff.summary.lightingPoints,
      includedInStructures: takeoff.summary.lightingPointsIncludedInStructures,
    },
  };
}
