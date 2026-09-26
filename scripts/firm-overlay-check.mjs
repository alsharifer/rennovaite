#!/usr/bin/env node
// =============================================================================
// scripts/firm-overlay-check.mjs — live check of L1 + U1 through the real routes.
//
//   node scripts/firm-overlay-check.mjs [port]      (dev server with GARDEN_PILOT_ENABLED)
//
// U1: every firm call is AUTHENTICATED — two dev accounts (scripts/lib/dev-auth.mjs,
// real Supabase sessions sent as Bearer tokens, no bypass): user A owns firm A,
// user B owns firm B. The check asserts, besides L1's pricing invariants:
//   - anonymous calls to every firm route → 401
//   - user A on firm B's routes, entries, corrections and promotion → 403
//   - GET /api/firms lists only the caller's firms
//
// Writes ONLY to scratch state, and removes all of it:
//   - two scratch firms ("L1 check — firm A/B (scratch)") with books and entries
//   - the isolation stand-in project (12904f6d, "Client garden stand-in") is
//     assigned to firm A for the duration and restored to its prior firm_id
//   - one scratch rate correction on the stand-in (plus its pilot event), which
//     is promoted and then deleted
//   - the two dev accounts persist (dev-scripts+a / +b @rennovaite.local)
// Never touches Mudon, Villa 94, Arabella, or rate_book — and proves the last:
// rate_book is snapshotted before and compared after every step.
//
// Refuses production (scripts/_target-guard.mjs).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const PORT = process.argv[2] ?? "3098";
const BASE = `http://localhost:${PORT}`;
const STAND_IN = "12904f6d-87c1-4398-b245-b926f950bd97";
const ARABELLA = "ec4497c7-71a7-44f5-9f4b-f5a731002d0d";

const { url, key } = resolveTarget({ script: "firm-overlay-check", writes: true });
const sb = createClient(url, key);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
async function api(method, path, body, auth) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(auth?.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function rateBookSnapshot() {
  const { data, error } = await sb.from("rate_book").select("*").order("id");
  if (error) throw error;
  return JSON.stringify(data);
}
async function dryRun(projectId) {
  const r = await api("POST", "/api/generate-boq", { project_id: projectId, dry_run: true });
  if (r.status !== 200) throw new Error(`dry run ${projectId}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.boq;
}
const lines = (boq) => boq.sections.flatMap((s) => s.lines);
const pccOf = (boq) => lines(boq).find((l) => l.rule_id === "GL-04");

console.log("\n0. two dev sessions (real Supabase users, Bearer tokens)");
const userA = await devSession("a", { script: "firm-overlay-check" });
const userB = await devSession("b", { script: "firm-overlay-check" });
check("sessions minted for two distinct accounts", !!userA.token && !!userB.token && userA.userId !== userB.userId, `${userA.email} · ${userB.email}`);

const refBefore = await rateBookSnapshot();
const refUnchanged = async (step) => check(`rate_book unchanged after ${step}`, (await rateBookSnapshot()) === refBefore);

const { data: standIn } = await sb.from("projects").select("id, firm_id").eq("id", STAND_IN).single();
const priorFirm = standIn.firm_id ?? null;
// The stand-in accumulates pilot events from other verification runs; the
// cleanup check is that THIS run leaves the count where it found it.
const { count: evBefore } = await sb.from("pilot_events").select("id", { count: "exact", head: true }).eq("project_id", STAND_IN);
const created = { firms: [], correction: null };

try {
  console.log("\n1. baseline (no firm)");
  const base = await dryRun(STAND_IN);
  const basePcc = pccOf(base);
  check("stand-in prices PCC at the reference tier", basePcc.rate_tier === "reference", `${basePcc.rate_aed} · ${basePcc.vendor_or_source}`);
  check("no OH&P line without a firm", base.ohp_aed === undefined);

  console.log("\n2. anonymous calls are refused");
  const anonList = await api("GET", "/api/firms");
  const anonCreate = await api("POST", "/api/firms", { name: "L1 check — anon (scratch)" });
  check("GET / POST /api/firms without a session → 401", anonList.status === 401 && anonCreate.status === 401, `${anonList.status} ${anonList.body.code} / ${anonCreate.status}`);

  console.log("\n3. overlay CRUD via the routes, each user on its own firm");
  const fa = await api("POST", "/api/firms", { name: "L1 check — firm A (scratch)", created_by: "firm-overlay-check" }, userA);
  const fb = await api("POST", "/api/firms", { name: "L1 check — firm B (scratch)", created_by: "firm-overlay-check" }, userB);
  check("POST /api/firms ×2 → 201 (creator becomes member)", fa.status === 201 && fb.status === 201, `${fa.status} ${fb.status}`);
  const A = fa.body.firm.id, B = fb.body.firm.id;
  created.firms.push([A, userA], [B, userB]);
  const dup = await api("POST", "/api/firms", { name: "l1 check — FIRM a (scratch)" }, userA);
  check("duplicate firm name (case-insensitive) → 409", dup.status === 409);
  const listA = await api("GET", "/api/firms", undefined, userA);
  const listB = await api("GET", "/api/firms", undefined, userB);
  check("GET /api/firms lists ONLY the caller's firms", listA.body.firms?.some((f) => f.id === A) && !listA.body.firms?.some((f) => f.id === B) && listB.body.firms?.some((f) => f.id === B) && !listB.body.firms?.some((f) => f.id === A));

  const ea = await api("POST", `/api/firms/${A}/rates`, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 95.5, kind: "labour" }, userA);
  const eb = await api("POST", `/api/firms/${B}/rates`, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 188.8, kind: "labour" }, userB);
  check("POST rates → 201 for each firm by its own member", ea.status === 201 && eb.status === 201);
  const bad = await api("POST", `/api/firms/${A}/rates`, { item_key: "garden.pcc_base", unit: "lm", rate_aed: 1, kind: "supply_and_install" }, userA);
  check("entry in the wrong unit / kind → 422 with reasons", bad.status === 422, bad.body.error);
  const patched = await api("PATCH", `/api/firms/${A}/rates/${ea.body.entry.id}`, { rate_aed: 96.25 }, userA);
  check("PATCH own entry → 200", patched.status === 200 && patched.body.entry.rate_aed === 96.25);
  const ohp = await api("PATCH", `/api/firms/${A}`, { ohp_pct: 10 }, userA);
  check("PATCH OH&P → 10%", ohp.status === 200 && ohp.body.firm.ohp_pct === 10);
  const ratesA = await api("GET", `/api/firms/${A}/rates`, undefined, userA);
  check("GET A's rates lists only A's", ratesA.body.entries.length === 1 && ratesA.body.entries.every((e) => e.firm_id === A));
  check("GET /api/firms carries no rate data", !JSON.stringify(listA.body).includes("188.8") && !JSON.stringify(listA.body).includes("96.25"));
  await refUnchanged("CRUD");

  console.log("\n4. user A on firm B → 403 on authentication grounds (not 404 by scoping)");
  const xGet = await api("GET", `/api/firms/${B}`, undefined, userA);
  const xRates = await api("GET", `/api/firms/${B}/rates`, undefined, userA);
  const xPost = await api("POST", `/api/firms/${B}/rates`, { item_key: "garden.pcc_base", unit: "m2", rate_aed: 1, kind: "labour" }, userA);
  const xPatchB = await api("PATCH", `/api/firms/${B}/rates/${eb.body.entry.id}`, { rate_aed: 1 }, userA);
  const xDelB = await api("DELETE", `/api/firms/${B}/rates/${eb.body.entry.id}`, undefined, userA);
  const xFirm = await api("PATCH", `/api/firms/${B}`, { ohp_pct: 1 }, userA);
  const xDelFirm = await api("DELETE", `/api/firms/${B}`, undefined, userA);
  const all403 = [xGet, xRates, xPost, xPatchB, xDelB, xFirm, xDelFirm].every((r) => r.status === 403 && r.body.code === "not_a_member");
  check("GET firm / GET rates / POST rate / PATCH entry / DELETE entry / PATCH firm / DELETE firm → 403 not_a_member", all403, [xGet, xRates, xPost, xPatchB, xDelB, xFirm, xDelFirm].map((r) => r.status).join(" "));
  const anonB = await api("GET", `/api/firms/${B}/rates`);
  check("the same routes anonymous → 401", anonB.status === 401);
  const xPath = await api("PATCH", `/api/firms/${A}/rates/${eb.body.entry.id}`, { rate_aed: 1 }, userA);
  check("B's entry through A's OWN path is still 404 (scoping holds underneath)", xPath.status === 404);
  const bStill = await api("GET", `/api/firms/${B}/rates`, undefined, userB);
  check("B's entry untouched", bStill.body.entries[0]?.rate_aed === 188.8);
  const xAssign = await api("PATCH", `/api/projects/${STAND_IN}`, { firm_id: B }, userA);
  const anonAssign = await api("PATCH", `/api/projects/${STAND_IN}`, { firm_id: A });
  check("attaching firm B to a project as user A → 403; anonymous → 401", xAssign.status === 403 && anonAssign.status === 401, `${xAssign.status} ${anonAssign.status}`);

  console.log("\n5. the stand-in, priced by firm A");
  const assign = await api("PATCH", `/api/projects/${STAND_IN}`, { firm_id: A }, userA);
  check("PATCH project firm_id → A (as a member)", assign.status === 200);
  const withA = await dryRun(STAND_IN);
  const pccA = pccOf(withA);
  check("PCC resolves at firm_private, A's rate", pccA.rate_tier === "firm_private" && pccA.rate_aed === 96.25, `${pccA.rate_aed} · ${pccA.vendor_or_source}`);
  check("B's rate appears nowhere in A's BoQ", !JSON.stringify(withA).includes("188.8"));
  check("no firm name on any line", !JSON.stringify(withA).includes("L1 check"));
  const others = lines(withA).filter((l) => l.rule_id !== "GL-04");
  const baseOthers = lines(base).filter((l) => l.rule_id !== "GL-04");
  check("every other line unchanged", JSON.stringify(others.map((l) => [l.rate_aed, l.total_aed])) === JSON.stringify(baseOthers.map((l) => [l.rate_aed, l.total_aed])));
  check("subtotal moved by exactly the PCC delta", Math.abs(withA.subtotal_aed - base.subtotal_aed - (pccA.total_aed - basePcc.total_aed)) < 0.01);
  check("OH&P is its own line at 10% of the subtotal", withA.ohp_pct === 10 && withA.ohp_aed === Math.round(withA.subtotal_aed * 0.1), `AED ${withA.ohp_aed}`);
  check("grand total = subtotal + OH&P + contingency + VAT", Math.abs(withA.grand_total_aed - (withA.subtotal_aed + withA.ohp_aed + withA.contingency_aed + withA.vat_aed)) < 0.01);
  const arabella = await dryRun(ARABELLA);
  check("Arabella (no firm) still reference-priced, no OH&P", pccOf(arabella)?.rate_tier !== "firm_private" && arabella.ohp_aed === undefined);
  await refUnchanged("pricing");

  console.log("\n6. correction → explicit promotion → tier 2");
  // Remove A's own entry so the promoted correction is what answers.
  await api("DELETE", `/api/firms/${A}/rates/${ea.body.entry.id}`, undefined, userA);
  const anonCorr = await api("POST", "/api/boq-corrections", {
    project_id: STAND_IN, item_key: "garden.pcc_base", line_description: "PCC (anon, must fail)", correction_type: "rate", new_value: 1, attributed_to: "L1 check — firm A (scratch)",
  });
  check("attributing a correction to a firm anonymously → 401", anonCorr.status === 401, `${anonCorr.status}`);
  const xCorr = await api("POST", "/api/boq-corrections", {
    project_id: STAND_IN, item_key: "garden.pcc_base", line_description: "PCC (wrong user, must fail)", correction_type: "rate", new_value: 1, firm_id: A,
  }, userB);
  check("user B attributing a correction to firm A → 403", xCorr.status === 403, `${xCorr.status} ${xCorr.body.code}`);
  const corr = await api("POST", "/api/boq-corrections", {
    project_id: STAND_IN, item_key: "garden.pcc_base", line_description: "PCC base under paving (L1 check, scratch)",
    correction_type: "rate", old_value: 105.6, new_value: 99.99, attributed_to: "  l1 check — firm a (SCRATCH) ", confidence: "firm",
  }, userA);
  created.correction = corr.body.correction?.id ?? null;
  check("correction recorded with firm normalised from free text (by its member)", corr.status === 200 && corr.body.correction?.firm_id === A, `${corr.status} ${JSON.stringify(corr.body).slice(0, 120)}`);
  const before = pccOf(await dryRun(STAND_IN));
  check("an UNPROMOTED correction changes no rate", before.rate_tier === "reference" && before.rate_aed === basePcc.rate_aed);
  const xPromoteB = await api("POST", `/api/firms/${B}/promote`, { correction_id: created.correction }, userB);
  check("firm B (its member) cannot promote A's correction → 403", xPromoteB.status === 403);
  const xPromoteUser = await api("POST", `/api/firms/${A}/promote`, { correction_id: created.correction }, userB);
  check("user B cannot promote through firm A's route → 403 not_a_member", xPromoteUser.status === 403 && xPromoteUser.body.code === "not_a_member");
  const promote = await api("POST", `/api/firms/${A}/promote`, { correction_id: created.correction }, userA);
  check("firm A's member promotes it → 201, origin promoted_correction", promote.status === 201 && promote.body.entry?.origin === "promoted_correction", `${promote.status} ${promote.body.code ?? ""}`);
  const again = await api("POST", `/api/firms/${A}/promote`, { correction_id: created.correction }, userA);
  check("second promotion → 409", again.status === 409);
  const after = pccOf(await dryRun(STAND_IN));
  check("PCC now resolves at firm_correction", after.rate_tier === "firm_correction" && after.rate_aed === 99.99, `${after.rate_aed} · ${after.vendor_or_source}`);
  await refUnchanged("promotion");
} finally {
  console.log("\ncleanup");
  await sb.from("projects").update({ firm_id: priorFirm }).eq("id", STAND_IN);
  if (created.correction) {
    await sb.from("pilot_events").delete().eq("project_id", STAND_IN).eq("kind", "correction").contains("detail", { correction_id: created.correction });
    await sb.from("boq_corrections").delete().eq("id", created.correction);
  }
  for (const [id, who] of created.firms) await api("DELETE", `/api/firms/${id}`, undefined, who);
  await sb.from("firms").delete().like("name", "L1 check%"); // belt and braces (an anon-create that wrongly succeeded, say)
  const { count: left } = await sb.from("firms").select("id", { count: "exact", head: true }).like("name", "L1 check%");
  const { data: si } = await sb.from("projects").select("firm_id").eq("id", STAND_IN).single();
  const { count: corrLeft } = await sb.from("boq_corrections").select("id", { count: "exact", head: true }).eq("project_id", STAND_IN);
  check("scratch firms removed", left === 0);
  check("stand-in firm_id restored", (si.firm_id ?? null) === priorFirm);
  check("scratch correction removed", corrLeft === 0, `stand-in corrections: ${corrLeft}`);
  const { count: evLeft } = await sb.from("pilot_events").select("id", { count: "exact", head: true }).eq("project_id", STAND_IN);
  check("scratch pilot event removed", evLeft === evBefore, `stand-in pilot events: ${evBefore} before, ${evLeft} after`);
  await refUnchanged("cleanup");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
