// =============================================================================
// scripts/garden-draft-pack.ts — Step 3/4 of the client garden (garden pilot G5):
// generate the full DRAFT pack through the real routes and verify it.
//
//   1. readiness — no untyped counter, no undecided existing item (else exit 2);
//   2. BoQ regenerated (records "first full BoQ" when it is the first);
//   3. every scene camera rendered through the faithfulness gate, day + evening;
//   4. 2–3 before/after photo pairs from client photos that cover a zone;
//   5. drawing set PDF, render pack PDF, BoQ PDF — saved locally;
//   6. assertions on exactly what is printed: the draft statement on every cover
//      and BoQ header, the derived total convention, needs_selection empty,
//      elevations and both overlays present, zero contractor-identity leakage;
//   7. the faithfulness-gate table, the pilot metrics, and a quantity baseline
//      for the Step 5 change report.
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true OVERLAYS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-draft-pack.ts <project-id> [port]
//        [--no-render] [--pairs N] [--out-dir <dir>]
// Writes screenshots/garden-pilot/g5-draft-pack.json + g5-draft-baseline.json; the
// PDFs (client photos inside) go to data/garden pilot/g5-draft-pack/ (gitignored).
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ROOT = "C:/dev/rennovaite";
const args = process.argv.slice(2);
const PROJECT_ARG = args.find((a) => /^[0-9a-f-]{36}$/.test(a));
if (!PROJECT_ARG) {
  console.error("usage: garden-draft-pack.ts <project-id> [port] [--no-render] [--pairs N] [--out-dir dir]");
  process.exit(1);
}
const PROJECT: string = PROJECT_ARG;
const PORT = args.find((a) => /^\d{2,5}$/.test(a)) ?? "3098";
const BASE = `http://localhost:${PORT}`;
const RENDER = !args.includes("--no-render");
const PAIRS = Number(args[args.indexOf("--pairs") + 1] ?? 3) || 3;
// The PDFs carry the client's photos, so they go under data/ (gitignored), never
// into the tracked screenshots folder.
const OUT_DIR = args.includes("--out-dir") ? args[args.indexOf("--out-dir") + 1]! : `${ROOT}/data/garden pilot/g5-draft-pack`;

const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`;
  results.push(line);
  console.log(line);
};

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

async function getJson<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, init);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}
const post = (path: string, body: unknown) => getJson<Record<string, unknown>>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function main() {
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  mkdirSync(OUT_DIR, { recursive: true });
  const started = new Date().toISOString();
  const { INTERNAL_REF, PUBLIC_SOURCE_LABEL } = await import("@/lib/ground-truth/villa94-garden");
  const { DRAFT_STATEMENT } = await import("@/lib/plan/site-reference");
  const { PHOTO_COVERAGE, RUNS, TREES, ZONES } = await import("@/lib/client-garden/arabella-reference");
  // The contractor's identity as the ground-truth module holds it: the trading
  // name (its first word) and the full internal reference, case-insensitive. The
  // name itself is never written into this script.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const identityTokens = [String(INTERNAL_REF).split(/[^A-Za-z0-9]+/)[0]!, String(INTERNAL_REF)].filter((t) => t.length >= 3).map(esc);

  // --- 1. readiness --------------------------------------------------------------------
  const ready = await getJson<{ readiness?: { ready: boolean; untyped_counters: string[]; undecided: string[] } }>(`/api/projects/${PROJECT}/boq-pdf?format=json`);
  const gen0 = await post("/api/generate-boq", { project_id: PROJECT });
  check("BoQ generates", !gen0.body.error, String(gen0.body.error ?? `AED ${gen0.body.grand_total_aed}`));
  const readiness = (await getJson<{ readiness: { ready: boolean; untyped_counters: string[]; undecided: string[]; stale_boq_needs_selection: string[] } }>(`/api/projects/${PROJECT}/boq-pdf?format=json`)).body.readiness;
  check("pack readiness: no untyped counter, nothing undecided, needs_selection empty", readiness?.ready === true, JSON.stringify({ untyped: readiness?.untyped_counters, undecided: readiness?.undecided?.length, stale: readiness?.stale_boq_needs_selection }));
  if (!readiness?.ready) {
    console.log(`\nNot ready — the design session has open decisions. (${JSON.stringify(ready.body.readiness ?? {})})`);
    writeFileSync(`${ROOT}/screenshots/garden-pilot/g5-draft-pack.json`, JSON.stringify({ project_id: PROJECT, ready: false, readiness, results }, null, 2));
    process.exit(2);
  }

  // --- 2. BoQ --------------------------------------------------------------------------
  const { data: boqRow } = await db.from("boqs").select("id, sections").eq("project_id", PROJECT).order("created_at", { ascending: false }).limit(1).single<{ id: string; sections: { grand_total_aed: number; sections: { work_section: string; lines: Record<string, unknown>[] }[]; garden?: { draft: { draft: boolean; derived: string[]; statement: string | null }; derived_lines: number; needs_selection: string[]; undecided: unknown[] } } }>();
  const boq = boqRow!.sections;
  const lines = boq.sections.flatMap((s) => s.lines);
  check("needs_selection is empty on the BoQ", lines.every((l) => l.rate_status !== "needs_selection") && (boq.garden?.needs_selection.length ?? 0) === 0);
  check("the BoQ knows it is a draft", boq.garden?.draft.draft === true && boq.garden.draft.statement === DRAFT_STATEMENT);
  const derivedLines = lines.filter((l) => l.qty_derived === true);
  check("boundary-dependent quantities carry the derived flag", derivedLines.length > 0 && derivedLines.every((l) => String(l.notes ?? "").length > 0), `${derivedLines.length} derived lines`);
  const priced = lines.filter((l) => l.rate_status !== "needs_qs" && Number(l.rate_aed) > 0);
  check("every priced landscape line carries the market-reference source label", priced.every((l) => l.vendor_or_source === PUBLIC_SOURCE_LABEL), `${priced.length} priced lines`);

  // --- 3. renders ------------------------------------------------------------------------
  if (RENDER) {
    const cams = (await getJson<{ cameras: { id: string; label: string; lit: boolean }[]; error?: string }>(`/api/render/scene?project_id=${PROJECT}`)).body;
    if (!cams.cameras) throw new Error(`cameras: ${cams.error}`);
    const run = async (jobs: { id: string; view: "day" | "evening" }[]) => {
      const queue = [...jobs];
      await Promise.all(
        [0, 1, 2].map(async () => {
          for (let j = queue.shift(); j; j = queue.shift()) {
            const t0 = Date.now();
            const r = await post("/api/render/scene", { project_id: PROJECT, camera_id: j.id, view: j.view });
            console.log(`  ${j.view.padEnd(7)} ${j.id.slice(0, 44).padEnd(44)} ${r.body.outcome ?? `ERROR ${r.body.error}`}${r.body.cached ? " (cached)" : ""} ${Math.round((Date.now() - t0) / 1000)}s`);
          }
        }),
      );
    };
    await run(cams.cameras.map((c) => ({ id: c.id, view: "day" as const })));
    await run(cams.cameras.filter((c) => c.lit).map((c) => ({ id: c.id, view: "evening" as const })));
  }

  // --- 4. photo pairs --------------------------------------------------------------------
  const { data: plan } = await db.from("plans").select("id").eq("project_id", PROJECT).order("created_at", { ascending: false }).limit(1).single<{ id: string }>();
  const { data: rooms } = await db.from("rooms").select("id, name_en, spec").eq("plan_id", plan!.id);
  const { data: els } = await db.from("plan_elements").select("id, spec").eq("plan_id", plan!.id);
  const { data: fx } = await db.from("plan_fixtures").select("id, spec, type").eq("project_id", PROJECT);
  const { data: assets } = await db.from("project_assets").select("id, filename").eq("project_id", PROJECT).eq("kind", "photo");
  const idForKey = (key: string): string | null => {
    const z = ZONES.find((x) => x.key === key);
    // A designed zone keeps its reference key in spec.ref_key when it is renamed.
    if (z) return (rooms ?? []).find((r) => (r.spec as { ref_key?: string } | null)?.ref_key === key)?.id ?? (rooms ?? []).find((r) => r.name_en === z.name)?.id ?? null;
    const r = RUNS.find((x) => x.key === key);
    if (r) return (els ?? []).find((e) => (e.spec as { name?: string } | null)?.name === r.name)?.id ?? null;
    const t = TREES.find((x) => x.key === key);
    if (t) return (fx ?? []).find((f) => (f.spec as { name?: string } | null)?.name === t.name)?.id ?? null;
    return null;
  };
  const pairResults: { file: string; zone: string; outcome: string; attempts: unknown }[] = [];
  if (RENDER) {
    // One pair per zone, so the pack shows different parts of the garden; when a
    // zone's photo is withheld by the gate, its next photo gets one try.
    const zones = [...new Set(PHOTO_COVERAGE.map((c) => c.zone))].slice(0, PAIRS);
    const passedZones = new Set<string>();
    const triedPerZone = new Map<string, number>();
    const queue = zones.flatMap((z) => PHOTO_COVERAGE.filter((c) => c.zone === z).slice(0, 2));
    for (const c of queue) {
      if (passedZones.has(c.zone) || (triedPerZone.get(c.zone) ?? 0) >= 2) continue;
      triedPerZone.set(c.zone, (triedPerZone.get(c.zone) ?? 0) + 1);
      const zoneId = idForKey(c.zone);
      const asset = (assets ?? []).find((a) => a.filename === c.file);
      if (!zoneId || !asset) {
        pairResults.push({ file: c.file, zone: c.zone, outcome: "skipped — zone or photo not found (the design renamed or removed it)", attempts: [] });
        continue;
      }
      const itemIds = c.shows.map(idForKey).filter((x): x is string => !!x);
      const t0 = Date.now();
      const r = await post("/api/render/photo-pair", { project_id: PROJECT, asset_id: asset.id, zone_id: zoneId, item_ids: itemIds });
      console.log(`  pair    ${c.file.padEnd(28)} ${String(r.body.outcome ?? `ERROR ${r.body.error}`)} ${Math.round((Date.now() - t0) / 1000)}s`);
      pairResults.push({ file: c.file, zone: c.zone, outcome: String(r.body.outcome ?? `error: ${r.body.error}`), attempts: r.body.attempts ?? [] });
      if (r.body.outcome === "passed") passedZones.add(c.zone);
    }
  }

  // --- 5. documents --------------------------------------------------------------------
  const saveBinary = async (path: string, name: string) => {
    const res = await fetch(BASE + path);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.ok) writeFileSync(`${OUT_DIR}/${name}`, bytes);
    return { status: res.status, bytes: bytes.byteLength };
  };
  const drawingsPdf = await saveBinary(`/api/projects/${PROJECT}/drawings?format=pdf&sheet=all`, "arabella-drawing-set.pdf");
  const packPdf = await saveBinary(`/api/projects/${PROJECT}/render-pack`, "arabella-render-pack.pdf");
  const boqPdf = await saveBinary(`/api/projects/${PROJECT}/boq-pdf`, "arabella-boq.pdf");
  check("drawing set, render pack and BoQ export as PDFs", [drawingsPdf, packPdf, boqPdf].every((d) => d.status === 200 && d.bytes > 10_000), JSON.stringify({ drawingsPdf, packPdf, boqPdf }));

  // --- 6. assertions on what is printed ------------------------------------------------
  const { generateDrawingSet } = await import("@/lib/drawings/export");
  const { buildBoqPdfPages } = await import("@/lib/documents/boq-pdf");
  const { derivedTotal, boqDerivedInfo } = await import("@/lib/documents/boq-derived");
  const set = await generateDrawingSet(PROJECT);
  // The pack page SVGs come from the route (pdf-lib does not load under the
  // script alias hook); the summary is the JSON manifest.
  const packSummary = (await getJson<{ gate: { label: string; view: string; outcome: string; attempts: { attempt: number; passed: boolean; failures: string[] }[] }[]; pages: unknown[]; missing_images: string[]; mix: Record<string, number> }>(`/api/projects/${PROJECT}/render-pack?format=json`)).body;
  const pack = { pageSvgs: (await getJson<{ pages: string[] }>(`/api/projects/${PROJECT}/render-pack?format=pages`)).body.pages ?? [], summary: packSummary };
  const { data: proj } = await db.from("projects").select("name, city").eq("id", PROJECT).single<{ name: string; city: string }>();
  const boqPages = buildBoqPdfPages({ projectName: proj!.name, community: proj!.city, dateISO: "check", boq: boq as never });

  const kinds = set.sheets.map((s) => s.kind);
  check("drawings: cover, site plan, a sheet per zone, finish schedule", kinds[0] === "cover" && kinds.includes("site_plan") && kinds.filter((k) => k === "zone_plan").length > 0 && kinds.includes("finish_schedule"), set.sheets.map((s) => s.sheetNumber).join(" "));
  check("drawings: sectional elevations for the designed structures", kinds.filter((k) => k === "structure_elevation").length > 0, `${kinds.filter((k) => k === "structure_elevation").length} elevation sheets`);
  check("drawings: electrical + irrigation/drainage overlays", kinds.includes("lighting_overlay") && kinds.includes("irrigation_overlay"));
  const stmt = `data-draft-statement="${DRAFT_STATEMENT}"`;
  check("watermark: every drawing sheet carries the draft stamp with the statement", set.sheets.every((s) => s.svg.includes('data-draft="true"') && s.svg.includes(stmt)), `${set.sheets.length} sheets`);
  check("watermark: the drawing-set cover carries the statement", set.sheets[0]!.svg.includes("data-draft-cover") && set.sheets[0]!.svg.includes(stmt));
  check("watermark: the render-pack cover carries the statement", pack.pageSvgs[0]!.includes("data-draft-cover") && pack.pageSvgs[0]!.includes(stmt));
  check("the pack carries the Design assumptions page", pack.pageSvgs.some((s) => s.includes("Design assumptions") && s.includes("PROPOSAL")));
  check("watermark: every BoQ PDF page header carries the statement", boqPages.every((p) => p.includes("data-boq-draft") && p.includes("DRAFT FOR REVIEW — quantities derived from reference layout; firm after site verification.")), `${boqPages.length} pages`);
  const total = derivedTotal(boq.grand_total_aed, boqDerivedInfo(boq as never));
  check("the BoQ total renders with the derived convention, never a bare number", total.derived && total.text.startsWith("≈ AED") && total.text.endsWith("*") && boqPages[0]!.includes(total.text.replace("≈", "≈")), total.text);
  const boqHtml = await (await fetch(`${BASE}/project/${PROJECT}/boq`)).text();
  check("BoQ page: draft header, derived total and derived line flags visible", boqHtml.includes("data-boq-draft") && boqHtml.includes("data-derived-total") && boqHtml.includes("data-derived-line"));
  const planHtml = await (await fetch(`${BASE}/project/${PROJECT}/plan`)).text();
  check("plan page: the draft banner and derived markers are visible", planHtml.includes("Draft for review") && planHtml.includes("≈"));

  const printed = [
    ...set.sheets.map((s) => ["drawing " + s.sheetNumber, s.svg] as const),
    ...pack.pageSvgs.map((s, i) => [`pack page ${i + 1}`, s] as const),
    ...boqPages.map((s, i) => [`BoQ page ${i + 1}`, s] as const),
    ["BoQ json", JSON.stringify(boq)] as const,
    ["BoQ page html", boqHtml] as const,
  ];
  const leaks = printed.flatMap(([where, text]) => identityTokens.filter((t) => new RegExp(t, "i").test(text)).map((t) => `${where}: ${t}`));
  check("zero contractor-identity leakage across drawings, pack, BoQ PDF, BoQ data and BoQ page", leaks.length === 0 && identityTokens.length > 0, leaks.slice(0, 5).join("; ") || `${identityTokens.length} identity tokens × ${printed.length} documents`);

  // Sales and commercial language is internal: a seeded decision note once printed
  // "the upsell conversation" on the client's assumptions page.
  const internal = printed.filter(([where]) => !where.startsWith("BoQ json")).flatMap(([where, text]) => (/\b(upsell|up-sell|margin|mark-?up|commission)\b/i.test(text.replace(/<[^>]+>/g, " ")) ? [where] : []));
  check("no internal sales or commercial language on any client-facing page", internal.length === 0, internal.slice(0, 5).join("; "));

  // --- 7. gate table, metrics, baseline ----------------------------------------------
  const gate = pack.summary.gate;
  const scene = gate.filter((g) => g.view !== "photo_pair");
  console.log("\nFAITHFULNESS GATE");
  for (const g of gate) console.log(`  ${g.label.slice(0, 34).padEnd(34)} ${g.view.padEnd(10)} ${g.outcome.padEnd(12)} ${g.attempts.map((a) => `${a.attempt}:${a.passed ? "pass" : "fail"}`).join(" ")}`);
  console.log(`\nPACK MIX  ${JSON.stringify(pack.summary.mix)}`);
  // The decision table (what the review meeting works through) and the BoQ's biggest lines.
  const { derivePlanGraph } = await import("@/lib/plan/derive");
  const { designDecisions, layoutAssumptions } = await import("@/lib/documents/design-assumptions");
  const g = await derivePlanGraph(PROJECT);
  const { data: fxAll } = await db.from("plan_fixtures").select("id, layer, type, room_id, position, spec, site_reference, disposition").eq("project_id", PROJECT);
  const decisions = designDecisions(g, (fxAll ?? []) as never);
  console.log("\nDECISIONS");
  for (const d of decisions) console.log(`  ${d.decision.padEnd(9)} ${d.item.slice(0, 52).padEnd(52)} ${d.becomes ?? ""}`);
  const top5 = lines
    .map((l, i) => ({ l, section: boq.sections.find((s) => s.lines.includes(l))?.work_section ?? "", i }))
    .sort((a, b) => Number(b.l.total_aed) - Number(a.l.total_aed))
    .slice(0, 5)
    .map(({ l, section }) => ({ section, description: String(l.description), quantity: Number(l.quantity), unit: String(l.unit), rate_aed: Number(l.rate_aed), total_aed: Number(l.total_aed), qty_derived: l.qty_derived === true, rate_status: l.rate_status }));
  console.log("\nTOP 5 BoQ LINES");
  for (const t of top5) console.log(`  AED ${String(Math.round(t.total_aed)).padStart(7)}  ${t.quantity} ${t.unit} × ${t.rate_aed}  ${t.description}`);
  // The BoQ generation and exports this run caused are script-generated, not the designer.
  const { data: runEvents } = await db.from("pilot_events").select("id, detail").eq("project_id", PROJECT).gte("recorded_at", started);
  for (const e of runEvents ?? []) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (!d.stage) await db.from("pilot_events").update({ detail: { ...d, stage: "draft_pack", source: "scripts/garden-draft-pack.ts" } }).eq("id", e.id);
  }
  const metrics = (await getJson<{ metrics: unknown }>(`/api/pilot-events?project_id=${PROJECT}`)).body.metrics;

  const { snapshotOf } = await import("@/lib/pilot/change-report");
  const { data: takeoff } = await db.from("takeoff_items").select("work_item_key, element_id, qty, unit").eq("project_id", PROJECT).like("work_item_key", "garden.%");
  const baseline = snapshotOf({ capturedAt: new Date().toISOString(), boqId: boqRow!.id, boq: boq as never, takeoff: takeoff ?? [], draft: { draft: boq.garden?.draft.draft ?? false, derived: boq.garden?.draft.derived ?? [] } });
  writeFileSync(`${ROOT}/screenshots/garden-pilot/g5-draft-baseline.json`, JSON.stringify(baseline, null, 2));

  const out = {
    project_id: PROJECT,
    generated_at: new Date().toISOString(),
    boq: { id: boqRow!.id, grand_total_aed: boq.grand_total_aed, printed_total: total.text, derived_lines: derivedLines.length, lines: lines.length, top5 },
    decisions,
    layout_assumptions: layoutAssumptions(g),
    drawings: set.sheets.map((s) => `${s.sheetNumber} ${s.title}`),
    pack: { pages: pack.summary.pages, missing_images: pack.summary.missing_images },
    gate,
    // The pack's make-up: before/after pairs and 3D design views are the backbone;
    // styled renders are in where the gate passed.
    mix: pack.summary.mix,
    gate_summary: {
      scene_views: scene.length,
      passed: scene.filter((g) => g.outcome === "passed").length,
      substituted_by_3d_view: scene.filter((g) => g.outcome === "substituted").length,
      missing: scene.filter((g) => g.outcome === "missing").length,
      photo_pairs: pairResults,
    },
    metrics,
    results,
  };
  writeFileSync(`${ROOT}/screenshots/garden-pilot/g5-draft-pack.json`, JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
