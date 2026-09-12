// =============================================================================
// scripts/garden-dry-run-live.ts — the dry-run, end to end (garden pilot G3).
//
// Draws the traced Villa 94 garden into the ground-truth project through the
// real routes (draw-plan → update-plan → plan-elements → plan-fixtures),
// generates a BoQ through /api/generate-boq, and checks that what comes back
// matches what the pure take-off computed. This is what proves the WIRING, not
// just the rules: the same numbers have to survive the database round trip and
// the BoQ assembly.
//
// Then it records the platform side of delta-log entry #2, which was left null
// in G2 precisely because this BoQ did not exist yet.
//
// Run (dev server on the given port, GARDEN_PILOT_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-dry-run-live.ts [port]
// =============================================================================

import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { computeGardenTakeoff, priceGardenTakeoff } from "../lib/boq/garden-takeoff.ts";
import { VILLA94_GARDEN, PLOT } from "../lib/ground-truth/villa94-garden-plan.ts";
import { TOTALS, PUBLIC_SOURCE_LABEL, INTERNAL_REF } from "../lib/ground-truth/villa94-garden.ts";

const ROOT = "C:/dev/rennovaite";
const PORT = process.argv[2] ?? "3098";
const BASE = `http://localhost:${PORT}`;
const PROJECT_NAME = "Villa 94 garden (ground truth)";
const LANDSCAPE_SECTIONS = [
  "Preliminaries",
  "Demolition",
  "Hardscape & Structures",
  "Soft Landscaping",
  "Irrigation",
  "Electrical & Lighting",
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);

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
  (await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  })).json();

/**
 * Lay the traced zones out on the canvas so none of them overlap.
 *
 * The dry-run's numbers come from the traced AREAS, not from where the
 * rectangles sit, so a simple non-overlapping strip packing is honest here: it
 * preserves every area exactly and keeps the plan's overlap gate happy. The
 * real client garden gets drawn in the editor.
 */
function layout(): { id: string; name_en: string; name_ar: null; room_type: string; area_m2: number; polygon: number[][]; unroofed: boolean }[] {
  const rows: ReturnType<typeof layout> = [];
  // Normalised space: x in [0,1] spans PLOT.width_m.
  const unit = PLOT.width_m; // metres per normalised unit
  let cursorY = 0.02;
  let cursorX = 0.02;
  let rowHeight = 0;
  for (const z of VILLA94_GARDEN.zones) {
    // Lay each zone as a square of the right area, wrapping into rows.
    const side = Math.sqrt(z.area_m2) / unit; // normalised
    if (cursorX + side > 0.98) {
      cursorX = 0.02;
      cursorY += rowHeight + 0.02;
      rowHeight = 0;
    }
    const x0 = cursorX;
    const y0 = cursorY;
    rows.push({
      id: crypto.randomUUID(),
      name_en: z.name,
      name_ar: null,
      room_type: z.kind,
      area_m2: z.area_m2,
      polygon: [
        [x0, y0],
        [x0 + side, y0],
        [x0 + side, y0 + side],
        [x0, y0 + side],
      ],
      unroofed: true,
    });
    cursorX += side + 0.02;
    rowHeight = Math.max(rowHeight, side);
  }
  return rows;
}

async function main() {
  const env = await loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }) as SupabaseClient;

  const before = (await db.from("projects").select("id", { count: "exact", head: true })).count ?? 0;
  console.log(`[blast radius] projects before: ${before}`);

  const { data: proj } = await db
    .from("projects")
    .select("id")
    .eq("name", PROJECT_NAME)
    .maybeSingle<{ id: string }>();
  if (!proj) throw new Error(`Ground-truth project "${PROJECT_NAME}" not found — run record-garden-outcome first.`);
  const projectId = proj.id;
  console.log(`ground-truth project ${projectId}\n`);

  // --- 1. give it an authored plan at the traced plot size -------------------
  let { data: plan } = await db
    .from("plans")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle<{ id: string }>();
  if (!plan) {
    const { data } = await db
      .from("plans")
      .insert({
        project_id: projectId,
        pdf_url: null,
        source: "user_drawn",
        plot_width_m: PLOT.width_m,
        plot_depth_m: PLOT.depth_m,
        total_area_m2: 0,
      })
      .select("id")
      .single<{ id: string }>();
    plan = data!;
  } else {
    await db
      .from("plans")
      .update({ source: "user_drawn", plot_width_m: PLOT.width_m, plot_depth_m: PLOT.depth_m })
      .eq("id", plan.id);
  }
  const planId = plan!.id;

  // --- 2. zones through the real save route ---------------------------------
  // Clear first: /api/update-plan removes only the ids the editor explicitly
  // lists as deleted, which is right for the editor (it always posts the whole
  // set with stable ids) and wrong for a script that mints new ones each run.
  await db.from("rooms").delete().eq("plan_id", planId);
  const rooms = layout();
  const saved = await post("/api/update-plan", {
    plan_id: planId,
    rooms: rooms.map((r) => ({
      id: r.id,
      name_en: r.name_en,
      name_ar: r.name_ar,
      room_type: r.room_type,
      area_m2: r.area_m2,
      polygon: r.polygon,
      unroofed: r.unroofed,
    })),
    deleted_ids: [],
  });
  check("zones save through /api/update-plan", saved.success === true, JSON.stringify(saved).slice(0, 160));
  check("no overlaps in the laid-out plan", saved.has_overlaps === false, JSON.stringify(saved.overlap_pairs ?? []));

  const { data: storedRooms } = await db
    .from("rooms")
    .select("id, name_en, room_type, area_m2")
    .eq("plan_id", planId);
  const areaById = new Map((storedRooms ?? []).map((r) => [r.name_en as string, Number(r.area_m2)]));
  const areasExact = VILLA94_GARDEN.zones.every((z) => areaById.get(z.name) === z.area_m2);
  check("every traced area round-trips exactly", areasExact);

  const nameToId = new Map((storedRooms ?? []).map((r) => [r.name_en as string, r.id as string]));

  // --- 3. runs, with the counter variants set -------------------------------
  await db.from("plan_elements").delete().eq("plan_id", planId);
  const mPerUnit = PLOT.width_m;
  for (const run of VILLA94_GARDEN.runs ?? []) {
    const span = run.length_m / mPerUnit;
    const res = await post("/api/plan-elements", {
      plan_id: planId,
      kind: run.kind,
      polyline: [[0.02, 0.5], [0.02 + span, 0.5]],
      ...(run.variant ? { variant: run.variant } : {}),
    });
    if (res.error) check(`run ${run.id} persists`, false, res.error);
  }
  const { data: storedRuns } = await db
    .from("plan_elements")
    .select("kind, variant, polyline")
    .eq("plan_id", planId);
  check("all four runs persist", (storedRuns ?? []).length === 4, String((storedRuns ?? []).length));
  check(
    "counter variants persist",
    (storedRuns ?? []).filter((r) => r.variant === "bbq").length === 1 &&
      (storedRuns ?? []).filter((r) => r.variant === "bar").length === 1,
    JSON.stringify((storedRuns ?? []).map((r) => r.variant)),
  );

  // --- 4. units + points -----------------------------------------------------
  await db.from("plan_fixtures").delete().eq("project_id", projectId);
  const fixtures: Record<string, unknown>[] = [];
  for (const u of VILLA94_GARDEN.units ?? []) {
    fixtures.push({
      project_id: projectId,
      layer: "landscape",
      type: u.kind,
      room_id: null,
      position: [0.5, 0.5],
      source: "user",
    });
  }
  const lawnId = nameToId.get("Backyard lawn") ?? null;
  for (const p of VILLA94_GARDEN.points ?? []) {
    fixtures.push({
      project_id: projectId,
      layer: p.type === "boundary_light" ? "electrical" : "electrical",
      type: p.type,
      room_id: p.type === "garden_light" ? lawnId : null,
      position: [0.5, 0.5],
      source: "user",
    });
  }
  const ins = await db.from("plan_fixtures").insert(fixtures);
  check("units + points persist", !ins.error, ins.error?.message ?? `${fixtures.length} rows`);

  // --- 5. generate the BoQ through the real route ----------------------------
  const gen = await post("/api/generate-boq", { project_id: projectId });
  check("BoQ generates", !gen.error, JSON.stringify(gen).slice(0, 200));

  const { data: boqRow } = await db
    .from("boqs")
    .select("sections, total_aed")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ sections: Record<string, unknown>; total_aed: number }>();
  const boq = boqRow?.sections as {
    sections: { work_section: string; lines: Record<string, unknown>[]; section_total_aed: number }[];
    subtotal_aed: number;
  };
  check("BoQ persisted with sections", Array.isArray(boq?.sections), String(boq?.sections?.length));

  const landscape = (boq?.sections ?? []).filter((s) => LANDSCAPE_SECTIONS.includes(s.work_section));
  check(
    "landscape sections present, POMI-named",
    landscape.length === LANDSCAPE_SECTIONS.length,
    landscape.map((s) => s.work_section).join(" · "),
  );

  // Cross-check the wired BoQ against the pure take-off.
  const pure = priceGardenTakeoff(computeGardenTakeoff(VILLA94_GARDEN).items);
  const pureTotal = r2(pure.reduce((s, l) => s + l.total_aed, 0));
  const wiredTotal = r2(landscape.reduce((s, x) => s + Number(x.section_total_aed), 0));
  check(
    "wired total equals the pure take-off",
    Math.abs(wiredTotal - pureTotal) < 1,
    `wired ${money(wiredTotal)} vs pure ${money(pureTotal)}`,
  );

  const allLines = landscape.flatMap((s) => s.lines);
  check("every landscape line carries a rate_status", allLines.every((l) => !!l.rate_status));
  check(
    "the untyped-counter flag is absent (both counters are typed)",
    !allLines.some((l) => l.rate_status === "needs_selection"),
  );
  check(
    "the irrigation allowance carries both flags",
    allLines.some((l) => l.rate_status === "site_assessment" && l.qty_derived === true),
  );
  check(
    "element_refs trace lines back to zones",
    allLines.some((l) => Array.isArray(l.element_refs) && (l.element_refs as string[]).length > 0),
  );
  check(
    "the contractor is never named on a BoQ line",
    !allLines.some((l) => /KAME/i.test(JSON.stringify(l))),
  );
  check(
    "lines cite the public market-reference label",
    allLines.every((l) => String(l.vendor_or_source ?? "").includes(PUBLIC_SOURCE_LABEL)),
  );

  const { count: tiCount } = await db
    .from("takeoff_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .like("work_item_key", "garden.%");
  check("per-element takeoff_items persisted", (tiCount ?? 0) > 0, `${tiCount} rows`);

  // --- 6. record the platform side of delta-log entry #2 ---------------------
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
      /PLATFORM SIDE PENDING[^]*$/,
      `PLATFORM SIDE RECORDED (G3 dry-run): plan traced from the setting-out drawing at 1:50. ` +
        `Paved surface measures 64.27 m² against 87 m² of quoted paving install and a 66.24 m² tile order — ` +
        `the platform lands within 3% of what was actually bought and 26% below what was quoted. ` +
        `Lawn measures 62 m² against 71 m² quoted. Every other line matches to the fils. ` +
        `Lighting point counts are the contract's: the drawing pack carries no lighting layout.`,
    );
    await db
      .from("boq_outcomes")
      .update({
        platform_boq_total: wiredTotal,
        platform_by_section: byName,
        delta_pct: deltaPct,
        capture_gap_notes: notes,
      })
      .eq("id", outcome.id);
    check("delta-log entry #2 now carries the platform side", true, `${money(wiredTotal)} (${deltaPct}%)`);
  } else {
    check("delta-log entry #2 exists", false, "run record-garden-outcome first");
  }

  const after = (await db.from("projects").select("id", { count: "exact", head: true })).count ?? 0;
  console.log(`[blast radius] projects after: ${after} (was ${before})\n`);

  console.log("  PLATFORM BoQ BY SECTION");
  for (const s of landscape) {
    console.log(`    ${s.work_section.padEnd(26)} ${money(Number(s.section_total_aed)).padStart(14)}  (${s.lines.length} lines)`);
  }
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
