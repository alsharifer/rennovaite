// =============================================================================
// scripts/garden-dry-run-live.ts — the dry-run, end to end (garden pilot G3/G4).
//
// Draws the traced Villa 94 garden into the ground-truth project through the
// real routes (update-plan → plan-elements → plan-fixtures), generates a BoQ
// through /api/generate-boq, and checks that what comes back matches what the
// pure take-off computed. This is what proves the WIRING, not just the rules:
// the same numbers have to survive the database round trip and the BoQ
// assembly.
//
// Then it records the platform side of delta-log entry #2, which was left null
// in G2 precisely because this BoQ did not exist yet.
//
// G4: the garden is seeded at its TRUE traced geometry (villa94PlanRecords) —
// real polygons, real run polylines, lighting points where they were placed —
// instead of G3's area-preserving strip packing, because the drawing set and
// the render pack are now built from this project, and a strip-packed garden
// would dimension a garden that does not exist. The stored record now carries
// delta_lines: every line's class, reason and, for the four over-measured
// lines, the tile-purchase corroboration, so the reasoning survives outside the
// console. It also checks that the live drawing set prints the same dimensions,
// to the millimetre, as the pure sheets built from the same records.
//
// Run (dev server on the given port, GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-dry-run-live.ts [port]
// =============================================================================

import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { computeGardenTakeoff, priceGardenTakeoff } from "../lib/boq/garden-takeoff.ts";
import { buildGardenSheets } from "../lib/drawings/garden-sheets.ts";
import { compareVilla94 } from "../lib/ground-truth/villa94-garden-dryrun.ts";
import { villa94PlanRecords } from "../lib/ground-truth/villa94-garden-geometry.ts";
import { VILLA94_GARDEN, PLOT } from "../lib/ground-truth/villa94-garden-plan.ts";
import { TOTALS, PUBLIC_SOURCE_LABEL, INTERNAL_REF } from "../lib/ground-truth/villa94-garden.ts";
import { buildPlanGraph } from "../lib/plan/geometry.ts";

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
const OVER_MEASURED = ["garden.pcc_base", "garden.paving_install", "garden.grass_supply", "garden.grass_install"];

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

/** Every printed dimension on a sheet, as "kind=mm", sorted — ids differ, figures must not. */
function printedDims(svg: string): string[] {
  return [...svg.matchAll(/data-dim="([^"]+)" data-mm="(\d+)"/g)].map((m) => `${m[1]}=${m[2]}`).sort();
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

  // --- 2. zones at their traced polygons, through the real save route ---------
  // Clear first: /api/update-plan removes only the ids the editor explicitly
  // lists as deleted, which is right for the editor (it always posts the whole
  // set with stable ids) and wrong for a script that mints new ones each run.
  // Renders hang off rooms; a re-seed starts the zone renders over.
  await db.from("renders").delete().eq("project_id", projectId);
  await db.from("rooms").delete().eq("plan_id", planId);
  const records = villa94PlanRecords();
  // Record ids are readable slugs; the tables key on uuids.
  const roomUuid = new Map(records.rooms.map((r) => [r.id, crypto.randomUUID()]));
  const saved = await post("/api/update-plan", {
    plan_id: planId,
    rooms: records.rooms.map((r) => ({
      id: roomUuid.get(r.id),
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
  check("the true traced geometry has no overlaps", saved.has_overlaps === false, JSON.stringify(saved.overlap_pairs ?? []));

  // The derived-area flag lives on the zone (migration 035). The editor does not
  // author it, so it is written beside the save rather than through it.
  for (const r of records.rooms.filter((x) => x.area_derived_m2 !== null)) {
    const { error } = await db
      .from("rooms")
      .update({ area_derived_m2: r.area_derived_m2, derived_note: r.derived_note })
      .eq("id", roomUuid.get(r.id)!);
    check(`derived-area flag persists on ${r.name_en}`, !error, error?.message ?? `${r.area_derived_m2} m²`);
  }

  const { data: storedRooms } = await db
    .from("rooms")
    .select("id, name_en, area_m2, polygon")
    .eq("plan_id", planId);
  const areaByName = new Map((storedRooms ?? []).map((r) => [r.name_en as string, Number(r.area_m2)]));
  check(
    "every traced area round-trips exactly",
    VILLA94_GARDEN.zones.every((z) => areaByName.get(z.name) === z.area_m2),
  );
  const polyById = new Map((storedRooms ?? []).map((r) => [r.id as string, JSON.stringify(r.polygon)]));
  check(
    "every polygon round-trips unchanged (no overlap repair moved a vertex)",
    records.rooms.every((r) => polyById.get(roomUuid.get(r.id)!) === JSON.stringify(r.polygon)),
  );

  // --- 3. runs at their traced polylines, with the counter variants set -------
  await db.from("plan_elements").delete().eq("plan_id", planId);
  for (const run of records.elements) {
    const res = await post("/api/plan-elements", {
      plan_id: planId,
      kind: run.kind,
      polyline: run.polyline,
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

  // --- 4. units + lighting points at their placed positions -------------------
  // Lighting is AS DESIGNED: spec.source records it, and every document that
  // shows a point says so.
  await db.from("plan_fixtures").delete().eq("project_id", projectId);
  const fixtures = records.fixtures.map((f) => ({
    project_id: projectId,
    layer: f.layer,
    type: f.type,
    room_id: f.room_id ? (roomUuid.get(f.room_id) ?? null) : null,
    position: f.position,
    spec: f.spec,
    source: "user",
  }));
  check(
    "every lighting point is marked as designed",
    fixtures.filter((f) => f.layer === "electrical").every((f) => (f.spec as { source?: string } | null)?.source === "as_designed"),
  );
  const ins = await db.from("plan_fixtures").insert(fixtures);
  check("units + points persist", !ins.error, ins.error?.message ?? `${fixtures.length} rows`);

  // A direction to render in: Desert Modern, the pilot's default exterior style.
  const { data: styleRows } = await db
    .from("style_choices")
    .select("style_key")
    .eq("project_id", projectId)
    .is("room_id", null)
    .limit(1);
  if (!styleRows || styleRows.length === 0) {
    const sc = await post("/api/style-choice", { project_id: projectId, style_key: "desert-modern" });
    check("a garden direction is locked", !sc.error, sc.error ?? "desert-modern");
  }

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

  // Cross-check the wired BoQ against the pure take-off and the dry-run.
  const pure = priceGardenTakeoff(computeGardenTakeoff(VILLA94_GARDEN).items);
  const pureTotal = r2(pure.reduce((s, l) => s + l.total_aed, 0));
  const dry = compareVilla94();
  check("the pure take-off is the dry-run's platform side", Math.abs(dry.platform_total - pureTotal) < 0.01, money(dry.platform_total));
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
      /(PLATFORM SIDE PENDING|PLATFORM SIDE RECORDED)[^]*$/,
      `PLATFORM SIDE RECORDED (G3 dry-run, geometry-refined in G4): plan traced from the setting-out drawing at 1:50 and seeded at its true polygons. ` +
        `Four lines are over-measured by the contract (PCC, paving install, grass supply, grass install) — delta_lines carries each one's class, ` +
        `reason and the client tile-purchase corroboration (66.24 m² bought against 87 m² of paving quoted). The backyard lawn includes 1.8 m² ` +
        `derived from an elliptical quarter, flagged on the zone. Lighting point counts are the contract's and positions are AS DESIGNED: ` +
        `the drawing pack carries no lighting layout.`,
    );
    const { error: updErr } = await db
      .from("boq_outcomes")
      .update({
        platform_boq_total: wiredTotal,
        platform_by_section: byName,
        delta_pct: deltaPct,
        capture_gap_notes: notes,
        delta_lines: dry.lines,
      })
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

  // --- 7. the live drawing set prints the pure sheets' dimensions -------------
  const liveRes = await fetch(`${BASE}/api/projects/${projectId}/drawings`);
  const liveSet = (await liveRes.json().catch(() => ({}))) as {
    sheets?: { sheetNumber: string; kind: string; svg: string }[];
    error?: string;
  };
  const graph = buildPlanGraph({
    projectId,
    planId,
    scale: null,
    total_area_m2: records.rooms.reduce((s, r) => s + r.area_m2, 0),
    rooms: records.rooms,
    elements: records.elements,
    unit_to_m: records.plot.width_m,
    plot: records.plot,
    source: "user_drawn",
  });
  const pureSheets = buildGardenSheets(graph, records.fixtures, {
    projectNameEn: PROJECT_NAME,
    projectNameAr: null,
    community: "Dubai",
    level: "ground",
    scale: "1:100",
    dateISO: "2026-09-13",
  });
  check("live drawing set generates", Array.isArray(liveSet.sheets), liveSet.error ?? `${liveSet.sheets?.length} sheets`);
  let dimsCompared = 0;
  const mismatched: string[] = [];
  for (const ps of pureSheets) {
    const live = liveSet.sheets?.find((s) => s.sheetNumber === ps.sheetNumber);
    const a = printedDims(ps.svg);
    const b = live ? printedDims(live.svg) : [];
    dimsCompared += a.length;
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatched.push(`${ps.sheetNumber} (pure ${a.length} / live ${b.length})`);
  }
  check(
    "every live sheet dimension equals the pure graph, to the mm",
    dimsCompared > 0 && mismatched.length === 0,
    mismatched.length ? mismatched.join(", ") : `${dimsCompared} dimensions on ${pureSheets.length} sheets`,
  );

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
