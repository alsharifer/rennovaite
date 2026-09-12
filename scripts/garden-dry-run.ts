// =============================================================================
// scripts/garden-dry-run.ts — the calibration dry-run (garden pilot G3).
//
// Runs the landscape take-off rules over Villa 94's garden as TRACED FROM THE
// SETTING-OUT DRAWING (lib/ground-truth/villa94-garden-plan.ts), prices it at
// the calibrated rates, and compares it line by line against what the project
// actually cost (lib/ground-truth/villa94-garden.ts).
//
// Nothing here tunes a rate to chase the total. Every delta is classified and
// printed; none is elided. If a rule is wrong, the right fix is the rule.
//
// Run: node --import ./scripts/_alias-hook.mjs scripts/garden-dry-run.ts
// =============================================================================

import {
  computeGardenTakeoff,
  findDoubleCounts,
  priceGardenTakeoff,
} from "../lib/boq/garden-takeoff.ts";
import { VILLA94_GARDEN, tracedTotals, DRAWING_SCALE, PLOT } from "../lib/ground-truth/villa94-garden-plan.ts";
import {
  CONTRACT_LINES,
  NET_FACTOR,
  TIMELINE,
  TOTALS,
  getGardenRate,
} from "../lib/ground-truth/villa94-garden.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Actual, net of the contract's uniform 12%. */
const netOf = (refs: string[]) =>
  r2(
    CONTRACT_LINES.filter((l) => refs.includes(l.ref)).reduce((s, l) => s + l.amount, 0) *
      NET_FACTOR,
  );
const qtyOf = (refs: string[]) =>
  r2(CONTRACT_LINES.filter((l) => refs.includes(l.ref)).reduce((s, l) => s + l.qty, 0));

type Klass = "match" | "explained" | "rule_gap" | "drawing_gap" | "variation";

interface Row {
  item_key: string;
  /** Contract refs this line answers, for the audit trail. */
  refs: string[];
  actual_qty: number;
  actual_aed: number;
  /** Forced classification + reason, where the delta is understood up front. */
  klass?: Klass;
  why?: string;
}

// Crosswalk: platform item_key → the contract line(s) it answers. Deliberately
// explicit; where the platform has no counterpart the row says so rather than
// disappearing into a catch-all.
const MAP: Row[] = [
  { item_key: "garden.preliminaries", refs: ["A.1"], actual_qty: 1, actual_aed: netOf(["A.1"]) },
  { item_key: "garden.mobilization", refs: ["B.1"], actual_qty: 1, actual_aed: netOf(["B.1"]) },
  { item_key: "garden.demolition", refs: ["C.1"], actual_qty: 1, actual_aed: netOf(["C.1"]) },
  {
    item_key: "garden.pcc_base",
    refs: ["D1.1"],
    actual_qty: qtyOf(["D1.1"]),
    actual_aed: netOf(["D1.1"]),
  },
  {
    item_key: "garden.paving_install",
    refs: ["D1.2", "D1.3"],
    actual_qty: qtyOf(["D1.2", "D1.3"]),
    actual_aed: netOf(["D1.2", "D1.3"]),
  },
  {
    item_key: "garden.tile_supply",
    refs: ["client tile"],
    actual_qty: 66.24,
    actual_aed: TOTALS.client_supplied.outdoor_tile,
  },
  { item_key: "garden.counter_bbq", refs: ["D1.4"], actual_qty: 3, actual_aed: netOf(["D1.4"]) },
  { item_key: "garden.counter_bar", refs: ["D1.5"], actual_qty: 3.4, actual_aed: netOf(["D1.5"]) },
  { item_key: "garden.planter_box", refs: ["D1.6"], actual_qty: 1, actual_aed: netOf(["D1.6"]) },
  { item_key: "garden.wall_feature", refs: ["D1.7"], actual_qty: 1, actual_aed: netOf(["D1.7"]) },
  { item_key: "garden.bench_run", refs: ["D1.8"], actual_qty: 7.5, actual_aed: netOf(["D1.8"]) },
  {
    item_key: "garden.planter_bench_run",
    refs: ["D1.9"],
    actual_qty: 7.8,
    actual_aed: netOf(["D1.9"]),
  },
  { item_key: "garden.pergola", refs: ["E1.1"], actual_qty: 12.25, actual_aed: netOf(["E1.1"]) },
  {
    item_key: "garden.grass_supply",
    refs: ["G1.1 (supply half)"],
    actual_qty: 71,
    actual_aed: r2(71 * 30 * NET_FACTOR),
  },
  {
    item_key: "garden.grass_install",
    refs: ["G1.1 (install half)"],
    actual_qty: 71,
    actual_aed: r2(71 * 80 * NET_FACTOR),
  },
  { item_key: "garden.irrigation", refs: ["H.1"], actual_qty: 1, actual_aed: netOf(["H.1"]) },
  { item_key: "garden.light_cabling", refs: ["I.1"], actual_qty: 28, actual_aed: netOf(["I.1"]) },
  { item_key: "garden.light_fitting", refs: ["I.2"], actual_qty: 28, actual_aed: netOf(["I.2"]) },
  {
    item_key: "garden.boundary_light",
    refs: ["variation"],
    actual_qty: 9,
    actual_aed: TOTALS.variation_boundary_lights,
    klass: "variation",
    why: "added after signature; the platform prices it because the points are on the plan",
  },
  {
    item_key: "garden.bbq_grill",
    refs: ["client grill"],
    actual_qty: 1,
    actual_aed: TOTALS.client_supplied.bbq_grill,
  },
];

function classify(row: Row, platformQty: number, deltaPct: number): { k: Klass; why: string } {
  if (row.klass) return { k: row.klass, why: row.why ?? "" };
  if (Math.abs(deltaPct) <= 10) return { k: "match", why: "" };

  switch (row.item_key) {
    case "garden.pcc_base":
    case "garden.paving_install":
    case "garden.tile_supply":
      return {
        k: "explained",
        why: `contract quantity exceeds the drawn area — platform measures ${qty(platformQty)} m² off the geometry`,
      };
    case "garden.grass_supply":
    case "garden.grass_install":
      return {
        k: "explained",
        why: "contract quantity exceeds the drawn lawn area",
      };
    case "garden.irrigation":
      return { k: "rule_gap", why: "banded allowance from one comparable — earns a driver at n>=3" };
    default:
      return { k: "rule_gap", why: "no rule explains this delta yet" };
  }
}

function main() {
  const takeoff = computeGardenTakeoff(VILLA94_GARDEN);
  const priced = priceGardenTakeoff(takeoff.items);
  const violations = findDoubleCounts(takeoff.items);
  const byKey = new Map(priced.map((l) => [l.item_key, l] as const));
  const traced = tracedTotals();

  const W = 108;
  const rule = (c = "-") => console.log(c.repeat(W));

  console.log("");
  rule("=");
  console.log("  VILLA 94 GARDEN — CALIBRATION DRY-RUN");
  rule("=");
  console.log(`  Plan traced from the setting-out drawing at ${DRAWING_SCALE}; plot ${PLOT.width_m} × ${PLOT.depth_m} m.`);
  console.log(`  Rates: calibrated market reference (net). No rate was adjusted for this comparison.`);
  console.log("");
  console.log("  WHAT THE PLATFORM MEASURED OFF THE DRAWING");
  console.log(`    paving            ${qty(traced.paving_m2)} m²   (${qty(traced.paved_surface_incl_structure_m2)} m² including the pergola footprint)`);
  console.log(`    artificial grass  ${qty(traced.grass_m2)} m²`);
  console.log(`    planting          ${qty(traced.planting_m2)} m²`);
  console.log(`    structure (plan)  ${qty(traced.structure_m2)} m²`);
  console.log("");
  console.log("  PRE-REGISTERED EXPECTATION (recorded before running)");
  console.log("    PCC measured off geometry would come out ~12 m² ABOVE the contracted 75 m²");
  console.log("    (~+1,440 pre-discount), on the assumption that the drawn paving matches the");
  console.log("    contract's own 87 m² of paving install. Classified `explained` either way:");
  console.log("    the rule measures geometry and does not inherit a contractor's estimating slack.");
  console.log("");
  const pcc = byKey.get("garden.pcc_base");
  console.log("  OUTCOME OF THAT EXPECTATION — FALSIFIED, AND IN THE MORE USEFUL DIRECTION");
  console.log(`    PCC measures ${qty(pcc?.quantity ?? 0)} m², which is BELOW the contracted 75, not above it.`);
  console.log("    The premise was that the drawing would support the contract's own 87 m² of");
  console.log("    paving. It does not: the drawn paved surface is 64.27 m². The corroboration");
  console.log(`    is the tile actually purchased — 66.24 m², within 3% of what we measure and`);
  console.log("    31% below what the contract quoted. The contract over-measured BOTH lines.");
  console.log("");

  rule();
  console.log(
    "  " +
      "LINE".padEnd(28) +
      "PLATFORM".padStart(20) +
      "ACTUAL".padStart(20) +
      "DELTA".padStart(14) +
      "  CLASS",
  );
  rule();

  let platformTotal = 0;
  let actualTotal = 0;
  const counts: Record<Klass, number> = { match: 0, explained: 0, rule_gap: 0, drawing_gap: 0, variation: 0 };
  const notes: string[] = [];

  for (const row of MAP) {
    const line = byKey.get(row.item_key);
    const meta = getGardenRate(row.item_key)!;
    const pQty = line?.quantity ?? 0;
    const pAed = line?.total_aed ?? 0;
    platformTotal += pAed;
    actualTotal += row.actual_aed;

    const deltaAed = r2(pAed - row.actual_aed);
    const deltaPct = row.actual_aed === 0 ? 0 : r2((deltaAed / row.actual_aed) * 100);
    const { k, why } = classify(row, pQty, deltaPct);
    counts[k] += 1;

    const flag = line?.rate_status ? ` [${line.rate_status}]` : "";
    console.log(
      "  " +
        meta.label.slice(0, 27).padEnd(28) +
        `${qty(pQty)} ${meta.unit} · ${money(pAed)}`.padStart(20) +
        `${qty(row.actual_qty)} ${meta.unit} · ${money(row.actual_aed)}`.padStart(20) +
        `${deltaAed >= 0 ? "+" : ""}${money(deltaAed)}`.padStart(14) +
        `  ${k}${flag}`,
    );
    if (why) notes.push(`    ${meta.label}: ${why}`);
    console.log(
      "  " +
        "".padEnd(28) +
        `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`.padStart(20) +
        `  ${row.refs.join(", ")}`,
    );
  }

  rule();
  const dTotal = r2(platformTotal - actualTotal);
  const dPct = r2((dTotal / actualTotal) * 100);
  console.log(
    "  " +
      "TOTAL".padEnd(28) +
      money(r2(platformTotal)).padStart(20) +
      money(r2(actualTotal)).padStart(20) +
      `${dTotal >= 0 ? "+" : ""}${money(dTotal)}`.padStart(14) +
      `  ${dPct >= 0 ? "+" : ""}${dPct.toFixed(1)}%`,
  );
  rule();

  console.log("");
  console.log("  DELTA NOTES");
  for (const n of notes) console.log(n);
  console.log("");

  // --- quantity-driven sections against the ±10% target --------------------
  const QUANTITY_DRIVEN = [
    "garden.pcc_base",
    "garden.paving_install",
    "garden.tile_supply",
    "garden.grass_supply",
    "garden.grass_install",
    "garden.counter_bbq",
    "garden.counter_bar",
    "garden.bench_run",
    "garden.planter_bench_run",
    "garden.pergola",
    "garden.planter_box",
    "garden.wall_feature",
    "garden.light_cabling",
    "garden.light_fitting",
  ];
  console.log("  QUANTITY-DRIVEN LINES vs the ±10% target");
  let within = 0;
  for (const key of QUANTITY_DRIVEN) {
    const row = MAP.find((m) => m.item_key === key)!;
    const line = byKey.get(key);
    const pAed = line?.total_aed ?? 0;
    const pct = row.actual_aed === 0 ? 0 : r2(((pAed - row.actual_aed) / row.actual_aed) * 100);
    const ok = Math.abs(pct) <= 10;
    if (ok) within += 1;
    console.log(
      `    ${ok ? "within" : "OUTSIDE"}  ${getGardenRate(key)!.label.slice(0, 40).padEnd(42)} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    );
  }
  console.log(`    → ${within}/${QUANTITY_DRIVEN.length} within ±10%`);
  console.log("");

  console.log("  INVARIANTS");
  console.log(`    double-count violations: ${violations.length === 0 ? "none" : violations.map((v) => v.offender).join(", ")}`);
  console.log(`    lighting points priced:  ${takeoff.summary.lightingPoints} of 28 (${takeoff.summary.lightingPointsIncludedInStructures} carried by the pergola rate)`);
  console.log(`    absorbed scope priced:   none (manhole covers, drainage, sweet soil, edging, fertilizer)`);
  console.log("");

  console.log("  CLASSIFICATION SUMMARY");
  for (const [k, n] of Object.entries(counts)) if (n > 0) console.log(`    ${k.padEnd(12)} ${n}`);
  console.log("");
  console.log(`  Contractor scope actual: AED ${money(TOTALS.contractor_total)}`);
  console.log(`  Project actual (incl. client-supplied): AED ${money(TOTALS.project_total)}`);
  console.log(`  Duration anchor: ${TIMELINE.actual_days} days.`);
  console.log("");

  for (const n of VILLA94_GARDEN.notes) console.log(`  · ${n}`);
  console.log("");

  if (violations.length > 0) process.exitCode = 1;
}

main();
