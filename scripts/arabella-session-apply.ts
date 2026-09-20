// =============================================================================
// scripts/arabella-session-apply.ts — the Newspace design session, applied to the
// client garden (garden pilot G5d, Steps 1, 2 and 6).
//
// Reads data/garden pilot/Arabella_Session_Capture.xlsx (never retyped: the
// workbook is unzipped and its sheet XML parsed, and every value this script
// applies is asserted against it), then applies the session through the same
// authored routes the editor uses, in STAGES so every quantity that moves has
// exactly one cause:
//
//   0  baseline          the BoQ Newspace reviewed (AED 116,942)
//   1  fix               code + data fixes found in review: drainage points priced
//                        (GL-28), pergola posts on the graph (L-301), what stands
//                        beyond each boundary wall (the aerial's surroundings)
//   2  design decision   Sheet B / C answers (the shed KEEP; the drawings as the
//                        layout of record)
//   3  dimension update  the point measures (path 12.2, entrance area 5.85,
//                        separator → end wall 6.0, front border 5.3, door landing)
//   4  aggregate refit   the two aggregates (grass ≈ 50 m², tiled ≈ 69.4 m²)
//   5  correction        Sheet D rows as typed market_fair corrections attributed to
//                        Newspace (confirm / scope / design) — no line moves; the
//                        scope correction is the indicative programme section
//
// The BoQ is regenerated after each stage and the stage's diff is attributed to
// that stage's cause. Pilot events the script causes are tagged stage
// "session_apply" (not designer time); the decisions and corrections themselves
// are real session data, tagged "design_session" with the instrumentation record.
//
// Refuses to run twice (the door landing exists after the first run).
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true OVERLAYS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/arabella-session-apply.ts [port]
// Writes screenshots/garden-pilot/g5d-session.json.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unzipSync, strFromU8 } from "fflate";

import { PLOT, PROJECT_NAME, toSite } from "../lib/client-garden/arabella-reference.ts";
import {
  GARAGE_POLY,
  PERGOLA_POSTS_MM,
  SESSION_FIRM,
  SESSION_MEASURES,
  SESSION_REF,
  SESSION_SOURCE,
  STEPPING_PATH,
  WALL_BEYOND,
  polyArea,
  reconciliation,
  sessionZones,
  siteNormPath,
} from "../lib/client-garden/arabella-session.ts";
import { changeReport, snapshotOf, type ChangeReport, type QtySnapshot } from "../lib/pilot/change-report.ts";

const ROOT = "C:/dev/rennovaite";
const PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? "3098";
const BASE = `http://localhost:${PORT}`;
const WORKBOOK = `${ROOT}/data/garden pilot/Arabella_Session_Capture.xlsx`;

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

type Pt = [number, number];
const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`;
  results.push(line);
  console.log(line);
};
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

// --- The workbook -------------------------------------------------------------------------

function readWorkbook(file: string): Record<string, Map<string, string>> {
  const zip = unzipSync(new Uint8Array(readFileSync(file)));
  const xml = (p: string) => strFromU8(zip[p]!);
  const unesc = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const shared = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unesc([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  const names = [...xml("xl/workbook.xml").matchAll(/<sheet name="([^"]+)" sheetId="(\d+)" r:id="rId(\d+)"/g)].map((m) => ({ name: unesc(m[1]!), n: m[3]! }));
  const out: Record<string, Map<string, string>> = {};
  for (const s of names) {
    const cells = new Map<string, string>();
    for (const c of xml(`xl/worksheets/sheet${s.n}.xml`).matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (c[3] ?? "").match(/<v>([\s\S]*?)<\/v>/);
      const is = (c[3] ?? "").match(/<t[^>]*>([\s\S]*?)<\/t>/);
      const val = v ? (/t="s"/.test(c[2]!) ? shared[Number(v[1])]! : v[1]!) : is ? unesc(is[1]!) : "";
      if (val) cells.set(c[1]!, val);
    }
    out[s.name] = cells;
  }
  return out;
}

async function main() {
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const started = new Date().toISOString();

  // --- 0. The workbook, asserted -----------------------------------------------------------
  const wb = readWorkbook(WORKBOOK);
  const A = wb["A_Dimensions_Site"]!;
  const B = wb["B_Existing_Features"]!;
  const C = wb["C_Design_Scope"]!;
  const D = wb["D_BoQ_Corrections"]!;
  const rowOf = (sheet: Map<string, string>, col: string, re: RegExp) => [...sheet.entries()].find(([k, v]) => k.startsWith(col) && /^\D+\d+$/.test(k) && re.test(v))?.[0].replace(/^[A-Z]+/, "");
  const num = (s: string | undefined) => Number((s ?? "").replace(/[^\d.]/g, "") || NaN);
  const aRow = (re: RegExp) => A.get(`C${rowOf(A, "A", re)}`);
  check("Sheet A: entrance area width", num(aRow(/garden-gate entrance area width/)) === SESSION_MEASURES.entrance_area_width_m, aRow(/garden-gate entrance area width/));
  check("Sheet A: path run from the garden gate", num(aRow(/path from garden gate/)) === SESSION_MEASURES.path_from_gate_m, aRow(/path from garden gate/));
  check("Sheet A: front border width", num(aRow(/front\/street border width/)) === SESSION_MEASURES.front_border_width_m, aRow(/front\/street border width/));
  check("Sheet A: separator → end-of-pathway wall", num(aRow(/Separator wall \(garden-entrance wall mid-pathway\)/)) === SESSION_MEASURES.separator_to_end_wall_m, aRow(/Separator wall \(garden-entrance wall mid-pathway\)/));
  const landing = aRow(/door landing/) ?? "";
  check("Sheet A: door landing", /1\.20?\s*×\s*1\.30?/.test(landing), landing);
  const grass = aRow(/TOTAL artificial grass/) ?? "";
  // "≈50 (10 × 4) + (10 x 1)" — the aggregate, and the arithmetic it was built from.
  check("Sheet A: total grass aggregate", /≈\s*50\b/.test(grass) && 10 * 4 + 10 * 1 === SESSION_MEASURES.total_grass_m2, grass);
  const tiled = aRow(/TOTAL area to be tiled/) ?? "";
  check("Sheet A: total tiled aggregate", /≈\s*69\.4\b/.test(tiled) && Math.abs(6.2 * 11.2 - SESSION_MEASURES.total_tiled_m2) < 0.05, tiled);
  const shedRow = rowOf(B, "A", /Garden shed/);
  check("Sheet B: shed override is KEEP (the only override)", B.get(`D${shedRow}`) === "Keep" && [...B.keys()].filter((k) => /^D\d+$/.test(k) && Number(k.slice(1)) > 4).length === 1, B.get(`D${shedRow}`));
  const cAnswers = [...C.entries()].filter(([k]) => /^C\d+$/.test(k) && Number(k.slice(1)) > 3).map(([k, v]) => ({ row: k.slice(1), question: C.get(`A${k.slice(1)}`)!, draft: C.get(`B${k.slice(1)}`) ?? "", answer: v }));
  check("Sheet C: three answered questions", cAnswers.length === 3, cAnswers.map((a) => a.question.slice(0, 30)).join(" | "));
  const dRows = [...D.entries()].filter(([k]) => /^H\d+$/.test(k) && Number(k.slice(1)) > 4).map(([k, type]) => {
    const r = k.slice(1);
    return { row: r, section: D.get(`A${r}`)!, line: D.get(`B${r}`)!, corrected: D.get(`G${r}`) ?? null, type, confidence: D.get(`I${r}`) ?? null, basis: D.get(`J${r}`) ?? "" };
  });
  check("Sheet D: confirm / scope / design rows", JSON.stringify(dRows.map((d) => d.type).sort()) === JSON.stringify(["confirm", "design", "scope"]), dRows.map((d) => `${d.type}:${d.confidence}`).join(", "));

  // --- The project ----------------------------------------------------------------------------
  const { data: project } = await db.from("projects").select("id").eq("name", PROJECT_NAME).single<{ id: string }>();
  const projectId = project!.id;
  const { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).single<{ id: string }>();
  const planId = plan!.id;
  const roomsNow = async () => ((await db.from("rooms").select("id, name_en, room_type, spec, height_mm, site_reference, disposition").eq("plan_id", planId)).data ?? []) as { id: string; name_en: string; room_type: string; spec: Record<string, unknown> | null; height_mm: number | null; site_reference: boolean | null; disposition: string | null }[];
  if ((await roomsNow()).some((r) => r.name_en === "Door landing — villa door")) {
    console.error("The session has already been applied to this plan (the door landing exists). Refusing to run twice.");
    process.exit(1);
  }

  // --- Snapshots -------------------------------------------------------------------------------
  const snapshot = async (label: string): Promise<QtySnapshot & { label: string }> => {
    const { data: row } = await db.from("boqs").select("id, sections, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).single();
    const { data: takeoff } = await db.from("takeoff_items").select("work_item_key, element_id, qty, unit").eq("project_id", projectId).like("work_item_key", "garden.%");
    const boq = row!.sections as Parameters<typeof snapshotOf>[0]["boq"] & { garden?: { draft?: { draft: boolean; derived: string[] } } };
    return { label, ...snapshotOf({ capturedAt: String(row!.created_at), boqId: row!.id, boq, takeoff: takeoff ?? [], draft: { draft: boq.garden?.draft?.draft ?? false, derived: boq.garden?.draft?.derived ?? [] } }) };
  };
  const regenerate = async () => {
    const gen = await call("POST", "/api/generate-boq", { project_id: projectId });
    if (gen.error) throw new Error(`generate-boq: ${gen.error}`);
  };
  const stages: (QtySnapshot & { label: string })[] = [];
  stages.push(await snapshot("baseline — the BoQ Newspace reviewed"));
  check("baseline is the reviewed BoQ (AED 116,942.01)", Math.abs(stages[0]!.grand_total_aed - 116942.01) < 0.01, String(stages[0]!.grand_total_aed));

  // --- Stage 1: fixes --------------------------------------------------------------------------
  const rooms0 = await roomsNow();
  const pergola = rooms0.find((r) => r.room_type === "structure")!;
  await call("PATCH", "/api/plan-zones", { id: pergola.id, spec: { ...(pergola.spec ?? {}), posts_mm: PERGOLA_POSTS_MM, posts_source: "four corner posts, 150 mm square, at the 3.5 × 3.5 m footprint's corners (design)" } });
  const { data: ctx } = await db.from("plan_context").select("id, name, note, polygon").eq("plan_id", planId);
  const REF_WALL_NAMES: Record<string, string> = { "wall-rear": "Rear boundary wall", "wall-corner": "Corner boundary wall (side garden)", "wall-front": "Side garden street wall", "wall-left": "Rear strip end wall" };
  for (const [key, beyond] of Object.entries(WALL_BEYOND)) {
    const w = (ctx ?? []).find((c) => c.name === REF_WALL_NAMES[key]);
    if (w) await call("PATCH", "/api/plan-context", { id: w.id, spec: { beyond } });
  }
  await regenerate();
  stages.push(await snapshot("fix"));

  // --- Stage 2: design decisions (Sheets B, C) --------------------------------------------------
  const { data: shed } = await db.from("plan_fixtures").select("id, spec, disposition").eq("project_id", projectId).eq("type", "shed").single<{ id: string; spec: Record<string, unknown> | null; disposition: string | null }>();
  const { data: shedPos } = await db.from("plan_fixtures").select("position").eq("id", shed!.id).single<{ position: Pt }>();
  await call("POST", "/api/plan-fixtures", { id: shed!.id, project_id: projectId, type: "shed", position: shedPos!.position, disposition: "keep", spec: { ...(shed!.spec ?? {}), decision_note: `KEEP — ${B.get(`E${shedRow}`) ?? "session decision"}` } });
  const decisions = [
    { question: `Sheet B — ${B.get(`A${shedRow}`)}`, answer: `${B.get(`D${shedRow}`)} — ${B.get(`E${shedRow}`) ?? ""}`.trim(), applied: "shed disposition KEEP (no demolition, no new work)" },
    ...cAnswers.map((a) => ({ question: `Sheet C — ${a.question}`, answer: a.answer, applied: /pergola/i.test(a.question) ? "drawings are the layout of record: renders re-conditioned on the graph (built-feature placement gate, g5d-1)" : /timeline/i.test(a.question) ? "indicative delivery programme section on the BoQ (Sheet D scope row)" : "recorded — no change to the plan" })),
  ];
  for (const d of decisions) await call("POST", "/api/pilot-events", { project_id: projectId, kind: "session_decision", record: SESSION_REF, ...d });
  await regenerate();
  stages.push(await snapshot("design decision"));

  // --- Stages 3 + 4: dimensions, then the aggregates --------------------------------------------
  const nameToId = new Map((await roomsNow()).map((r) => [r.name_en, r.id]));
  const newIds = { entrance: crypto.randomUUID(), landing: crypto.randomUUID() } as Record<string, string>;
  const applyZones = async (stage: "measured" | "refit") => {
    const zones = sessionZones(stage);
    const saved = await call("POST", "/api/update-plan", {
      plan_id: planId,
      rooms: zones.map((z) => ({
        id: nameToId.get(z.name) ?? newIds[z.key]!,
        name_en: z.name,
        name_ar: null,
        room_type: z.type,
        area_m2: Math.round(polyArea(z.poly) * 100) / 100,
        polygon: siteNormPath(z.poly),
        unroofed: true,
        dims_derived: z.dims_derived,
        derived_note: z.note,
      })),
      deleted_ids: [],
    });
    if (saved.success !== true || saved.has_overlaps !== false) throw new Error(`update-plan (${stage}): ${JSON.stringify(saved).slice(0, 300)}`);
    for (const z of zones) {
      const id = nameToId.get(z.name) ?? newIds[z.key]!;
      if (z.key === "pergola") continue; // its spec carries the design; the posts went in with the fixes
      const measured = z.dims_derived ? undefined : { source: SESSION_SOURCE };
      await call("PATCH", "/api/plan-zones", {
        id,
        spec: {
          ref_key: z.key,
          ...(measured ? { measured } : {}),
          ...(z.key === "front-lawn" || z.key === "front-bed" ? { assumption: `front border width ${SESSION_MEASURES.front_border_width_m} m measured (${SESSION_SOURCE}); depth 4.0 m assumed — verify on site` } : {}),
          ...(z.key === "rear-path" ? { gate: "garden gate confirmed on the pathway side, at the separator wall (design session)" } : {}),
        },
      });
    }
    return zones;
  };
  // Stage 3: the point measures.
  await applyZones("measured");
  const garage = (ctx ?? []).find((c) => c.name === "Garage / drive block")!;
  await call("PATCH", "/api/plan-context", { id: garage.id, polygon: siteNormPath(GARAGE_POLY), note: `${String(garage.note ?? "").split("; reshaped around")[0]}; reshaped around the measured ${SESSION_MEASURES.front_border_width_m} m front border — the drive width is not measured`, dims_derived: true });
  const separator = (ctx ?? []).find((c) => /^Separator wall/.test(c.name))!;
  await call("PATCH", "/api/plan-context", { id: separator.id, dims_derived: false, note: `position measured: ${SESSION_MEASURES.separator_to_end_wall_m} m to the end-of-pathway wall (${SESSION_SOURCE}) — confirms the drafted position; gate on the pathway side; height scaled from photo WA0079` });
  const { data: steps } = await db.from("plan_elements").select("id, spec").eq("plan_id", planId).eq("kind", "stepping_path").single<{ id: string; spec: Record<string, unknown> | null }>();
  await call("PATCH", "/api/plan-elements", { id: steps!.id, polyline: siteNormPath(STEPPING_PATH), spec: { ...(steps!.spec ?? {}), measured: `rear leg ${SESSION_MEASURES.path_from_gate_m} m from the garden gate (${SESSION_SOURCE})` } });
  await regenerate();
  stages.push(await snapshot("dimension update"));
  // Stage 4: the aggregates.
  const finalZones = await applyZones("refit");
  // Points follow the zones they now stand in (lighting, taps, drainage, trees, shed).
  const { data: pts } = await db.from("plan_fixtures").select("id, type, position, room_id, spec, disposition, site_reference").eq("project_id", projectId);
  const idOf = (key: string) => nameToId.get(finalZones.find((z) => z.key === key)!.name) ?? newIds[key]!;
  const insideP = (p: Pt, poly: Pt[]) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  let rezoned = 0;
  for (const f of (pts ?? []) as { id: string; type: string; position: Pt; room_id: string | null; spec: Record<string, unknown> | null; disposition: string | null; site_reference: boolean | null }[]) {
    const m = toSite([f.position[0] * PLOT.width_m, f.position[1] * PLOT.width_m]);
    const z = finalZones.find((zz) => zz.type !== "structure" && insideP(m, zz.poly)) ?? finalZones.find((zz) => insideP(m, zz.poly));
    const want = z ? idOf(z.key) : null;
    if (want === f.room_id) continue;
    await call("POST", "/api/plan-fixtures", { id: f.id, project_id: projectId, type: f.type, position: f.position, room_id: want, ...(f.site_reference ? { disposition: f.disposition } : {}) });
    rezoned++;
  }
  await regenerate();
  stages.push(await snapshot("aggregate refit"));

  // --- Stage 5: corrections (Sheet D) ----------------------------------------------------------
  const boqId = stages.at(-1)!.boq_id;
  for (const d of dRows) {
    await call("POST", "/api/boq-corrections", {
      project_id: projectId,
      boq_id: boqId,
      item_key: null,
      line_description: `${d.section} — ${d.line}`,
      correction_type: d.type,
      field: d.corrected,
      note: d.basis,
      attributed_to: SESSION_FIRM,
      confidence: d.confidence,
      session_ref: SESSION_REF,
    });
  }
  stages.push(await snapshot("correction"));

  // --- Tag the script's own events ----------------------------------------------------------------
  const { data: evs } = await db.from("pilot_events").select("id, kind, detail").eq("project_id", projectId).gte("recorded_at", started);
  let tagged = 0;
  for (const e of evs ?? []) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (!d.stage) {
      await db.from("pilot_events").update({ detail: { ...d, stage: "session_apply", source: "scripts/arabella-session-apply.ts" } }).eq("id", e.id);
      tagged++;
    }
  }

  // --- Reports -----------------------------------------------------------------------------------
  const rec = reconciliation();
  console.log("\nRECONCILIATION — zone extents (type-plan frame; site = mirror), old → after point measures → after aggregate refit");
  console.log(`  ${"ZONE".padEnd(44)} ${"DRAFT".padEnd(22)} ${"POINT MEASURES".padEnd(26)} ${"AGGREGATE REFIT".padEnd(26)} DRIVERS`);
  for (const r of rec.rows) {
    const cell = (e: string | null, a: number | null) => (e ? `${e} = ${a!.toFixed(2)}` : "—");
    console.log(`  ${`${r.name}${r.measured ? " [M]" : ""}`.slice(0, 44).padEnd(44)} ${cell(r.old_extent, r.old_m2).padEnd(22)} ${cell(r.measured_extent, r.measured_m2).padEnd(26)} ${cell(r.new_extent, r.new_m2).padEnd(26)} ${r.drivers.join(" → ") || "unchanged"} — ${r.because}`);
  }
  const t = rec.totals;
  console.log(`  grass   ${t.grass.old} → ${t.grass.measured} → ${t.grass.new} m²   (aggregate ≈ ${t.grass.target})`);
  console.log(`  tiled   ${t.tiled.old} → ${t.tiled.measured} → ${t.tiled.new} m²   (aggregate ≈ ${t.tiled.target}; pergola slab and door landing included)`);
  console.log(`  planting ${t.planting.old} → ${t.planting.measured} → ${t.planting.new} m² (what the aggregates leave unpaved and ungrassed)`);
  console.log(`  residual: ${rec.residual.width_m} m of the rear strip at the garage end is UNALLOCATED — the measured runs (entrance ${SESSION_MEASURES.entrance_area_width_m} + path ${SESSION_MEASURES.path_from_gate_m} + court ${SESSION_MEASURES.separator_to_end_wall_m}) do not fill the derived 26.7 m plot width. [M] = measured.`);
  check("grass reconciles to the measured aggregate", Math.abs(t.grass.new - SESSION_MEASURES.total_grass_m2) < 0.1, `${t.grass.new} m²`);
  check("tiled area reconciles to the measured aggregate", Math.abs(t.tiled.new - SESSION_MEASURES.total_tiled_m2) < 0.1, `${t.tiled.new} m²`);

  const causes = ["fix", "design decision", "dimension update", "aggregate refit", "correction"] as const;
  const staged: { cause: (typeof causes)[number]; report: ChangeReport }[] = causes.map((cause, i) => ({ cause, report: changeReport(stages[i]!, stages[i + 1]!) }));
  console.log("\nCHANGE REPORT — every line that moved, by cause (each movement attributed to exactly one stage)");
  for (const s of staged) {
    console.log(`  [${s.cause}] BoQ ${s.report.boq.old_total_aed} → ${s.report.boq.new_total_aed} (${s.report.boq.delta_aed >= 0 ? "+" : ""}${s.report.boq.delta_aed})`);
    for (const m of s.report.moved) console.log(`     ${`${m.section} — ${m.description}`.slice(0, 70).padEnd(70)} ${String(m.old_qty ?? "—").padStart(8)} → ${String(m.new_qty ?? "—").padEnd(8)} ${m.unit.padEnd(6)} ${`${m.delta_aed >= 0 ? "+" : ""}${m.delta_aed}`.padStart(10)} AED  ${m.status}`);
    if (s.report.moved.length === 0) console.log("     (no line moved)");
  }
  const overall = changeReport(stages[0]!, stages.at(-1)!);
  const attributed = new Set(staged.flatMap((s) => s.report.moved.map((m) => m.key)));
  const unattributed = overall.moved.filter((m) => !attributed.has(m.key));
  check("every line that moved overall is attributed to a cause", unattributed.length === 0, unattributed.map((m) => m.description).join("; ") || `${overall.moved.length} line(s)`);
  const top = [...overall.moved].sort((a, b) => Math.abs(b.delta_aed) - Math.abs(a.delta_aed)).slice(0, 5);
  console.log(`\nGRAND TOTAL  AED ${overall.boq.old_total_aed.toLocaleString("en-US")} → ${overall.boq.new_total_aed.toLocaleString("en-US")} (${overall.boq.delta_aed >= 0 ? "+" : ""}${overall.boq.delta_aed}, ${overall.boq.delta_pct}%) — the reviewed draft was ≈ 116,900`);
  console.log("TOP-5 MOVERS");
  for (const m of top) {
    const by = staged.filter((s) => s.report.moved.some((x) => x.key === m.key)).map((s) => `${s.cause} ${(s.report.moved.find((x) => x.key === m.key)!.delta_aed >= 0 ? "+" : "")}${s.report.moved.find((x) => x.key === m.key)!.delta_aed}`);
    console.log(`  ${m.description.slice(0, 60).padEnd(60)} ${String(m.old_qty ?? "—").padStart(8)} → ${String(m.new_qty ?? "—").padEnd(8)} ${`${m.delta_aed >= 0 ? "+" : ""}${m.delta_aed}`.padStart(10)} AED  (${by.join("; ")})`);
  }
  const grassLine = (s: QtySnapshot) => s.lines.find((l) => /grass/i.test(l.description) && /supply/i.test(l.description))?.quantity ?? 0;
  const pccLine = (s: QtySnapshot) => s.lines.find((l) => /PCC/i.test(l.description))?.quantity ?? 0;
  console.log(`  grass supply ${grassLine(stages[0]!)} → ${grassLine(stages.at(-1)!)} m² (${(grassLine(stages.at(-1)!) - grassLine(stages[0]!)).toFixed(2)}); PCC under paving ${pccLine(stages[0]!)} → ${pccLine(stages.at(-1)!)} m² (+${(pccLine(stages.at(-1)!) - pccLine(stages[0]!)).toFixed(2)})`);
  console.log(`  programme: an indicative delivery programme section is on the BoQ (not a line) — correction (scope, ${SESSION_FIRM})`);

  // Metrics.
  const metrics = (await (await fetch(`${BASE}/api/pilot-events?project_id=${projectId}`)).json()) as { metrics: Record<string, unknown> & { corrections: { total: number; by_type: Record<string, number> }; sessions: { record: string; decisions: number; corrections: Record<string, number> }[] } };
  const mm = metrics.metrics;
  console.log("\nPILOT METRICS");
  for (const [k, v] of Object.entries(mm)) if (typeof v !== "object" || v === null) console.log(`  ${k.padEnd(30)} ${v}`);
  console.log(`  ${"render_gate".padEnd(30)} ${JSON.stringify(mm.render_gate)}`);
  console.log(`  ${"corrections (all)".padEnd(30)} ${mm.corrections.total} — ${Object.entries(mm.corrections.by_type).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  for (const s of mm.sessions) console.log(`  ${"session record".padEnd(30)} ${s.record}: ${s.decisions} decision(s); corrections ${Object.entries(s.corrections).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  check("the session's corrections are recorded by type, confirms included", mm.corrections.by_type.confirm === 1 && mm.corrections.by_type.scope >= 1 && mm.corrections.by_type.design >= 1);
  const sess = mm.sessions.find((s) => s.record === SESSION_REF);
  check("three-firms instrumentation record #1 is real session data", !!sess && sess.decisions === decisions.length && (sess.corrections.confirm ?? 0) === 1, JSON.stringify(sess));

  // Export gate, legitimately.
  const ready = (await (await fetch(`${BASE}/api/projects/${projectId}/boq-pdf?format=json`)).json()) as { readiness: { ready: boolean } };
  check("the export gate passes: nothing untyped, undecided or needs_selection", ready.readiness.ready, JSON.stringify(ready.readiness));
  const { data: latest } = await db.from("boqs").select("sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).single<{ sections: { programme?: { total_days: number; phases: { name: string; days: number }[] } } }>();
  check("the BoQ carries the indicative programme", !!latest?.sections.programme, latest?.sections.programme ? `${latest.sections.programme.total_days} days: ${latest.sections.programme.phases.map((p) => `${p.name} ${p.days}`).join(" · ")}` : "");

  const { derivePlanGraph } = await import("../lib/plan/derive.ts");
  const { graphDraftStatus } = await import("../lib/plan/geometry.ts");
  const g = await derivePlanGraph(projectId);
  const draft = graphDraftStatus(g);
  check("the plan is still a DRAFT (the plot is not measured)", draft.draft === true, draft.derived.slice(0, 4).join("; "));

  const out = {
    project_id: projectId,
    applied_at: started,
    workbook: { sheetA: SESSION_MEASURES, sheetB: { shed: B.get(`D${shedRow}`) }, sheetC: cAnswers, sheetD: dRows },
    reconciliation: rec,
    stages: stages.map((s) => ({ label: s.label, boq_id: s.boq_id, grand_total_aed: s.grand_total_aed })),
    change_report: staged.map((s) => ({ cause: s.cause, boq: s.report.boq, moved: s.report.moved })),
    overall: { boq: overall.boq, top5: top },
    fixtures_rezoned: rezoned,
    events_tagged_session_apply: tagged,
    metrics: mm,
    draft,
    results,
  };
  mkdirSync(`${ROOT}/screenshots/garden-pilot`, { recursive: true });
  writeFileSync(`${ROOT}/screenshots/garden-pilot/g5d-session.json`, JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
