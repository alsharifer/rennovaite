// =============================================================================
// scripts/garden-change-report.ts — Step 5 receipt (garden pilot G5): what moved
// when the client garden was amended from derived to measured dimensions.
//
// Compares the quantity baseline saved when the draft pack was generated
// (screenshots/garden-pilot/g5-draft-baseline.json) with the project's current
// BoQ and take-off: every quantity that moved, old → new, the BoQ delta, and
// whether the draft watermark now drops (it drops only when no boundary-critical
// dimension is derived any more).
//
// Run after amending the plan and regenerating the BoQ:
//   node --import ./scripts/_alias-hook.mjs scripts/garden-change-report.ts <project-id> [--baseline <file>]
// Writes screenshots/garden-pilot/g5-change-report.json.
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { changeReport, snapshotOf, type QtySnapshot } from "../lib/pilot/change-report.ts";

const ROOT = "C:/dev/rennovaite";
const args = process.argv.slice(2);
const projectId = args.find((a) => /^[0-9a-f-]{36}$/.test(a));
const baselinePath = args.includes("--baseline") ? args[args.indexOf("--baseline") + 1]! : `${ROOT}/screenshots/garden-pilot/g5-draft-baseline.json`;
if (!projectId) {
  console.error("usage: garden-change-report.ts <project-id> [--baseline file]");
  process.exit(1);
}

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as QtySnapshot;

const { data: boqRow, error } = await db.from("boqs").select("id, sections, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).single();
if (error || !boqRow) throw new Error(`no BoQ: ${error?.message}`);
if (boqRow.id === baseline.boq_id) console.warn("warning: the latest BoQ IS the baseline — regenerate the BoQ after amending the plan.");
const { data: takeoff } = await db.from("takeoff_items").select("work_item_key, element_id, qty, unit").eq("project_id", projectId).like("work_item_key", "garden.%");
const boq = boqRow.sections as Parameters<typeof snapshotOf>[0]["boq"] & { garden?: { draft?: { draft: boolean; derived: string[] } } };
const current = snapshotOf({ capturedAt: String(boqRow.created_at), boqId: boqRow.id, boq, takeoff: takeoff ?? [], draft: { draft: boq.garden?.draft?.draft ?? false, derived: boq.garden?.draft?.derived ?? [] } });
const report = changeReport(baseline, current);

console.log(`\nCHANGE REPORT — ${report.from} → ${report.to}`);
console.log(`${"LINE".padEnd(60)} ${"OLD".padStart(10)} ${"NEW".padStart(10)} ${"Δ".padStart(9)} ${"Δ AED".padStart(11)}`);
for (const m of report.moved) {
  console.log(`${`${m.section} — ${m.description}`.slice(0, 60).padEnd(60)} ${String(m.old_qty ?? "—").padStart(10)} ${String(m.new_qty ?? "—").padStart(10)} ${`${m.delta_qty >= 0 ? "+" : ""}${m.delta_qty}`.padStart(9)} ${`${m.delta_aed >= 0 ? "+" : ""}${m.delta_aed}`.padStart(11)}  ${m.status === "moved" ? m.unit : m.status}`);
}
console.log(`\n${report.moved.length} line(s) moved, ${report.unchanged} unchanged; ${report.element_rows_moved.length} per-element take-off row(s) moved`);
console.log(`BoQ total AED ${report.boq.old_total_aed} → ${report.boq.new_total_aed} (${report.boq.delta_aed >= 0 ? "+" : ""}${report.boq.delta_aed}, ${report.boq.delta_pct ?? "—"}%)`);
console.log(report.draft.watermark_drops ? "Draft watermark DROPS — no boundary-critical dimension is derived." : `Still a draft — derived: ${report.draft.still_derived.join(", ") || "(none)"}`);

writeFileSync(`${ROOT}/screenshots/garden-pilot/g5-change-report.json`, JSON.stringify(report, null, 2));
