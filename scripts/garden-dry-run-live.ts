// =============================================================================
// scripts/garden-dry-run-live.ts — the dry-run, end to end (garden pilot G3/G4/G4b).
//
// Draws the traced Villa 94 garden into the ground-truth project through the
// real routes (scripts/lib/garden-seed.ts), generates a BoQ through
// /api/generate-boq, and checks that what comes back matches what the pure
// take-off computed. This is what proves the WIRING, not just the rules.
//
// Then it records the platform side of delta-log entry #2, with delta_lines:
// every line's class, reason and, for the four over-measured lines, the
// tile-purchase corroboration.
//
// G4b: the seed carries levels, structure heights, build-ups and the existing
// context, and the live drawing check covers the elevation sheets — every
// printed horizontal AND vertical dimension, and every level tag, on the live
// set must equal the pure sheets built from the same records.
//
// Run (dev server on the given port, GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-dry-run-live.ts [port]
// =============================================================================

import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { computeGardenTakeoff, priceGardenTakeoff } from "../lib/boq/garden-takeoff.ts";
import { transcriptionGardenBook } from "../lib/boq/garden-rates.ts";
import { buildElevationSheets } from "../lib/drawings/garden-elevations.ts";
import { buildGardenSheets } from "../lib/drawings/garden-sheets.ts";
import { compareVilla94 } from "../lib/ground-truth/villa94-garden-dryrun.ts";
import { VILLA94_GARDEN } from "../lib/ground-truth/villa94-garden-plan.ts";
import { TOTALS, PUBLIC_SOURCE_LABEL, INTERNAL_REF } from "../lib/ground-truth/villa94-garden.ts";
import { buildPlanGraph } from "../lib/plan/geometry.ts";

import { seedVilla94Garden } from "./lib/garden-seed.ts";

const ROOT = "C:/dev/rennovaite";
const PORT = process.argv[2] ?? "3098";
const BASE = `http://localhost:${PORT}`;
const PROJECT_NAME = "Villa 94 garden (ground truth)";
const LANDSCAPE_SECTIONS = ["Preliminaries", "Demolition", "Hardscape & Structures", "Soft Landscaping", "Irrigation", "Electrical & Lighting"];
const OVER_MEASURED = ["garden.pcc_base", "garden.paving_install", "garden.grass_supply", "garden.grass_install"];

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);

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

const post = async (p: string, b: unknown) =>
  (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();

/** Every printed figure on a sheet — dimensions (h and v) and level tags — sorted. Ids differ; figures must not. */
function printedFigures(svg: string): string[] {
  const dims = [...svg.matchAll(/data-dim="([^"]+)"(?: data-axis="([hv])")? data-mm="(-?\d+)"/g)].map((m) => `${m[1]}${m[2] ? `/${m[2]}` : ""}=${m[3]}`);
  const levels = [...svg.matchAll(/data-level="(-?\d+)"/g)].map((m) => `level=${m[1]}`);
  return [...dims, ...levels].sort();
}

async function main() {
  const env = await loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as SupabaseClient;

  const before = (await db.from("projects").select("id", { count: "exact", head: true })).count ?? 0;
  console.log(`[blast radius] projects before: ${before}`);

  const { data: proj } = await db.from("projects").select("id").eq("name", PROJECT_NAME).maybeSingle<{ id: string }>();
  if (!proj) throw new Error(`Ground-truth project "${PROJECT_NAME}" not found — run record-garden-outcome first.`);
  const projectId = proj.id;
  console.log(`ground-truth project ${projectId}\n`);

  const { planId, records } = await seedVilla94Garden(db, BASE, projectId, check);

  // --- BoQ through the real route ----------------------------------------------------
  const gen = await post("/api/generate-boq", { project_id: projectId });
  check("BoQ generates", !gen.error, JSON.stringify(gen).slice(0, 200));

  const { data: boqRow } = await db
    .from("boqs")
    .select("sections, total_aed")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ sections: Record<string, unknown>; total_aed: number }>();
  const boq = boqRow?.sections as { sections: { work_section: string; lines: Record<string, unknown>[]; section_total_aed: number }[] };
  check("BoQ persisted with sections", Array.isArray(boq?.sections), String(boq?.sections?.length));

  const landscape = (boq?.sections ?? []).filter((s) => LANDSCAPE_SECTIONS.includes(s.work_section));
  check("landscape sections present, POMI-named", landscape.length === LANDSCAPE_SECTIONS.length, landscape.map((s) => s.work_section).join(" · "));

  const pureBook = transcriptionGardenBook();
  const pure = priceGardenTakeoff(computeGardenTakeoff(VILLA94_GARDEN, pureBook).items, pureBook);
  const pureTotal = r2(pure.reduce((s, l) => s + l.total_aed, 0));
  const dry = compareVilla94();
  check("the pure take-off is the dry-run's platform side", Math.abs(dry.platform_total - pureTotal) < 0.01, money(dry.platform_total));
  const wiredTotal = r2(landscape.reduce((s, x) => s + Number(x.section_total_aed), 0));
  check("wired total equals the pure take-off", Math.abs(wiredTotal - pureTotal) < 1, `wired ${money(wiredTotal)} vs pure ${money(pureTotal)}`);

  const allLines = landscape.flatMap((s) => s.lines);
  check("every landscape line carries a rate_status", allLines.every((l) => !!l.rate_status));
  check("the untyped-counter flag is absent (both counters are typed)", !allLines.some((l) => l.rate_status === "needs_selection"));
  check("the irrigation allowance carries both flags", allLines.some((l) => l.rate_status === "site_assessment" && l.qty_derived === true));
  check("element_refs trace lines back to zones", allLines.some((l) => Array.isArray(l.element_refs) && (l.element_refs as string[]).length > 0));
  check("the contractor is never named on a BoQ line", !allLines.some((l) => /KAME/i.test(JSON.stringify(l))));
  check("lines cite the public market-reference label", allLines.every((l) => String(l.vendor_or_source ?? "").includes(PUBLIC_SOURCE_LABEL)));

  const { count: tiCount } = await db.from("takeoff_items").select("id", { count: "exact", head: true }).eq("project_id", projectId).like("work_item_key", "garden.%");
  check("per-element takeoff_items persisted", (tiCount ?? 0) > 0, `${tiCount} rows`);

  // --- Delta-log entry #2 -------------------------------------------------------------
  const byName: Record<string, number> = {};
  for (const s of landscape) byName[s.work_section] = r2(Number(s.section_total_aed));
  const deltaPct = r2(((wiredTotal - TOTALS.project_total) / TOTALS.project_total) * 100);
  const { data: outcome } = await db
    .from("boq_outcomes")
    .select("id, capture_gap_notes")
    .eq("project_id", projectId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; capture_gap_notes: string }>();
  if (outcome) {
    const notes = outcome.capture_gap_notes.replace(
      /(PLATFORM SIDE PENDING|PLATFORM SIDE RECORDED)[^]*$/,
      `PLATFORM SIDE RECORDED (G3 dry-run, geometry-refined in G4 and G4b): plan traced from the setting-out drawing at 1:50 and seeded at its true polygons, levels and heights. ` +
        `G4b corrected three trace errors found when the villa outline was traced (courtyard L +1.26 m², front approach −2.76 m² and split at +150/±000, courtyard-mouth step −0.72 m² of lawn). ` +
        `Four lines are over-measured by the contract (PCC, paving install, grass supply, grass install) — delta_lines carries each one's class, ` +
        `reason and the client tile-purchase corroboration (66.24 m² bought against 87 m² of paving quoted). The backyard lawn includes 1.8 m² ` +
        `derived from an elliptical quarter, flagged on the zone. Lighting point counts are the contract's and positions are AS DESIGNED.`,
    );
    const { error: updErr } = await db
      .from("boq_outcomes")
      .update({ platform_boq_total: wiredTotal, platform_by_section: byName, delta_pct: deltaPct, capture_gap_notes: notes, delta_lines: dry.lines })
      .eq("id", outcome.id);
    check("delta-log entry #2 now carries the platform side", !updErr, updErr?.message ?? `${money(wiredTotal)} (${deltaPct}%)`);

    const { data: stored } = await db
      .from("boq_outcomes")
      .select("delta_lines")
      .eq("id", outcome.id)
      .maybeSingle<{ delta_lines: { item_key: string; class: string; corroboration?: { source: string; strength: string } }[] | null }>();
    const over = (stored?.delta_lines ?? []).filter((l) => OVER_MEASURED.includes(l.item_key));
    check(
      "the four over-measured lines are stored with the tile-purchase corroboration",
      over.length === 4 && over.every((l) => l.class === "explained" && /tile invoice/.test(l.corroboration?.source ?? "")),
      over.map((l) => `${l.item_key.replace("garden.", "")}:${l.corroboration?.strength}`).join(", "),
    );
    check("stored delta_lines cover every compared line", (stored?.delta_lines ?? []).length === dry.lines.length, String(stored?.delta_lines?.length));
    check("delta_lines never name the contractor", !/KAME/i.test(JSON.stringify(stored?.delta_lines ?? [])));
  } else {
    check("delta-log entry #2 exists", false, "run record-garden-outcome first");
  }

  // --- The live drawing set prints the pure sheets' figures ------------------------------
  const liveSet = (await (await fetch(`${BASE}/api/projects/${projectId}/drawings`)).json().catch(() => ({}))) as { sheets?: { sheetNumber: string; kind: string; svg: string }[]; error?: string };
  const graph = buildPlanGraph({
    projectId,
    planId,
    scale: null,
    total_area_m2: records.rooms.reduce((s, r) => s + r.area_m2, 0),
    rooms: records.rooms,
    elements: records.elements,
    context: records.context,
    unit_to_m: records.plot.width_m,
    plot: records.plot,
    source: "user_drawn",
  });
  const meta = { projectNameEn: PROJECT_NAME, projectNameAr: null, community: "Dubai", level: "ground", scale: "1:100", dateISO: "2026-09-14" };
  const variants = Object.fromEntries(records.elements.map((e) => [e.id, e.variant]));
  const pureSheets = [...buildGardenSheets(graph, records.fixtures, meta), ...buildElevationSheets(graph, records.fixtures, meta, variants)];
  check("live drawing set generates", Array.isArray(liveSet.sheets), liveSet.error ?? `${liveSet.sheets?.length} sheets`);
  let figures = 0;
  let vertical = 0;
  const mismatched: string[] = [];
  for (const ps of pureSheets) {
    const live = liveSet.sheets?.find((s) => s.sheetNumber === ps.sheetNumber);
    const a = printedFigures(ps.svg);
    const b = live ? printedFigures(live.svg) : [];
    figures += a.length;
    vertical += a.filter((x) => x.includes("/v=")).length;
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatched.push(`${ps.sheetNumber} (pure ${a.length} / live ${b.length})`);
  }
  check(
    "every live dimension and level equals the pure graph, to the mm",
    figures > 0 && mismatched.length === 0,
    mismatched.length ? mismatched.join(", ") : `${figures} figures (${vertical} vertical) on ${pureSheets.length} sheets`,
  );
  check("every garden sheet carries its project id", (liveSet.sheets ?? []).every((s) => s.svg.includes(`data-project-id="${projectId}"`)));

  const after = (await db.from("projects").select("id", { count: "exact", head: true })).count ?? 0;
  console.log(`[blast radius] projects after: ${after} (was ${before})\n`);

  console.log("  PLATFORM BoQ BY SECTION");
  for (const s of landscape) console.log(`    ${s.work_section.padEnd(26)} ${money(Number(s.section_total_aed)).padStart(14)}  (${s.lines.length} lines)`);
  console.log(`    ${"TOTAL".padEnd(26)} ${money(wiredTotal).padStart(14)}`);
  console.log(`    vs project actual ${money(TOTALS.project_total)} → ${deltaPct >= 0 ? "+" : ""}${deltaPct}%\n`);
  console.log(`  (internal provenance, never rendered: ${INTERNAL_REF})\n`);

  for (const line of results) console.log(line);
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
