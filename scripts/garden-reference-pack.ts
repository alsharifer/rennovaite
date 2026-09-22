// =============================================================================
// scripts/garden-reference-pack.ts — the completed reference garden's pack, as a
// credibility asset for a client meeting (garden pilot G5).
//
// The reference project's working name records what it is to US (the priced
// ground truth); a client sees its display name (migration 038) instead, so this
// script sets that first. Since T5 the pack itself comes from the shared gated
// export (lib/documents/pack-export/run.ts) — every standard gate and printed
// check — plus the reference pack's own checks, which gate the release too:
//   - no "ground truth" on any page of the render pack or drawing set, nor in the
//     PDF metadata;
//   - no house number, no price in the pack;
//   - no draft watermark — it is a built garden, not a proposal;
//   - no design-assumptions page (nothing is proposed).
// No BoQ PDF (`boqPdf: false`): the rates are a third party's negotiated prices
// and never leave the rate book.
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true
// OVERLAYS_ENABLED=true PACK_EXPORT_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-reference-pack.ts [port] [--no-render | --cached]
// Writes screenshots/garden-pilot/g5-reference-pack.json; the PDFs go to
// data/garden pilot/g5-draft-pack/ (gitignored) beside the client draft pack.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createPackJob, finishPackJob } from "../lib/documents/pack-export/job.ts";
import { runPackExport } from "../lib/documents/pack-export/run.ts";
import { httpTransport } from "../lib/documents/pack-export/transport.ts";
import { DEFAULT_PACK_OPTIONS, type PackCheck, type PackExportOptions } from "../lib/documents/pack-export/types.ts";

const ROOT = "C:/dev/rennovaite";
const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d{2,5}$/.test(a)) ?? "3098";
const BASE = `http://localhost:${PORT}`;
const OUT_DIR = `${ROOT}/data/garden pilot/g5-draft-pack`;
const WORKING_NAME = "Villa 94 garden (ground truth)";
/** What a client reads: what the garden is, not whose house it is or what it is to us. */
const DISPLAY_NAME = "Contemporary Villa Garden — Completed Renovation";

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

const options: PackExportOptions = {
  ...DEFAULT_PACK_OPTIONS,
  renders: args.includes("--no-render") ? "skip" : args.includes("--cached") ? "cached" : "full",
  pairs: 0,
  regenerateBoq: false,
  boqPdf: false,
  // Pilot events this script causes are a reference pack, not the pilot.
  stage: "reference_pack",
};

/** The reference pack's own client-safety rules, on top of the standard checks. */
function referenceChecks(p: { sheets: { sheetNumber: string; svg: string }[]; packPages: string[]; pdfs: { name: string; bytes: Uint8Array }[] }): PackCheck[] {
  const out: PackCheck[] = [];
  const check = (label: string, ok: boolean, detail = "") => out.push({ label, ok, detail });
  const printed = [
    ...p.sheets.map((s) => ["drawing " + s.sheetNumber, s.svg] as const),
    ...p.packPages.map((s, i) => [`pack page ${i + 1}`, s] as const),
    // PDF metadata (title) is uncompressed; page content is rasterised chrome.
    ...p.pdfs.map((d) => [d.name, Buffer.from(d.bytes).toString("latin1")] as const),
  ];
  const find = (re: RegExp) => printed.filter(([, text]) => re.test(text)).map(([where]) => where);
  check("the display name is what the documents print", !!p.packPages[0]?.includes(DISPLAY_NAME) && !!p.sheets[0]?.svg.includes("Contemporary Villa Garden"));
  const gt = find(/ground[\s-]*truth/i);
  check('no "ground truth" on any page or in the PDF metadata', gt.length === 0, gt.slice(0, 5).join("; ") || `${printed.length} documents`);
  const house = find(/villa\s*0*94\b/i);
  check("no house number on any page", house.length === 0, house.slice(0, 5).join("; "));
  const draft = find(/data-draft="true"|data-draft-cover|DRAFT FOR REVIEW/);
  check("no draft watermark — a built garden, not a proposal", draft.length === 0, draft.slice(0, 5).join("; "));
  // On the page TEXT — attributes carry ids like "…4aed…" — and the currency case-sensitive.
  const textOf = (svg: string) => svg.replace(/<[^>]+>/g, " ");
  const price = p.packPages.map((s, i) => [i + 1, textOf(s)] as const).filter(([, t]) => /\bAED\b|\brates?\b/.test(t) || /\bprice/i.test(t)).map(([i]) => `pack page ${i}`);
  check("no price or rate in the render pack", price.length === 0, price.join("; "));
  check("no design-assumptions page (nothing proposed on a completed garden)", !p.packPages.some((s) => s.includes("Design assumptions")));
  return out;
}

async function main() {
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: project } = await db.from("projects").select("id").eq("name", WORKING_NAME).single<{ id: string }>();
  const PROJECT = project!.id;

  // The client-facing name, through the project route (the export gate checks it).
  const named = await fetch(`${BASE}/api/projects/${PROJECT}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_name: DISPLAY_NAME }) });
  if (!named.ok) throw new Error(`display name could not be set: HTTP ${named.status}`);

  const job = await createPackJob(db, PROJECT, "cli", options);
  let result: Awaited<ReturnType<typeof runPackExport>>;
  try {
    result = await runPackExport({
      projectId: PROJECT,
      db,
      transport: httpTransport(BASE, job.id),
      sink: {
        async write(name, bytes) {
          mkdirSync(OUT_DIR, { recursive: true });
          // Keep the reference pack's files apart from the client pack's manifest.
          const file = name === "pack-manifest.json" ? "reference-pack-manifest.json" : name;
          writeFileSync(`${OUT_DIR}/${file}`, bytes);
          return { path: `${OUT_DIR}/${file}` };
        },
      },
      options,
      source: "cli",
      onProgress: (p) => console.log(`[${String(p.pct).padStart(3)}%] ${p.step} — ${p.note}`),
      extraChecks: referenceChecks,
    });
    await finishPackJob(db, job.id, result, null);
  } catch (e) {
    await finishPackJob(db, job.id, null, e instanceof Error ? e.message : String(e));
    throw e;
  }

  if (result.status === "blocked") {
    console.log("\nEXPORT BLOCKED:");
    for (const c of result.checklist.filter((x) => !x.ok)) console.log(`  ✗ ${c.title} — ${c.detail}${c.items.length ? `: ${c.items.slice(0, 6).join(", ")}` : ""}`);
  }
  for (const c of result.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.label}${c.detail ? " — " + c.detail : ""}`);
  mkdirSync(`${ROOT}/screenshots/garden-pilot`, { recursive: true });
  writeFileSync(`${ROOT}/screenshots/garden-pilot/g5-reference-pack.json`, JSON.stringify({ job_id: job.id, display_name: DISPLAY_NAME, ...result.manifest }, null, 2));
  const failed = result.checks.filter((c) => !c.ok).length;
  console.log(`\n${result.status.toUpperCase()} — ${result.checks.length - failed}/${result.checks.length} checks passed`);
  process.exit(result.status === "passed" ? 0 : result.status === "blocked" ? 2 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
