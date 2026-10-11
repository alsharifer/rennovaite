// =============================================================================
// scripts/read-path-leak-scan.ts — do the app's read paths carry an identity? (H2)
//
//   node --import ./scripts/_alias-hook.mjs scripts/read-path-leak-scan.ts
//
// READ-ONLY, against whichever database the environment names (the target
// guard prints it; production is allowed because nothing is written). Runs
// the app's OWN read functions in-process — no server needed, so it can check
// production without deploying anything — and scans what they return for every
// withheld identity (lib/identity/curation.ts) AND a literal list kept here, so
// the check cannot be weakened by editing the module it checks.
//
// ACCEPTANCE (exit 1 on any hit):
//   1. rate_book.source, every row — the client-facing column;
//   2. the reference pricing read (loadReferenceRows) and the what-if read
//      (loadRateBook);
//   3. every stored BoQ as the BoQ page / PDF / pack serve it (curateBoq with
//      the project's withheld firm names);
//   4. the accessory catalogue as the picker reads it (loadCatalog);
//   5. plan text as a user receives it — every row of the plan tables as the
//      editor routes serve it (curatePlanRows with the project's withheld
//      names) and the plan page's garden payload (loadGardenSiteData). A
//      wall's measurement note once named the firm that measured it on a
//      project that is not that firm's; this is the check that catches it.
// REPORTED (findings, not failures): raw text elsewhere that a surface curates
// on the way out — stored BoQ jsonb and plan notes before curation, and
// catalogue tables.
// `internal_ref` is where identity belongs; it is not scanned.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

import { loadCatalog } from "../lib/accessories/load.ts";
import { curateBoq, findWithheldIdentities, loadWithheldNames } from "../lib/identity/curation.ts";
import { curatePlanRows } from "../lib/plan/curate-notes.ts";
import { loadGardenSiteData } from "../lib/plan/garden-site-data.ts";
import { loadReferenceRows } from "../lib/rates/reference.ts";
import { loadRateBook } from "../lib/whatif/rate-book.ts";

const LITERAL = ["KAME", "Atrium", "QTN20261407", "Global Creation", "3936/R1", "Laspinas", "46703", "Villa 94", "Villa94", "V94", "RAK tiles quotation"];

function hits(payload: unknown, extra: readonly string[] = []): string[] {
  const text = JSON.stringify(payload) ?? "";
  const lit = LITERAL.filter((n) => text.includes(n));
  const ext = extra.filter((n) => n && text.toLowerCase().includes(n.toLowerCase()));
  return [...new Set([...findWithheldIdentities(payload, extra), ...lit, ...ext])];
}

async function main() {
  const { url, key, isProd } = resolveTarget({ script: "read-path-leak-scan", writes: false });
  // Some read functions (the accessory catalogue, the plan graph behind the
  // plan page's garden payload) reach Supabase through the admin singleton,
  // which reads process.env — pin it to the SAME database this script
  // resolved, or they degrade to empty and a check passes on nothing.
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
  // A firm is known by its registered name and by the brand it prints (047).
  const firms = (((await sb.from("firms").select("*")).data ?? []) as { name: string; display_name?: string | null }[])
    .flatMap((f) => [f.name, f.display_name ?? ""])
    .filter((n) => n.trim().length >= 3);
  let failures = 0;
  const line = (ok: boolean, label: string, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  };

  console.log(`\n${isProd ? "PRODUCTION" : "dev"} — acceptance`);
  const rb = ((await sb.from("rate_book").select("item_key, grade, source")).data ?? []) as { item_key: string; grade: string | null; source: string | null }[];
  const rbHits = rb.filter((r) => hits(r.source, firms).length);
  line(rbHits.length === 0, `rate_book.source: ${rb.length} rows`, rbHits.map((r) => `${r.item_key}: ${hits(r.source, firms).join(", ")}`).join(" | "));

  const ref = await loadReferenceRows(sb);
  line(hits(ref, firms).length === 0, `reference pricing read (loadReferenceRows): ${ref.length} rows`, hits(ref, firms).join(", "));
  const wi = await loadRateBook(sb);
  line(hits(wi, firms).length === 0, "what-if read (loadRateBook)", hits(wi, firms).join(", "));

  const boqRes = await sb.from("boqs").select("id, project_id, sections");
  if (boqRes.error) throw new Error(`boqs read failed: ${boqRes.error.message}`);
  const boqs = (boqRes.data ?? []) as { id: string; project_id: string; sections: unknown }[];
  let rawHits = 0;
  const served: string[] = [];
  for (const b of boqs) {
    const withheld = await loadWithheldNames(sb, b.project_id);
    if (hits(b.sections).length) rawHits++;
    const h = hits(curateBoq(b.sections, withheld), withheld);
    if (h.length) served.push(`${b.id.slice(0, 8)}: ${h.join(", ")}`);
  }
  line(served.length === 0, `stored BoQs as served (curated): ${boqs.length}`, served.join(" | "));
  const catalog = await loadCatalog();
  line(hits(catalog, firms).length === 0, `accessory catalogue as the picker reads it (loadCatalog): ${catalog.length} items`, hits(catalog, firms).join(", "));

  // 5. plan text, as the editor routes and the plan page serve it.
  const PLAN_TABLES = [["rooms", "plan_id"], ["plan_elements", "plan_id"], ["plan_context", "plan_id"], ["plan_openings", "plan_id"], ["plan_fixtures", "project_id"]] as const;
  const plans = ((await sb.from("plans").select("id, project_id")).data ?? []) as { id: string; project_id: string }[];
  let planRows = 0;
  const rawPlan: string[] = [];
  const planServed: string[] = [];
  for (const p of plans) {
    const withheld = await loadWithheldNames(sb, p.project_id);
    for (const [table, key] of PLAN_TABLES) {
      const { data, error } = await sb.from(table).select("*").eq(key, key === "plan_id" ? p.id : p.project_id);
      if (error) continue; // a table an older database does not have yet
      const rows = (data ?? []) as Record<string, unknown>[];
      planRows += rows.length;
      for (const r of rows) if (hits(r, withheld).length) rawPlan.push(`${table} ${String(r.id).slice(0, 8)}: ${hits(r, withheld).join(", ")}`);
      const h = hits(curatePlanRows(rows, withheld), withheld);
      if (h.length) planServed.push(`${table} of plan ${p.id.slice(0, 8)}: ${h.join(", ")}`);
    }
    const site = await loadGardenSiteData(sb, p.project_id, p.id);
    const h = hits(site, withheld);
    if (h.length) planServed.push(`plan-page garden payload of plan ${p.id.slice(0, 8)}: ${h.join(", ")}`);
  }
  line(planServed.length === 0, `plan text as served (editor rows + plan-page garden payload): ${plans.length} plans, ${planRows} rows`, planServed.join(" | "));

  console.log("\nfindings (curated on the way out; reported, not failed)");
  console.log(`  stored BoQ jsonb carrying a withheld name BEFORE curation: ${rawHits} of ${boqs.length}`);
  console.log(`  plan rows whose stored text names a withheld identity BEFORE curation: ${rawPlan.length} of ${planRows}${rawPlan.length ? ` (${rawPlan.join(" | ")})` : ""}`);
  for (const [table, cols] of [["pricing_skus", "*"], ["labour_rates", "*"], ["accessory_catalog", "*"], ["projects", "id, name, display_name"], ["approved_designs", "*"]] as const) {
    const { data, error } = await sb.from(table).select(cols);
    if (error) {
      console.log(`  ${table}: not readable (${error.message})`);
      continue;
    }
    const rows = (data ?? []) as unknown[];
    const n = rows.filter((r) => hits(r, firms).length).length;
    console.log(`  ${table}: ${n} of ${rows.length} rows name a withheld identity${n ? ` (${[...new Set(rows.flatMap((r) => hits(r, firms)))].join(", ")})` : ""}`);
  }

  console.log(failures === 0 ? "\nCLEAN — no withheld identity on any read path" : `\n${failures} READ PATH(S) LEAK`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
