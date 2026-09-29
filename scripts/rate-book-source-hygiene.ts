// =============================================================================
// scripts/rate-book-source-hygiene.ts — identity out of rate_book.source (H2).
//
//   node --import ./scripts/_alias-hook.mjs scripts/rate-book-source-hygiene.ts [--apply]
//
// `rate_book.source` is the client-facing column (migration 032); a supplier's
// or contractor's name belongs in `internal_ref`, which nothing renders. The
// garden rows were seeded that way (G2); the older Mudon interior seed was not,
// and its supplier names sit latent in `source` on production.
//
// For every row whose `source` names a withheld identity
// (lib/identity/curation.ts): the ORIGINAL text moves to `internal_ref`
// (appended if one is already there, never overwritten — the trace survives),
// and `source` becomes the curated neutral label the read paths already print.
// No rate, key, grade, unit or provenance changes.
//
// Dry run by default: prints the plan (item keys and the neutral label only).
// --apply writes, re-reads and asserts: no `source` names a withheld identity,
// every changed row's `internal_ref` holds its original text, and no other
// column moved. Idempotent — a second run plans nothing. Production writes need
// ALLOW_PROD_WRITE=1 (scripts/_target-guard.mjs).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

import { curateText, findWithheldIdentities } from "../lib/identity/curation.ts";

const APPLY = process.argv.includes("--apply");

interface Row {
  id: string;
  item_key: string;
  grade: string | null;
  unit: string | null;
  rate_aed: number;
  provenance: string | null;
  source: string | null;
  internal_ref: string | null;
}

const COLS = "id, item_key, grade, unit, rate_aed, provenance, source, internal_ref";
// Literal on purpose (as in scripts/document-identity-scan.mjs): a check that
// imported the list it verifies would pass whatever the list became.
const LITERAL = ["KAME", "Atrium", "QTN20261407", "Global Creation", "3936/R1", "Laspinas", "46703", "Villa 94", "Villa94", "V94", "RAK tiles quotation"];

async function main() {
  const { url, key, isProd } = resolveTarget({ script: "rate-book-source-hygiene", writes: APPLY });
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const firmNames = (((await sb.from("firms").select("name")).data ?? []) as { name: string }[]).map((f) => f.name);

  const { data, error } = await sb.from("rate_book").select(COLS).order("item_key");
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const plan = rows
    .filter((r) => r.source && findWithheldIdentities(r.source, firmNames).length > 0)
    .map((r) => {
      const source = curateText(r.source!, firmNames);
      const internal_ref = r.internal_ref?.includes(r.source!) ? r.internal_ref : r.internal_ref ? `${r.internal_ref} · ${r.source}` : r.source!;
      return { row: r, source, internal_ref, withheld: findWithheldIdentities(r.source!, firmNames).length };
    });

  console.log(`${isProd ? "PRODUCTION" : "dev"} rate_book: ${rows.length} rows; ${plan.length} carry a withheld identity in source`);
  for (const p of plan) console.log(`  ${p.row.item_key.padEnd(34)} ${String(p.row.grade ?? "-").padEnd(10)} → source "${p.source}" (${p.withheld} name${p.withheld === 1 ? "" : "s"} → internal_ref)`);
  // Second opinion: the literal list the document scanners use. A curated label
  // that still carries one of these is a curation gap — fix curation, not the row.
  const residue = plan.filter((p) => LITERAL.some((n) => p.source.includes(n)));
  if (residue.length) {
    console.error(`\nREFUSING: ${residue.length} curated label(s) still carry a scanned name: ${residue.map((p) => p.row.item_key).join(", ")}`);
    process.exit(1);
  }
  if (!APPLY) {
    console.log(plan.length ? "\nDRY RUN — nothing written. Re-run with --apply." : "\nNothing to do.");
    return;
  }

  for (const p of plan) {
    const { error: e } = await sb.from("rate_book").update({ source: p.source, internal_ref: p.internal_ref }).eq("id", p.row.id);
    if (e) throw new Error(`update ${p.row.id}: ${e.message}`);
  }

  // Re-read and assert.
  const after = ((await sb.from("rate_book").select(COLS).order("item_key")).data ?? []) as Row[];
  const byId = new Map(after.map((r) => [r.id, r]));
  const leaks = after.filter((r) => r.source && findWithheldIdentities(r.source, firmNames).length > 0);
  const lostTrace = plan.filter((p) => !byId.get(p.row.id)?.internal_ref?.includes(p.row.source!));
  const moved = rows.filter((r) => {
    const a = byId.get(r.id);
    return !a || a.item_key !== r.item_key || a.grade !== r.grade || a.unit !== r.unit || Number(a.rate_aed) !== Number(r.rate_aed) || a.provenance !== r.provenance;
  });
  console.log(`\napplied ${plan.length}: source leaks left ${leaks.length} · trace lost ${lostTrace.length} · other columns moved ${moved.length} · rows ${rows.length} → ${after.length}`);
  if (leaks.length || lostTrace.length || moved.length || after.length !== rows.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
