// =============================================================================
// scripts/garden-reference-pack.ts — the completed reference garden's pack, as a
// credibility asset for a client meeting (garden pilot G5).
//
// The reference project's working name records what it is to US (the priced
// ground truth); a client sees its display name (migration 038) instead, so this
// script sets that first and then proves nothing else leaks:
//   - no "ground truth" on any page of the render pack or drawing set, nor in the
//     PDF metadata;
//   - no house number, no contractor identity (INTERNAL_REF), no price;
//   - no draft watermark — it is a built garden, not a proposal.
// Every scene camera goes through the faithfulness gate, day + evening; the pack
// mix and gate table are reported. No BoQ PDF: the rates are a third party's
// negotiated prices and never leave the rate book.
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true OVERLAYS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-reference-pack.ts [port] [--no-render]
// Writes screenshots/garden-pilot/g5-reference-pack.json; the PDFs go to
// data/garden pilot/g5-draft-pack/ (gitignored) beside the client draft pack.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ROOT = "C:/dev/rennovaite";
const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d{2,5}$/.test(a)) ?? "3098";
const BASE = `http://localhost:${PORT}`;
const RENDER = !args.includes("--no-render");
const OUT_DIR = `${ROOT}/data/garden pilot/g5-draft-pack`;
const WORKING_NAME = "Villa 94 garden (ground truth)";
/** What a client reads: what the garden is, not whose house it is or what it is to us. */
const DISPLAY_NAME = "Contemporary Villa Garden — Completed Renovation";

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`;
  results.push(line);
  console.log(line);
};
async function getJson<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, init);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}
const send = (method: string, path: string, body: unknown) => getJson<Record<string, unknown>>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function main() {
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  mkdirSync(OUT_DIR, { recursive: true });
  const started = new Date().toISOString();
  const { INTERNAL_REF } = await import("@/lib/ground-truth/villa94-garden");
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const identityTokens = [String(INTERNAL_REF).split(/[^A-Za-z0-9]+/)[0]!, String(INTERNAL_REF)].filter((t) => t.length >= 3).map(esc);

  const { data: project } = await db.from("projects").select("id").eq("name", WORKING_NAME).single<{ id: string }>();
  const PROJECT = project!.id;

  // --- 1. the client-facing name ------------------------------------------------------
  const named = await send("PATCH", `/api/projects/${PROJECT}`, { display_name: DISPLAY_NAME });
  check("display name set through the project route", named.body.success === true, DISPLAY_NAME);

  // --- 2. renders ------------------------------------------------------------------------
  if (RENDER) {
    const cams = (await getJson<{ cameras: { id: string; label: string; lit: boolean }[]; error?: string }>(`/api/render/scene?project_id=${PROJECT}`)).body;
    if (!cams.cameras) throw new Error(`cameras: ${cams.error}`);
    const run = async (jobs: { id: string; view: "day" | "evening" }[]) => {
      const queue = [...jobs];
      await Promise.all(
        [0, 1, 2].map(async () => {
          for (let j = queue.shift(); j; j = queue.shift()) {
            const t0 = Date.now();
            const r = await send("POST", "/api/render/scene", { project_id: PROJECT, camera_id: j.id, view: j.view });
            console.log(`  ${j.view.padEnd(7)} ${j.id.slice(0, 44).padEnd(44)} ${r.body.outcome ?? `ERROR ${r.body.error}`}${r.body.cached ? " (cached)" : ""} ${Math.round((Date.now() - t0) / 1000)}s`);
          }
        }),
      );
    };
    await run(cams.cameras.map((c) => ({ id: c.id, view: "day" as const })));
    await run(cams.cameras.filter((c) => c.lit).map((c) => ({ id: c.id, view: "evening" as const })));
  }

  // --- 3. documents ----------------------------------------------------------------------
  const saveBinary = async (path: string, name: string) => {
    const res = await fetch(BASE + path);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.ok) writeFileSync(`${OUT_DIR}/${name}`, bytes);
    return { status: res.status, bytes: bytes.byteLength, latin1: Buffer.from(bytes).toString("latin1") };
  };
  const packPdf = await saveBinary(`/api/projects/${PROJECT}/render-pack`, "reference-garden-render-pack.pdf");
  const drawingsPdf = await saveBinary(`/api/projects/${PROJECT}/drawings?format=pdf&sheet=all`, "reference-garden-drawing-set.pdf");
  check("render pack and drawing set export as PDFs", [packPdf, drawingsPdf].every((d) => d.status === 200 && d.bytes > 10_000), JSON.stringify({ pack: packPdf.bytes, drawings: drawingsPdf.bytes }));

  // --- 4. what is printed ---------------------------------------------------------------
  const summary = (await getJson<{ gate: { label: string; view: string; outcome: string; attempts: { attempt: number; passed: boolean; failures: string[] }[] }[]; pages: unknown[]; missing_images: string[]; mix: Record<string, number> }>(`/api/projects/${PROJECT}/render-pack?format=json`)).body;
  const packPages = (await getJson<{ pages: string[] }>(`/api/projects/${PROJECT}/render-pack?format=pages`)).body.pages ?? [];
  const { generateDrawingSet } = await import("@/lib/drawings/export");
  const set = await generateDrawingSet(PROJECT);

  const printed = [
    ...set.sheets.map((s) => ["drawing " + s.sheetNumber, s.svg] as const),
    ...packPages.map((s, i) => [`pack page ${i + 1}`, s] as const),
    // PDF metadata (title) is uncompressed; page content is rasterised chrome.
    ["render pack PDF", packPdf.latin1] as const,
    ["drawing set PDF", drawingsPdf.latin1] as const,
  ];
  const find = (re: RegExp) => printed.filter(([, text]) => re.test(text)).map(([where]) => where);
  check("the display name is what the documents print", packPages[0]!.includes(DISPLAY_NAME.replace("—", "—")) && set.sheets[0]!.svg.includes("Contemporary Villa Garden"));
  const gt = find(/ground[\s-]*truth/i);
  check('no "ground truth" on any page or in the PDF metadata', gt.length === 0, gt.slice(0, 5).join("; ") || `${printed.length} documents`);
  const house = find(/villa\s*0*94\b/i);
  check("no house number on any page", house.length === 0, house.slice(0, 5).join("; "));
  const leaks = printed.flatMap(([where, text]) => identityTokens.filter((t) => new RegExp(t, "i").test(text)).map((t) => `${where}: ${t}`));
  check("zero contractor-identity leakage across drawings and pack", leaks.length === 0 && identityTokens.length > 0, leaks.slice(0, 5).join("; ") || `${identityTokens.length} identity tokens × ${printed.length} documents`);
  const draft = find(/data-draft="true"|data-draft-cover|DRAFT FOR REVIEW/);
  check("no draft watermark — a built garden, not a proposal", draft.length === 0, draft.slice(0, 5).join("; "));
  // On the page TEXT — attributes carry ids like "…4aed…" — and the currency case-sensitive.
  const textOf = (svg: string) => svg.replace(/<[^>]+>/g, " ");
  const price = packPages.map((s, i) => [i + 1, textOf(s)] as const).filter(([, t]) => /\bAED\b|\brates?\b/.test(t) || /\bprice/i.test(t)).map(([i]) => `pack page ${i}`);
  check("no price or rate in the render pack", price.length === 0, price.join("; "));
  check("no design-assumptions page (nothing proposed on a completed garden)", !packPages.some((s) => s.includes("Design assumptions")));

  // --- 5. gate table + mix --------------------------------------------------------------
  const gate = summary.gate;
  const scene = gate.filter((g) => g.view !== "photo_pair");
  console.log("\nFAITHFULNESS GATE");
  for (const g of gate) console.log(`  ${g.label.slice(0, 34).padEnd(34)} ${g.view.padEnd(10)} ${g.outcome.padEnd(12)} ${g.attempts.map((a) => `${a.attempt}:${a.passed ? "pass" : "fail"}`).join(" ")}`);
  console.log(`\nPACK MIX  ${JSON.stringify(summary.mix)}`);

  // Pilot events this script caused are a reference pack, not the pilot.
  const { data: evs } = await db.from("pilot_events").select("id, detail").eq("project_id", PROJECT).gte("recorded_at", started);
  for (const e of evs ?? []) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (!d.stage) await db.from("pilot_events").update({ detail: { ...d, stage: "reference_pack", source: "scripts/garden-reference-pack.ts" } }).eq("id", e.id);
  }

  const out = {
    project_id: PROJECT,
    display_name: DISPLAY_NAME,
    generated_at: new Date().toISOString(),
    drawings: set.sheets.map((s) => `${s.sheetNumber} ${s.title}`),
    pack: { pages: summary.pages, missing_images: summary.missing_images },
    gate,
    mix: summary.mix,
    gate_summary: {
      scene_views: scene.length,
      passed: scene.filter((g) => g.outcome === "passed").length,
      substituted_by_3d_view: scene.filter((g) => g.outcome === "substituted").length,
      missing: scene.filter((g) => g.outcome === "missing").length,
    },
    pilot_events_tagged: (evs ?? []).length,
    results,
  };
  mkdirSync(`${ROOT}/screenshots/garden-pilot`, { recursive: true });
  writeFileSync(`${ROOT}/screenshots/garden-pilot/g5-reference-pack.json`, JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
