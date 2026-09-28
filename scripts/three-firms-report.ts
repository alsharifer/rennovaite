#!/usr/bin/env node
// =============================================================================
// scripts/three-firms-report.ts — the three-firms evidence table (L5).
//
//   node --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/three-firms-report.ts [--json] [--firm <id>]
//
// Per firm, per project: time to first BoQ, time to first FULL BoQ, checking
// time (first generation → first release), BoQ generations, corrections by type
// and where they landed (book / project), by section, support touches, reviews,
// approvals / acceptances — and the GAPS, printed beside the numbers. Read-only.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { loadFirmEvidence } from "../lib/pilot/load.ts";
import type { ProjectMetrics } from "../lib/pilot/metrics.ts";
import { resolveTarget } from "./_target-guard.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const firmArg = args.includes("--firm") ? args[args.indexOf("--firm") + 1] : undefined;

const { url, key } = resolveTarget({ script: "three-firms-report", writes: false });
const sb = createClient(url, key);
const evidence = await loadFirmEvidence(sb, firmArg ? [firmArg] : undefined);

if (json) {
  console.log(JSON.stringify(evidence, null, 2));
  process.exit(0);
}

const min = (n: number | null) => (n == null ? "—" : n >= 1440 ? `${(n / 1440).toFixed(1)} d` : n >= 60 ? `${(n / 60).toFixed(1)} h` : `${n} min`);
const types = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ") || "—";
const cell = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + "…" : s).padEnd(w);
const H = ["project", "scope", "→1st BoQ", "→1st FULL", "checking", "gens", "corrections (type)", "landed", "support", "reviews", "appr/acc"];
const W = [30, 8, 10, 10, 10, 5, 34, 10, 8, 8, 9];
const row = (p: ProjectMetrics) =>
  [
    p.name,
    p.scope,
    min(p.time_to_first_boq_min),
    min(p.time_to_first_full_boq_min),
    min(p.checking_min),
    String(p.boq_generations),
    `${p.corrections.total}: ${types(p.corrections.by_type)}`,
    `book ${p.corrections.landed.book} / proj ${p.corrections.landed.project}`,
    `${p.support.touches}${p.support.unresolved ? ` (${p.support.unresolved} open)` : ""}`,
    `${p.reviews.views} / ${p.reviews.distinct_actors}`,
    `${p.approvals} / ${p.acceptances}`,
  ]
    .map((c, i) => cell(c, W[i]!))
    .join("  ");

console.log(`\nTHREE-FIRMS EVIDENCE — ${evidence.generated_at.slice(0, 16)}Z  (times: project start → first BoQ; first BoQ → first release)`);
for (const f of evidence.firms) {
  console.log(`\n▌ ${f.name}  (${f.firm_id.slice(0, 8)}) — ${f.totals.projects} project(s) · ${f.totals.boq_generations} BoQ generations · corrections ${f.totals.corrections.total} (book ${f.totals.corrections.landed.book} / project ${f.totals.corrections.landed.project}) · support ${f.totals.support_touches} · reviews ${f.totals.reviews}`);
  console.log(`  rate book: ${f.rate_book.entries} entries · ${f.rate_book.edits} edits · ${f.rate_book.promotions} promotions · ${f.rate_book.retirements} retirements · ${f.rate_book.quote_accepts} quote accepts · medians: →1st BoQ ${min(f.totals.median_time_to_first_boq_min)} · checking ${min(f.totals.median_checking_min)}`);
  if (Object.keys(f.totals.corrections.by_section).length) console.log(`  corrections by section: ${types(f.totals.corrections.by_section)}`);
  console.log("  " + H.map((h, i) => cell(h, W[i]!)).join("  "));
  for (const p of f.projects) console.log("  " + row(p));
  for (const p of f.projects) for (const g of p.gaps) console.log(`    ⚠ ${p.name.slice(0, 28)}: ${g}`);
  for (const g of f.gaps) console.log(`    ⚠ firm: ${g}`);
}
if (evidence.unattributed.length) {
  console.log(`\n▌ Projects with events and NO firm (not in any firm's evidence)`);
  console.log("  " + H.map((h, i) => cell(h, W[i]!)).join("  "));
  for (const p of evidence.unattributed) console.log("  " + row(p));
  for (const p of evidence.unattributed) for (const g of p.gaps) console.log(`    ⚠ ${p.name.slice(0, 28)}: ${g}`);
}
console.log("");
