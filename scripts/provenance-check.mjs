#!/usr/bin/env node
// =============================================================================
// scripts/provenance-check.mjs — live check of I4 against a running dev server.
//
//   node scripts/provenance-check.mjs [port] <project-id>...
//
// READ-ONLY. For each project's BoQ page it fetches the server-rendered HTML
// (which includes the RSC payload — every prop the browser receives) and checks:
//   1. every figure in the BoQ is a provenance trigger: counts traced / gap /
//      none, and lists any figure WITHOUT a source chain by its text;
//   2. no gap figure (untraceable) goes unreported — each is printed;
//   3. no withheld identity (contractor names, internal_ref, firm names from
//      `firms`) appears anywhere in the HTML or payload;
//   4. the page shows the Subtotal / Contingency / VAT rows the PDF prints.
// Exit 1 on any leak or missing summary row. Gaps and provenance-less figures
// are REPORTED (they are findings), not silently passed.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

const args = process.argv.slice(2);
const port = /^\d+$/.test(args[0] ?? "") ? args.shift() : "3098";
const ids = args;

// Mirrors lib/identity/curation.ts WITHHELD_IDENTITIES (kept literal here so the
// check cannot be weakened by editing the module it checks).
const WITHHELD = [/KAME/, /Atrium/, /QTN20261407/, /Global Creation/, /3936\/R1/, /Agreement A00074/];

const { url, key } = resolveTarget({ script: "provenance-check", writes: false });
const sb = createClient(url, key);
const firmNames = ((await sb.from("firms").select("name")).data ?? []).map((f) => f.name).filter((n) => n && n.trim().length >= 3);

let failed = false;
for (const id of ids) {
  const res = await fetch(`http://localhost:${port}/project/${id}/boq`);
  const html = await res.text();
  const triggers = [...html.matchAll(/data-figure=""[^>]*data-provenance="(traced|gap|none)"/g)].map((m) => m[1]);
  const none = [...html.matchAll(/<span data-figure="" data-provenance="none"[^>]*>([^<]*)</g)].map((m) => m[1]);
  const counts = { traced: 0, gap: 0, none: 0 };
  for (const t of triggers) counts[t]++;
  const leaks = [...WITHHELD.filter((re) => re.test(html)).map(String), ...firmNames.filter((n) => html.toLowerCase().includes(n.toLowerCase()))];
  const rows = ["subtotal", "contingency", "vat"].filter((r) => !html.includes(`data-summary-row="${r}"`));

  console.log(`\n${id}  HTTP ${res.status}  ${(html.length / 1024).toFixed(0)} KB`);
  console.log(`  figures: ${triggers.length} — traced ${counts.traced} · gap ${counts.gap} · no provenance ${counts.none}`);
  if (none.length) console.log(`  figures without a source chain: ${[...new Set(none)].join(" | ")}`);
  const gapMsgs = [...html.matchAll(/Source not traceable — ([^<]+)</g)].map((m) => m[1]);
  if (counts.gap) console.log(`  UNTRACEABLE (finding): ${counts.gap} figure(s)${gapMsgs.length ? `: ${gapMsgs.join(" | ")}` : ""}`);
  console.log(`  summary rows on screen: ${rows.length ? `MISSING ${rows.join(", ")}` : "subtotal · contingency · VAT present"}`);
  console.log(`  identity leak scan (${WITHHELD.length} withheld patterns + ${firmNames.length} firm name(s)): ${leaks.length ? `LEAK ${leaks.join(", ")}` : "clean"}`);
  if (res.status !== 200 || leaks.length || rows.length) failed = true;
}
process.exit(failed ? 1 : 0);
