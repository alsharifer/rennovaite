// =============================================================================
// scripts/garden-draft-pack.ts — the pack export from the command line.
//
// Since T5 this is a thin wrapper: the assembly and every gate live in
// lib/documents/pack-export/run.ts, which the in-app "Export pack" action runs
// too. The two differ only in where the routes are (this script: a dev server)
// and where the documents land (this script: a local folder). The sequence:
//
//   1. BoQ regenerated (records "first full BoQ" when it is the first);
//   2. the export gate — readiness, scope-aware parity, a client-facing name —
//      exit 2 with the checklist printed when anything is open;
//   3. gardens: every camera through the faithfulness + consistency gates;
//   4. gardens: before/after photo pairs, one per zone;
//   5. drawing set, render pack (gardens) and BoQ PDF through the gated routes;
//   6. printed-content checks incl. the identity-leak scan — exit 1 and nothing
//      is written but the manifest when any fails;
//   7. the manifest (checks, gate table, parity, consistency, metrics, the
//      Step-5 quantity baseline) saved WITH the documents.
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true
// OVERLAYS_ENABLED=true PACK_EXPORT_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-draft-pack.ts <project-id> [port]
//        [--no-render | --cached] [--no-regen] [--pairs N] [--out-dir <dir>] [--stage <stage>]
// Writes screenshots/garden-pilot/g5-draft-pack.json + g5-draft-baseline.json for a
// garden; the PDFs (client photos inside) go to data/garden pilot/g5-draft-pack/
// (gitignored) unless --out-dir says otherwise.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { parityTableText, type ParityResult } from "../lib/documents/parity.ts";
import { createPackJob, finishPackJob } from "../lib/documents/pack-export/job.ts";
import { runPackExport } from "../lib/documents/pack-export/run.ts";
import { httpTransport } from "../lib/documents/pack-export/transport.ts";
import { DEFAULT_PACK_OPTIONS, type PackExportOptions, type PackSink } from "../lib/documents/pack-export/types.ts";

const ROOT = "C:/dev/rennovaite";
const args = process.argv.slice(2);
const PROJECT_ARG = args.find((a) => /^[0-9a-f-]{36}$/.test(a));
if (!PROJECT_ARG) {
  console.error("usage: garden-draft-pack.ts <project-id> [port] [--no-render | --cached] [--no-regen] [--pairs N] [--out-dir dir] [--stage s]");
  process.exit(1);
}
const PROJECT: string = PROJECT_ARG;
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const PORT = args.find((a) => /^\d{2,5}$/.test(a)) ?? "3098";
const OUT_DIR = flag("--out-dir") ?? `${ROOT}/data/garden pilot/g5-draft-pack`;

const options: PackExportOptions = {
  ...DEFAULT_PACK_OPTIONS,
  renders: args.includes("--no-render") ? "skip" : args.includes("--cached") ? "cached" : "full",
  pairs: flag("--pairs") !== undefined ? Math.max(0, Number(flag("--pairs")) || 0) : DEFAULT_PACK_OPTIONS.pairs,
  regenerateBoq: !args.includes("--no-regen"),
  // What this run causes is the script's, not the designer's.
  stage: flag("--stage") ?? "draft_pack",
};

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

const localSink = (dir: string): PackSink => ({
  async write(name, bytes) {
    mkdirSync(dir, { recursive: true });
    const path = `${dir}/${name}`;
    writeFileSync(path, bytes);
    return { path };
  },
});

async function main() {
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const job = await createPackJob(db, PROJECT, "cli", options);
  let result: Awaited<ReturnType<typeof runPackExport>>;
  try {
    result = await runPackExport({
      projectId: PROJECT,
      db,
      transport: httpTransport(`http://localhost:${PORT}`, job.id),
      sink: localSink(OUT_DIR),
      options,
      source: "cli",
      onProgress: (p) => console.log(`[${String(p.pct).padStart(3)}%] ${p.step} — ${p.note}`),
      log: (line) => {
        if (!line.startsWith("[")) console.log(line);
      },
    });
    await finishPackJob(db, job.id, result, null);
  } catch (e) {
    await finishPackJob(db, job.id, null, e instanceof Error ? e.message : String(e));
    throw e;
  }

  const m = result.manifest;
  if (result.status === "blocked") {
    console.log("\nEXPORT BLOCKED — resolve these first:");
    for (const c of result.checklist.filter((x) => !x.ok)) {
      console.log(`  ✗ ${c.title}\n    ${c.detail}`);
      for (const it of c.items.slice(0, 12)) console.log(`      · ${it}`);
      if (c.fix) console.log(`    fix: ${c.fix.label} → ${c.fix.href}`);
    }
  }
  for (const c of result.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.label}${c.detail ? " — " + c.detail : ""}`);

  const gate = (m.gate ?? []) as { label: string; view: string; outcome: string; reason?: string | null; consistency?: { passed: boolean; anchor: boolean } | null; attempts: { attempt: number; passed: boolean }[] }[];
  if (gate.length) {
    console.log("\nFAITHFULNESS GATE");
    for (const g of gate) console.log(`  ${g.label.slice(0, 34).padEnd(34)} ${g.view.padEnd(10)} ${g.outcome.padEnd(12)} ${(g.reason ?? "").padEnd(16)} ${g.consistency ? (g.consistency.anchor ? "anchor" : g.consistency.passed ? "consistent" : "INCONSISTENT") : ""} ${g.attempts.map((a) => `${a.attempt}:${a.passed ? "pass" : "fail"}`).join(" ")}`);
    console.log(`\nPACK MIX  ${JSON.stringify(m.mix)}`);
  }
  if (m.parity) console.log(`\n${parityTableText(m.parity as ParityResult)}`);
  for (const o of result.outputs) console.log(`  wrote ${o.name.padEnd(36)} ${String(o.bytes).padStart(9)} B  sha256 ${o.sha256.slice(0, 16)}`);

  // The pilot's tracked records (gardens): the run report and the Step-5 baseline.
  // A verification run (--stage verification) never overwrites them.
  if (result.scope !== "interior" && options.stage !== "verification") {
    writeFileSync(`${ROOT}/screenshots/garden-pilot/g5-draft-pack.json`, JSON.stringify({ job_id: job.id, ...m }, null, 2));
    if (m.baseline) writeFileSync(`${ROOT}/screenshots/garden-pilot/g5-draft-baseline.json`, JSON.stringify(m.baseline, null, 2));
  }
  const failed = result.checks.filter((c) => !c.ok).length;
  console.log(`\n${result.status.toUpperCase()} — ${result.checks.length - failed}/${result.checks.length} checks passed (job ${job.id})`);
  process.exit(result.status === "blocked" ? 2 : result.status === "failed" ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
