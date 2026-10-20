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
//   6. (C1) every project's latest revision on every rendered surface — the
//      inspector / popover chains, the BoQ page's review model, the Issues
//      navigator, the proposal and BoQ PDF pages — scanned for another
//      project (its name, the reference projects) and for reference-order room
//      labels its plan does not have (lib/identity/surface-scan.ts). A revision
//      stored before C1 fails until it is regenerated; that is the point.
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
import { boqIssues } from "../lib/boq/issues.ts";
import { buildReviewModel } from "../lib/boq/review-model.ts";
import { buildBoqPdfPages } from "../lib/documents/boq-pdf-pages.ts";
import { buildProposalPages } from "../lib/documents/proposal.ts";
import { scanSurface } from "../lib/identity/surface-scan.ts";
import { buildBoqProvenance, EMPTY_CONTEXT } from "../lib/provenance/boq.ts";

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

  // 6. (C1) another project on any rendered surface of a project's latest revision.
  const projects = ((await sb.from("projects").select("id, name, display_name").is("deleted_at", null)).data ?? []) as { id: string; name: string | null; display_name: string | null }[];
  const surfaceHits: string[] = [];
  let scanned = 0;
  for (const pr of projects) {
    const { data: latest } = await sb.from("boqs").select("id, sections").eq("project_id", pr.id).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; sections: Record<string, unknown> }>();
    if (!latest?.sections) continue;
    const { data: plan } = await sb.from("plans").select("id").eq("project_id", pr.id).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
    const rooms = plan ? (((await sb.from("rooms").select("name_en, room_type, area_m2").eq("plan_id", plan.id)).data ?? []) as { name_en: string | null; room_type: string | null; area_m2: number | null }[]) : [];
    const withheld = await loadWithheldNames(sb, pr.id);
    const boq = curateBoq(latest.sections, withheld) as never;
    const ctx = {
      ownNames: [pr.name ?? "", pr.display_name ?? ""].filter(Boolean),
      ownRooms: rooms.map((r) => r.name_en ?? "").filter(Boolean),
      otherProjectNames: projects.filter((o) => o.id !== pr.id).flatMap((o) => [o.name ?? "", o.display_name ?? ""]),
      withheldNames: withheld,
    };
    const provenance = buildBoqProvenance(boq, { ...EMPTY_CONTEXT, withheldNames: withheld });
    const model = buildReviewModel({ projectId: pr.id, boqId: latest.id, rev: 0, revDate: "", persona: "owner", boq, provenance, tierCtx: { qsValidated: {} }, firm: null, basis: null, duplicates: [], budget: null });
    const doc = { projectName: pr.display_name ?? pr.name ?? "Project", community: "Dubai", dateISO: new Date().toISOString().slice(0, 10), boq };
    const found = [
      ...scanSurface("inspector + popovers", provenance, ctx),
      ...scanSurface("BoQ page", model, ctx),
      ...scanSurface("Issues navigator", boqIssues(model, null), ctx),
      ...scanSurface("proposal pages", buildProposalPages({ ...doc, brand: "Contractor", logoDataUri: null, termsText: null, rooms: rooms.map((r) => ({ name: r.name_en ?? "", kind: r.room_type ?? "", area_m2: r.area_m2 })) }), ctx),
      ...scanSurface("BoQ PDF pages", buildBoqPdfPages(doc), ctx),
    ];
    scanned++;
    if (found.length) surfaceHits.push(`${pr.id.slice(0, 8)} rev ${latest.id.slice(0, 8)}: ${[...new Set(found.map((f) => `${f.kind} "${f.text}" on ${f.surface}`))].join("; ")}`);
  }
  line(surfaceHits.length === 0, `another project on a rendered surface (latest revision of ${scanned} projects)`, surfaceHits.join(" | "));

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
