#!/usr/bin/env node
// =============================================================================
// scripts/backfill-pilot-events.ts — fill the 048 columns on pre-048 rows where
// the data supports it, and PRINT what it cannot recover (L5).
//
//   node --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/backfill-pilot-events.ts [--apply]
//
// Without --apply: a dry run — the plan and the counts, nothing written.
// With --apply: the patches are written row by row (idempotent: a second run
// finds nothing to patch). The planner is pure (lib/pilot/backfill.ts) and unit
// tested; this file only reads rows and writes patches. Refuses production
// unless ALLOW_PROD_WRITE=1 (scripts/_target-guard.mjs).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { planBackfill, type CorrectionRef, type OldEventRow } from "../lib/pilot/backfill.ts";
import { resolveTarget } from "./_target-guard.mjs";

const apply = process.argv.includes("--apply");
const { url, key } = resolveTarget({ script: "backfill-pilot-events", writes: apply });
const sb = createClient(url, key);

const { data: events, error } = await sb.from("pilot_events").select("id, project_id, kind, detail, firm_id, session_ref, stage, actor").order("recorded_at");
if (error) throw new Error(error.message);
const { data: corrections } = await sb.from("boq_corrections").select("id, project_id, firm_id, session_ref");
const { data: projects } = await sb.from("projects").select("id, firm_id");
const projectFirm = Object.fromEntries(((projects ?? []) as { id: string; firm_id: string | null }[]).map((p) => [p.id, p.firm_id]));

const plan = planBackfill((events ?? []) as OldEventRow[], (corrections ?? []) as CorrectionRef[], projectFirm);
console.log(`\n${apply ? "APPLYING" : "DRY RUN"} — ${events?.length ?? 0} rows read`);
console.log("  patches:", plan.patches.length, JSON.stringify(plan.counts));
const byReason = new Map<string, number>();
for (const p of plan.patches) byReason.set(p.reason, (byReason.get(p.reason) ?? 0) + 1);
for (const [r, n] of byReason) console.log(`    ${n} × ${r}`);
console.log("\n  CANNOT backfill (stated, not guessed):");
for (const c of plan.cannot) console.log(`    - ${c}`);

if (apply) {
  let written = 0;
  for (const p of plan.patches) {
    const { error: e } = await sb.from("pilot_events").update(p.patch).eq("id", p.id);
    if (e) throw new Error(`patch ${p.id}: ${e.message}`);
    written++;
  }
  console.log(`\n  written: ${written} rows`);
  const again = planBackfill(
    ((await sb.from("pilot_events").select("id, project_id, kind, detail, firm_id, session_ref, stage, actor")).data ?? []) as OldEventRow[],
    (corrections ?? []) as CorrectionRef[],
    projectFirm,
  );
  console.log(`  idempotence: a second plan finds ${again.patches.length} patch(es)`);
  if (again.patches.length) process.exit(1);
}
