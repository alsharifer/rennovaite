#!/usr/bin/env node
// =============================================================================
// scripts/document-identity-scan.mjs — what names do a project's documents print?
//
//   node scripts/document-identity-scan.mjs [port] <project-id>...
//
// READ-ONLY. Renders each project's drawing set (every sheet's SVG), render-pack
// pages and BoQ page through the running dev server and searches the output for:
//   - every withheld identity (contractor / supplier / reference-property names)
//   - every firm name in `firms` EXCEPT the project's own firm, which is the only
//     project whose surfaces may carry it (lib/identity/curation.ts).
// Prints where each hit is. Exit 1 on any hit.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

const args = process.argv.slice(2);
const port = /^\d+$/.test(args[0] ?? "") ? args.shift() : "3098";
const base = `http://localhost:${port}`;

// Literal on purpose: the scan must not be weakened by editing the module it checks.
const WITHHELD = ["KAME", "Atrium", "QTN20261407", "Global Creation", "3936/R1", "Laspinas", "46703", "Villa 94", "Villa94", "V94", "RAK tiles quotation"];

const { url, key } = resolveTarget({ script: "document-identity-scan", writes: false });
const sb = createClient(url, key);
const firms = (await sb.from("firms").select("id, name")).data ?? [];

let hits = 0;
for (const id of args) {
  const { data: p } = await sb.from("projects").select("firm_id, name").eq("id", id).maybeSingle();
  const names = [...WITHHELD, ...firms.filter((f) => f.id !== (p?.firm_id ?? null)).map((f) => f.name)];
  console.log(`\n${id}  (${p?.name ?? "?"}; own firm: ${firms.find((f) => f.id === p?.firm_id)?.name ?? "none"})`);

  const surfaces = [];
  const d = await fetch(`${base}/api/projects/${id}/drawings`);
  if (d.ok) for (const s of (await d.json()).sheets ?? []) surfaces.push([`sheet ${s.sheetNumber} (${s.kind})`, s.svg]);
  else console.log(`  drawings: HTTP ${d.status}`);
  const r = await fetch(`${base}/api/projects/${id}/render-pack?format=pages`);
  if (r.ok) (await r.json()).pages?.forEach((pg, i) => surfaces.push([`pack page ${i + 1}`, typeof pg === "string" ? pg : JSON.stringify(pg)]));
  else console.log(`  render pack: HTTP ${r.status}`);
  const b = await fetch(`${base}/project/${id}/boq`);
  if (b.ok) surfaces.push(["BoQ page (HTML + payload)", await b.text()]);

  console.log(`  surfaces scanned: ${surfaces.length}`);
  for (const n of names) {
    const where = surfaces.filter(([, text]) => text.includes(n)).map(([w]) => w);
    if (where.length) {
      hits += where.length;
      const [, sample] = surfaces.find(([, t]) => t.includes(n));
      const i = sample.indexOf(n);
      console.log(`  HIT "${n}" on ${where.join(", ")}\n      …${sample.slice(Math.max(0, i - 90), i + 60).replace(/\s+/g, " ")}…`);
    }
  }
  if (!hits) console.log("  clean");
}
process.exit(hits ? 1 : 0);
