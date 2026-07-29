// =============================================================================
// scripts/record-boq-outcome.ts — delta-log entry #1 (ground-truth Steps 6-7).
//
// Compares the regenerated Mudon platform BoQ (takeoff-provenance) against the
// contractor actuals (Delta Log rows, GROSS pre-discount labour per section),
// writes a boq_outcomes record, and prints the section → platform → actual →
// delta% table for pasting into the workbook's yellow Platform column.
//
// The crosswalk from platform POMI sections to Delta Log rows is deliberately
// explicit — the mismatches (tile supply bundled into finishes; labour sections
// the deterministic engine never itemises) are the findings, not bugs.
//
// Run: node scripts/record-boq-outcome.ts   (after migration 023 + BoQ regen)
// =============================================================================

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import { LABOUR_SECTIONS, TRADE_TOTALS } from "../lib/ground-truth/mudon-actuals.ts";

const ROOT = "C:/dev/rennovaite";
const PID = "6b5fda9d-e40f-4e16-940c-7a17d27ec5dc";

// Delta Log actual rows (excl VAT; labour is GROSS pre-discount per the note).
const L = (name: string) => LABOUR_SECTIONS.find((s) => s.section.startsWith(name))!.gross_aed;
type Row = { row: string; actual: number; platform_sections: string[]; kind: "computed" | "allowance" | "gap"; note?: string };
const DELTA_LOG: Row[] = [
  { row: "Mobilisation & site setup", actual: L("Mobilisation"), platform_sections: [], kind: "gap", note: "engine has no mobilisation line (folded into Preliminaries)" },
  { row: "Waste management & clearance", actual: L("Waste"), platform_sections: [], kind: "gap", note: "not itemised by the engine" },
  { row: "Demolition & strip-out", actual: L("Demolition"), platform_sections: ["Demolition"], kind: "computed" },
  { row: "Civil works", actual: L("Civil"), platform_sections: ["Blockwork"], kind: "computed" },
  { row: "Flooring works (labour)", actual: L("Flooring"), platform_sections: ["Floor Finishes"], kind: "computed", note: "platform bundles supply+install; tile SUPPLY is a separate gap row below" },
  { row: "Ceilings & lighting (labour)", actual: L("Ceilings"), platform_sections: ["Ceilings", "Lighting"], kind: "computed" },
  { row: "Painting works", actual: L("Painting"), platform_sections: ["Decoration & Painting"], kind: "computed" },
  { row: "Sanitary & plumbing (labour)", actual: L("Sanitary & Plumbing"), platform_sections: ["Plumbing", "Plumbing & Sanitary"], kind: "computed" },
  { row: "Electrical works (labour)", actual: L("Electrical"), platform_sections: ["Electrical", "Electrical Installations"], kind: "computed" },
  { row: "HVAC works", actual: L("HVAC"), platform_sections: ["MEP / HVAC"], kind: "computed" },
  { row: "Staircase renovation", actual: L("Staircase"), platform_sections: [], kind: "gap", note: "no staircase line in the engine" },
  { row: "Office build-out", actual: L("Office"), platform_sections: [], kind: "gap", note: "AED 0 — in the aluminum quote" },
  { row: "Terrace balcony", actual: L("Terrace"), platform_sections: [], kind: "gap" },
  { row: "Master bathroom built-in & partition", actual: L("Master Bathroom"), platform_sections: [], kind: "gap", note: "custom built-in — not modelled" },
  { row: "Tiles & slabs supply (net of 40%)", actual: TRADE_TOTALS.tiles.excl_vat, platform_sections: ["Wall Finishes"], kind: "gap", note: "platform has no separate tile SUPPLY line; Wall Finishes shown as nearest proxy — capture gap" },
  { row: "Joinery supply+install (net of 4%)", actual: TRADE_TOTALS.joinery.excl_vat, platform_sections: ["Joinery"], kind: "computed", note: "NEW ground-truth section (heuristic qty × Atrium rates)" },
  { row: "Aluminum & glass supply+install", actual: TRADE_TOTALS.aluminum.excl_vat, platform_sections: ["Aluminum & Glass"], kind: "allowance", note: "site_assessment allowances seeded from the Global Creation quote" },
  { row: "Sanitary supply (net of disc.)", actual: TRADE_TOTALS.sanitary.excl_vat, platform_sections: ["Sanitaryware"], kind: "gap", note: "platform Sanitaryware is a partial supply estimate — capture gap" },
];
const ACTUAL_TOTAL = 453_228.5036; // Delta Log TOTAL (gross labour)

async function loadEnv() {
  const env: Record<string, string> = {};
  const raw = await readFile(`${ROOT}/.env.local`, "utf8").catch(() => "");
  for (const line of raw.split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e !== -1) env[t.slice(0, e).trim()] = t.slice(e + 1).trim(); }
  return env;
}
const pct = (p: number, a: number) => (a === 0 ? 0 : Math.round(((p - a) / a) * 1000) / 10);
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

async function main() {
  const env = await loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: boqRows } = await supabase.from("boqs").select("sections").eq("project_id", PID).order("created_at", { ascending: false }).limit(1);
  const boq = (boqRows as { sections: { sections: { work_section: string; section_total_aed: number }[]; subtotal_aed: number } }[])?.[0]?.sections;
  if (!boq) throw new Error("No BoQ for Mudon — regenerate first.");
  const secTotal = new Map(boq.sections.map((s) => [s.work_section, s.section_total_aed]));

  const platform_by_section: Record<string, number> = {};
  for (const s of boq.sections) platform_by_section[s.work_section] = s.section_total_aed;
  const actual_by_section: Record<string, number> = {};

  const table: { row: string; platform: number | null; actual: number; delta_pct: number | null; kind: string }[] = [];
  for (const r of DELTA_LOG) {
    actual_by_section[r.row] = r.actual;
    const platform = r.platform_sections.length ? r.platform_sections.reduce((s, n) => s + (secTotal.get(n) ?? 0), 0) : null;
    table.push({ row: r.row, platform, actual: r.actual, delta_pct: platform != null ? pct(platform, r.actual) : null, kind: r.kind });
  }

  const platformSubtotal = boq.subtotal_aed;
  const overallDelta = pct(platformSubtotal, ACTUAL_TOTAL);
  const captureGaps = DELTA_LOG.filter((r) => r.kind === "gap").map((r) => r.row);
  const notes = [
    `Platform subtotal ${fmt(platformSubtotal)} vs actual (gross-labour) ${fmt(ACTUAL_TOTAL)} → ${overallDelta}%.`,
    `Joinery + Aluminum & Glass now present (were absent = 39% of value).`,
    `Capture gaps (platform can't itemise): ${captureGaps.join("; ")}.`,
    `Tile SUPPLY + supply/install split + openings deductions remain uncaptured.`,
  ].join(" ");

  // Write boq_outcomes (delta-log entry #1).
  const ins = await supabase.from("boq_outcomes").insert({
    project_id: PID,
    platform_boq_total: platformSubtotal,
    platform_by_section,
    actual_total: ACTUAL_TOTAL,
    actual_by_section,
    delta_pct: overallDelta,
    capture_gap_notes: notes,
  });
  if (ins.error) throw new Error(`boq_outcomes insert failed: ${ins.error.message}`);

  // Print the human-loop table (Step 7).
  console.log("\nDELTA LOG — Mudon Villa 94 (excl VAT; labour = gross pre-discount)\n");
  console.log("Section".padEnd(40) + "Platform".padStart(12) + "Actual".padStart(12) + "Δ%".padStart(9) + "  Type");
  console.log("-".repeat(82));
  for (const t of table) {
    console.log(
      t.row.padEnd(40) +
      (t.platform != null ? fmt(t.platform) : "—").padStart(12) +
      fmt(t.actual).padStart(12) +
      (t.delta_pct != null ? `${t.delta_pct > 0 ? "+" : ""}${t.delta_pct}%` : "—").padStart(9) +
      "  " + t.kind,
    );
  }
  console.log("-".repeat(82));
  console.log("TOTAL (excl VAT)".padEnd(40) + fmt(platformSubtotal).padStart(12) + fmt(ACTUAL_TOTAL).padStart(12) + `${overallDelta > 0 ? "+" : ""}${overallDelta}%`.padStart(9));
  console.log(`\nboq_outcomes entry #1 recorded. ${notes}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
