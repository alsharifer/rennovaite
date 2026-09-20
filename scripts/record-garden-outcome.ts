// =============================================================================
// scripts/record-garden-outcome.ts — delta-log entry #2 (garden pilot G2).
//
// Records the Villa 94 garden as ground-truth project #2: the contractor's
// actual per-section spend, the project total including client-supplied items,
// and the 90-day duration anchor. The PLATFORM side is deliberately empty —
// the platform BoQ for this garden does not exist until the G3 dry-run draws
// the plan and generates it. An entry with a fabricated platform figure would
// be worse than no entry.
//
// Unlike Mudon, the discount here distributes exactly: 12% was applied
// uniformly to the whole quoted subtotal, so every line × 0.88 sums to the contract
// total. Mudon's AED 36,500 was a flat contract-level figure and must NOT be
// spread across sections — see scripts/record-boq-outcome.ts.
//
// IDEMPOTENT: replaces only this project's prior rows.
//
// Run: node scripts/record-garden-outcome.ts   (after migration 023)
// =============================================================================

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import {
  CONTRACT_LINES,
  EXCLUSIONS,
  NET_FACTOR,
  PUBLIC_SOURCE_LABEL,
  TIMELINE,
  TOTALS,
} from "../lib/ground-truth/villa94-garden.ts";

const ROOT = "C:/dev/rennovaite";
const PROJECT_NAME = "Villa 94 garden (ground truth)";

/** Contract ref prefix → the landscape POMI section it belongs to. */
const SECTION_OF: { match: (ref: string) => boolean; section: string }[] = [
  { match: (r) => r.startsWith("A") || r.startsWith("B"), section: "Preliminaries" },
  { match: (r) => r.startsWith("C"), section: "Demolition" },
  { match: (r) => r === "D1.1" || r === "D1.2" || r === "D1.3" || r.startsWith("G"), section: "External Works" },
  { match: (r) => r.startsWith("D1") || r.startsWith("E"), section: "Landscape Structures" },
  { match: (r) => r.startsWith("H"), section: "Irrigation" },
  { match: (r) => r.startsWith("I"), section: "External Lighting" },
  { match: (r) => r.startsWith("D2") || r.startsWith("D3"), section: "External Works" },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

function actualBySection(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of CONTRACT_LINES) {
    if (l.amount === 0) continue; // absorbed lines carry no cost of their own
    const s = SECTION_OF.find((m) => m.match(l.ref))?.section;
    if (!s) throw new Error(`No section mapped for contract ref ${l.ref}`);
    out[s] = round2((out[s] ?? 0) + l.amount * NET_FACTOR);
  }
  // The variation and the two client-supplied items sit outside the contract
  // lines but inside the project the pilot calibrates against.
  out["External Lighting"] = round2(
    (out["External Lighting"] ?? 0) + TOTALS.variation_boundary_lights,
  );
  out["External Works"] = round2(
    (out["External Works"] ?? 0) + TOTALS.client_supplied.outdoor_tile,
  );
  out["Landscape Structures"] = round2(
    (out["Landscape Structures"] ?? 0) + TOTALS.client_supplied.bbq_grill,
  );
  return out;
}

async function loadEnv() {
  const env: Record<string, string> = {};
  const raw = await readFile(`${ROOT}/.env.local`, "utf8").catch(() => "");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const e = t.indexOf("=");
    if (e !== -1) env[t.slice(0, e).trim()] = t.slice(e + 1).trim();
  }
  return env;
}

async function main() {
  const bySection = actualBySection();
  const sum = round2(Object.values(bySection).reduce((a, b) => a + b, 0));
  if (Math.abs(sum - TOTALS.project_total) > 0.01) {
    throw new Error(
      `Section split ${sum} does not reconcile to the project total ${TOTALS.project_total}`,
    );
  }

  const env = await loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env in .env.local");
  const supabase = createClient(url, key);

  // Find or create the ground-truth project. It is a calibration record, not a
  // scratch fixture: the G3 dry-run draws this garden's plan into it.
  const { data: existing } = await supabase
    .from("projects")
    .select("id, name")
    .eq("name", PROJECT_NAME)
    .maybeSingle();

  let projectId = existing?.id ?? null;
  if (!projectId) {
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: PROJECT_NAME, city: "Dubai" })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Failed to create the ground-truth project.");
    projectId = data.id;
    console.log(`created ground-truth project ${projectId}`);
  } else {
    console.log(`reusing ground-truth project ${projectId}`);
  }

  const notes = [
    `Ground-truth project #2 (garden). Source: ${PUBLIC_SOURCE_LABEL}.`,
    `Contractor scope ${TOTALS.contractor_total} = contract ${TOTALS.contract_excl_vat} + boundary-light variation ${TOTALS.variation_boundary_lights}.`,
    `Project total ${TOTALS.project_total} adds client-supplied tile ${TOTALS.client_supplied.outdoor_tile} and grill ${TOTALS.client_supplied.bbq_grill}.`,
    `Sections are NET: the 12% was applied uniformly to the quoted subtotal, so distributing it per line is exact. (Mudon's flat discount is not — do not copy this.)`,
    `ABSORBED with no separate actual: manhole covers, drainage points, sweet soil, border edging, fertilizer. Takeoff rules must emit no line for these.`,
    `EXCLUDED by scope decision: ${EXCLUSIONS.join(", ")}.`,
    `Quote areas ran generous: 87 m² of paving quoted against a 66.24 m² tile order that also covered cladding. Tile supply quantities carry site_assessment.`,
    `Duration anchor: ${TIMELINE.actual_days} days mobilization → handover (quoted ${TIMELINE.quoted_working_days} working days). n=1, total only — ${TIMELINE.note}`,
    `PLATFORM SIDE PENDING: the platform BoQ for this garden arrives with the G3 dry-run. delta_pct stays null until then.`,
  ].join(" ");

  const del = await supabase.from("boq_outcomes").delete().eq("project_id", projectId);
  if (del.error) throw new Error(`delete prior outcome failed: ${del.error.message}`);

  const { error } = await supabase.from("boq_outcomes").insert({
    project_id: projectId,
    platform_boq_total: null,
    platform_by_section: {},
    actual_total: TOTALS.project_total,
    actual_by_section: bySection,
    delta_pct: null,
    capture_gap_notes: notes,
  });
  if (error) throw new Error(`insert outcome failed: ${error.message}`);

  console.log(`\nactual_by_section (net, AED excl VAT):`);
  for (const [s, v] of Object.entries(bySection)) {
    console.log(`  ${s.padEnd(24)} ${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  }
  console.log(`  ${"TOTAL".padEnd(24)} ${sum.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`\nrecorded delta-log entry #2 for project ${projectId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
