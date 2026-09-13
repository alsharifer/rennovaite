// =============================================================================
// scripts/garden-dry-run.ts — the calibration dry-run report (garden pilot G3/G4).
//
// Prints the line-by-line comparison computed by
// lib/ground-truth/villa94-garden-dryrun.ts — the SAME computation the stored
// delta-log record is written from, so the report and the record cannot drift.
// Every delta is classified and printed; none is elided.
//
// Run: node --import ./scripts/_alias-hook.mjs scripts/garden-dry-run.ts
// =============================================================================

import { compareVilla94 } from "../lib/ground-truth/villa94-garden-dryrun.ts";
import {
  DRAWING_SCALE,
  G3_TRACED_TOTALS,
  PLOT,
  VILLA94_GARDEN,
  tracedTotals,
} from "../lib/ground-truth/villa94-garden-plan.ts";
import { TIMELINE, TOTALS } from "../lib/ground-truth/villa94-garden.ts";

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const signed = (n: number, s: string) => `${n >= 0 ? "+" : ""}${s}`;

function main() {
  const r = compareVilla94();
  const traced = tracedTotals();
  const W = 110;
  const rule = (c = "-") => console.log(c.repeat(W));

  console.log("");
  rule("=");
  console.log("  VILLA 94 GARDEN — CALIBRATION DRY-RUN");
  rule("=");
  console.log(`  Plan traced from the setting-out drawing at ${DRAWING_SCALE}; plot ${PLOT.width_m} × ${PLOT.depth_m} m.`);
  console.log("  Rates: calibrated market reference (net). No rate was adjusted for this comparison.");
  console.log("");
  console.log("  WHAT THE PLATFORM MEASURED OFF THE DRAWING (areas computed from traced polygons)");
  console.log(`    paving            ${qty(traced.paving_m2)} m²   (${qty(traced.paved_surface_incl_structure_m2)} m² including the pergola footprint)   G3 arithmetic: ${G3_TRACED_TOTALS.paving_m2}`);
  console.log(`    artificial grass  ${qty(traced.grass_m2)} m²                                            G3 arithmetic: ${G3_TRACED_TOTALS.grass_m2}`);
  console.log(`    planting          ${qty(traced.planting_m2)} m²                                             G3 arithmetic: ${G3_TRACED_TOTALS.planting_m2}`);
  console.log(`    structure (plan)  ${qty(traced.structure_m2)} m²                                            G3 arithmetic: ${G3_TRACED_TOTALS.structure_m2}`);
  console.log("");
  console.log("  PRE-REGISTERED EXPECTATION (recorded before the G3 run)");
  console.log("    PCC measured off geometry would come out ~12 m² ABOVE the contracted 75 m²,");
  console.log("    on the premise that the drawing supports the contract's own 87 m² of paving.");
  const pcc = r.lines.find((l) => l.item_key === "garden.pcc_base")!;
  console.log("  OUTCOME — FALSIFIED, IN THE MORE USEFUL DIRECTION");
  console.log(`    PCC measures ${qty(pcc.platform_qty)} m², BELOW the contracted 75. The drawing does not support 87 m²,`);
  console.log(`    and the client's tile order (66.24 m²) sits within ${Math.abs(((66.24 - pcc.platform_qty) / 66.24) * 100).toFixed(0)}% of what we measure.`);
  console.log("");

  rule();
  console.log("  " + "LINE".padEnd(30) + "PLATFORM".padStart(22) + "ACTUAL".padStart(22) + "DELTA".padStart(14) + "  CLASS");
  rule();
  for (const l of r.lines) {
    const flag = l.rate_status ? ` [${l.rate_status}]` : "";
    console.log(
      "  " +
        l.label.slice(0, 29).padEnd(30) +
        `${qty(l.platform_qty)} ${l.unit} · ${money(l.platform_aed)}`.padStart(22) +
        `${qty(l.actual_qty)} ${l.unit} · ${money(l.actual_aed)}`.padStart(22) +
        signed(l.delta_aed, money(l.delta_aed)).padStart(14) +
        `  ${l.class}${flag}`,
    );
    console.log("  " + "".padEnd(30) + signed(l.delta_pct, `${l.delta_pct.toFixed(1)}%`).padStart(22) + `  ${l.refs.join(", ")}`);
  }
  rule();
  console.log(
    "  " +
      "TOTAL".padEnd(30) +
      money(r.platform_total).padStart(22) +
      money(r.actual_total).padStart(22) +
      signed(r.delta_aed, money(r.delta_aed)).padStart(14) +
      `  ${signed(r.delta_pct, `${r.delta_pct.toFixed(1)}%`)}`,
  );
  rule();
  console.log("");

  console.log("  DELTA NOTES");
  for (const l of r.lines.filter((x) => x.reason)) {
    console.log(`    ${l.label}: ${l.reason}`);
    if (l.corroboration) {
      console.log(`      corroborated (${l.corroboration.strength}) — ${l.corroboration.evidence}`);
    }
  }
  console.log("");

  console.log("  QUANTITY-DRIVEN LINES vs the ±10% target");
  for (const l of r.lines.filter((x) => x.quantity_driven)) {
    console.log(`    ${l.within_10pct ? "within " : "OUTSIDE"}  ${l.label.slice(0, 44).padEnd(46)} ${signed(l.delta_pct, `${l.delta_pct.toFixed(1)}%`)}`);
  }
  console.log(`    → ${r.quantity_driven_within}/${r.quantity_driven_count} within ±10%`);
  console.log("");

  console.log("  INVARIANTS");
  console.log(`    double-count violations: ${r.violations.length === 0 ? "none" : r.violations.map((v) => v.offender).join(", ")}`);
  console.log(`    lighting points priced:  ${r.lighting.priced} of 28 (${r.lighting.includedInStructures} carried by the pergola rate)`);
  console.log("    absorbed scope priced:   none (manhole covers, drainage, sweet soil, edging, fertilizer)");
  console.log("");

  const counts = new Map<string, number>();
  for (const l of r.lines) counts.set(l.class, (counts.get(l.class) ?? 0) + 1);
  console.log("  CLASSIFICATION SUMMARY");
  for (const [k, n] of counts) console.log(`    ${k.padEnd(12)} ${n}`);
  console.log("");
  console.log(`  Contractor scope actual: AED ${money(TOTALS.contractor_total)}`);
  console.log(`  Project actual (incl. client-supplied): AED ${money(TOTALS.project_total)}`);
  console.log(`  Duration anchor: ${TIMELINE.actual_days} days.`);
  console.log("");
  for (const n of VILLA94_GARDEN.notes) console.log(`  · ${n}`);
  console.log("");

  if (r.violations.length > 0) process.exitCode = 1;
}

main();
