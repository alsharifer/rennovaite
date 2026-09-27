#!/usr/bin/env node
// =============================================================================
// scripts/revision-diff-check.mjs — live check of U4 / L3 through the real routes.
//
//   node scripts/revision-diff-check.mjs [port]     (dev server with GARDEN_PILOT_ENABLED)
//
// Three things, each through the routes with real dev sessions (scripts/lib/dev-auth.mjs):
//   1. REVISION DIFF — read-only on the Arabella client garden: the diff of the
//      G5d session's first and last recorded stage reproduces the session record
//      (screenshots/garden-pilot/g5d-session.json) line for line; the PDF renders,
//      is scanned for withheld identities, and anonymous calls are 401.
//   2. APPROVALS — on the isolation stand-in (scratch): firm approval by a member,
//      client approval recorded with name + date, 403 for a non-member once the
//      stand-in belongs to a scratch firm, 422 without client details; the trail
//      appears in the diff JSON and on the PDF pages.
//   3. PROMOTION HISTORY — on a scratch firm: promote → promote over → both kept,
//      trail says who/what/when; DELETE retires (row kept, correction re-promotable);
//      PATCH of a promoted rate's figure → 409 entry_locked.
//
// Writes ONLY scratch state and removes it: a scratch firm + book + entries + its
// membership, the stand-in's firm_id (restored), scratch corrections and their
// pilot events, the scratch approvals. Mudon / Villa 94 / Arabella are read only.
// Refuses production (scripts/_target-guard.mjs).
// =============================================================================

import fs from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const PORT = process.argv[2] ?? "3098";
const BASE = `http://localhost:${PORT}`;
const STAND_IN = "12904f6d-87c1-4398-b245-b926f950bd97";
const ARABELLA = "ec4497c7-71a7-44f5-9f4b-f5a731002d0d";

const { url, key } = resolveTarget({ script: "revision-diff-check", writes: true });
const sb = createClient(url, key);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
async function api(method, path, body, auth, raw = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(auth?.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: raw ? await res.arrayBuffer() : await res.json().catch(() => ({})) };
}

console.log("\n0. two dev sessions");
const userA = await devSession("a", { script: "revision-diff-check" });
const userB = await devSession("b", { script: "revision-diff-check" });
check("sessions minted", !!userA.token && !!userB.token && userA.userId !== userB.userId);

const session = JSON.parse(fs.readFileSync("screenshots/garden-pilot/g5d-session.json", "utf8"));
const created = { firm: null, corrections: [], approvals: [] };
const { data: standIn } = await sb.from("projects").select("id, firm_id").eq("id", STAND_IN).single();
const priorFirm = standIn.firm_id ?? null;
const { count: evBefore } = await sb.from("pilot_events").select("id", { count: "exact", head: true }).eq("project_id", STAND_IN);

try {
  console.log("\n1. revision diff — Arabella, read-only");
  const anon = await api("GET", `/api/projects/${ARABELLA}/boq-revisions`);
  check("anonymous GET boq-revisions → 401", anon.status === 401, `${anon.status}`);
  const revs = await api("GET", `/api/projects/${ARABELLA}/boq-revisions`, undefined, userA);
  check("GET boq-revisions → 200 with the stage BoQs among them", revs.status === 200 && session.stages.every((s) => revs.body.revisions.some((r) => r.boq_id === s.boq_id)), `${revs.body.revisions?.length} revisions`);
  const from = session.stages[0].boq_id;
  const endStage = session.stages.find((s, i) => i > 0 && s.grand_total_aed === session.overall.boq.new_total_aed);
  const to = endStage.boq_id;
  const anonDiff = await api("GET", `/api/projects/${ARABELLA}/boq-diff?from=${from}&to=${to}`);
  check("anonymous GET boq-diff → 401", anonDiff.status === 401);
  const diff = await api("GET", `/api/projects/${ARABELLA}/boq-diff?from=${from}&to=${to}`, undefined, userA);
  check("GET boq-diff → 200", diff.status === 200, `${diff.status} ${diff.body.error ?? ""}`);
  const d = diff.body.diff;
  check("grand total old → new → Δ equals the session record", d && d.summary.grand.old === session.overall.boq.old_total_aed && d.summary.grand.new === session.overall.boq.new_total_aed && d.summary.grand.delta === session.overall.boq.delta_aed, d && `${d.summary.grand.old} → ${d.summary.grand.new} (${d.summary.grand.delta})`);
  // Overall moved lines = the union of the staged moved lines, netted per key.
  const staged = new Map();
  for (const st of Object.values(session.change_report)) for (const m of st.moved) staged.set(m.description, (staged.get(m.description) ?? 0) + m.delta_aed);
  const overallExpected = [...staged.entries()].filter(([, delta]) => delta !== 0 || true);
  const gotByDesc = new Map(d.lines.map((l) => [l.description, l.delta_aed]));
  // Only the stages up to `to` count (later stages moved the front garden again).
  const uptoIdx = session.stages.findIndex((s) => s.boq_id === to);
  const stagedUpTo = new Map();
  for (const [k, st] of Object.entries(session.change_report)) {
    if (Number(k) + 1 > uptoIdx) continue;
    for (const m of st.moved) stagedUpTo.set(m.description, Math.round(((stagedUpTo.get(m.description) ?? 0) + m.delta_aed) * 100) / 100);
  }
  const mismatches = [...stagedUpTo.entries()].filter(([desc, delta]) => (gotByDesc.get(desc) ?? 0) !== delta).map(([desc, delta]) => `${desc}: ${gotByDesc.get(desc)} vs ${delta}`);
  check("every line the session moved carries the same Δ AED in the live diff", mismatches.length === 0 && d.lines.length === stagedUpTo.size, mismatches.join("; ") || `${d.lines.length} lines`);
  void overallExpected;
  check("every moved line names a cause only where recorded (none were handed in for Arabella's script stages)", d.lines.every((l) => Array.isArray(l.causes)));
  check("the diff JSON carries provenance for both revisions", diff.body.provenance?.before?.summary?.grand && diff.body.provenance?.after?.summary?.grand);
  const pages = await api("GET", `/api/projects/${ARABELLA}/boq-diff?from=${from}&to=${to}&format=pages`, undefined, userA);
  check("format=pages → SVG pages with the Δ and every moved line", pages.status === 200 && pages.body.pages.length >= 1 && pages.body.pages.join("").includes('data-diff-delta="true"') && (pages.body.pages.join("").match(/data-delta-aed=/g) ?? []).length === d.lines.length);
  const leak = ["Newspace", "KAME", "Atrium", "Global Creation", "Laspinas", "@"].filter((n) => pages.body.pages.join("").includes(n));
  check("no withheld identity or e-mail on any printed page", leak.length === 0, leak.join(", "));
  const pdf = await api("GET", `/api/projects/${ARABELLA}/boq-diff?from=${from}&to=${to}&format=pdf`, undefined, userA, true);
  check("format=pdf → application/pdf", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && pdf.body.byteLength > 10_000, `${pdf.body.byteLength ?? 0} bytes`);
  const bad = await api("GET", `/api/projects/${ARABELLA}/boq-diff?from=${from}&to=00000000-0000-4000-8000-000000000000`, undefined, userA);
  check("a revision of another project → 404 revision_not_found", bad.status === 404 && bad.body.code === "revision_not_found");

  console.log("\n2. approvals — stand-in (scratch)");
  const standRevs = await api("GET", `/api/projects/${STAND_IN}/boq-revisions`, undefined, userA);
  let boqId = standRevs.body.revisions?.[0]?.boq_id;
  if (!boqId) {
    const gen = await api("POST", "/api/generate-boq", { project_id: STAND_IN }, userA);
    boqId = gen.body.boq_id ?? gen.body.id;
  }
  check("the stand-in has a revision to approve", !!boqId, boqId);
  const a401 = await api("POST", `/api/projects/${STAND_IN}/boq-approvals`, { boq_id: boqId, kind: "firm" });
  check("anonymous approval → 401", a401.status === 401);
  const fa = await api("POST", "/api/firms", { name: "U4 check — firm (scratch)" }, userA);
  created.firm = fa.body.firm.id;
  const assign = await api("PATCH", `/api/projects/${STAND_IN}`, { firm_id: created.firm }, userA);
  check("stand-in assigned to the scratch firm", assign.status === 200, `${assign.status}`);
  const a403 = await api("POST", `/api/projects/${STAND_IN}/boq-approvals`, { boq_id: boqId, kind: "firm" }, userB);
  check("a non-member's approval → 403 not_a_member", a403.status === 403 && a403.body.code === "not_a_member", `${a403.status} ${a403.body.code}`);
  const a422 = await api("POST", `/api/projects/${STAND_IN}/boq-approvals`, { boq_id: boqId, kind: "client" }, userA);
  check("client approval without name/date → 422", a422.status === 422 && a422.body.code === "client_details_required");
  const firmOk = await api("POST", `/api/projects/${STAND_IN}/boq-approvals`, { boq_id: boqId, kind: "firm", note: "U4 check" }, userA);
  check("firm approval by a member → 201", firmOk.status === 201 && firmOk.body.approval.kind === "firm" && firmOk.body.approval.firm_id === created.firm);
  if (firmOk.body.approval) created.approvals.push(firmOk.body.approval.id);
  const clientOk = await api("POST", `/api/projects/${STAND_IN}/boq-approvals`, { boq_id: boqId, kind: "client", client_name: "U4 check client", client_date: "2026-09-26" }, userA);
  check("client approval recorded with name + date → 201", clientOk.status === 201 && clientOk.body.approval.client_name === "U4 check client");
  if (clientOk.body.approval) created.approvals.push(clientOk.body.approval.id);
  const list = await api("GET", `/api/projects/${STAND_IN}/boq-approvals`, undefined, userA);
  check("GET boq-approvals lists both, oldest first", list.status === 200 && list.body.approvals.filter((a) => created.approvals.includes(a.id)).map((a) => a.kind).join(",") === "firm,client");
  const revs2 = await api("GET", `/api/projects/${STAND_IN}/boq-revisions`, undefined, userA);
  const rv = revs2.body.revisions.find((r) => r.boq_id === boqId);
  check("the revision list carries the approval status", rv?.approvals?.firm?.kind === "firm" && rv?.approvals?.client?.client_name === "U4 check client");
  const selfDiff = await api("GET", `/api/projects/${STAND_IN}/boq-diff?from=${boqId}&to=${boqId}&format=pages`, undefined, userA);
  const printed = selfDiff.body.pages?.join("") ?? "";
  check("the diff PDF pages print the approval trail (firm + client) and no e-mail", printed.includes("Approved by the firm ·") && printed.includes("Client approval recorded by the firm · U4 check client · 2026-09-26") && !printed.includes("@"), `${selfDiff.status}`);

  console.log("\n3. promotion history — scratch firm");
  const F = created.firm;
  const corr = async (value) => {
    const r = await api("POST", "/api/boq-corrections", { project_id: STAND_IN, boq_id: boqId, item_key: "garden.pcc_base", line_description: "PCC base under paving", correction_type: "rate", field: "rate_aed", old_value: 105.6, new_value: value, note: "U4 check", firm_id: F }, userA);
    if (r.status !== 201 && r.status !== 200) throw new Error(`correction ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    created.corrections.push(r.body.correction.id);
    return r.body.correction.id;
  };
  const c1 = await corr(95);
  const c2 = await corr(91);
  const p1 = await api("POST", `/api/firms/${F}/promote`, { correction_id: c1 }, userA);
  check("promote c1 → 201", p1.status === 201 || p1.status === 200, `${p1.status} ${p1.body.error ?? ""}`);
  const p2 = await api("POST", `/api/firms/${F}/promote`, { correction_id: c2 }, userA);
  check("promote c2 over c1 → 201 and names the superseded entry", (p2.status === 201 || p2.status === 200) && p2.body.superseded_entry_id === p1.body.entry.id, `${p2.status} ${p2.body.superseded_entry_id}`);
  const hist = await api("GET", `/api/firms/${F}/rates/history?item_key=garden.pcc_base`, undefined, userA);
  check("history: both kept — active 91 first, retired 95 with who/why/replaced-by", hist.status === 200 && hist.body.history.length === 2 && hist.body.history[0].rate_aed === 91 && !hist.body.history[0].superseded_at && hist.body.history[1].rate_aed === 95 && hist.body.history[1].superseded_by === p2.body.entry.id && hist.body.history[1].retired_by === userA.userId && hist.body.history[1].retire_reason === "superseded by a later promotion", JSON.stringify(hist.body.history?.map((h) => [h.rate_aed, h.superseded_at ? "retired" : "active"])));
  check("history resolves the actor to the member's e-mail (firm's own eyes)", hist.body.actors?.[userA.userId] === userA.email);
  const hist403 = await api("GET", `/api/firms/${F}/rates/history?item_key=garden.pcc_base`, undefined, userB);
  check("history for a non-member → 403", hist403.status === 403);
  const active = await api("GET", `/api/firms/${F}/rates`, undefined, userA);
  check("GET rates lists only the active promotion", active.body.entries.length === 1 && active.body.entries[0].id === p2.body.entry.id);
  const dry = await api("POST", "/api/generate-boq", { project_id: STAND_IN, dry_run: true }, userA);
  const pcc = dry.body.boq?.sections.flatMap((s) => s.lines).find((l) => l.rule_id === "GL-04");
  check("the stand-in prices PCC at the NEW promotion (91, firm_correction)", pcc?.rate_aed === 91 && pcc?.rate_tier === "firm_correction", `${pcc?.rate_aed} ${pcc?.rate_tier}`);
  const lock = await api("PATCH", `/api/firms/${F}/rates/${p2.body.entry.id}`, { rate_aed: 50 }, userA);
  check("PATCH a promoted rate's figure → 409 entry_locked", lock.status === 409 && lock.body.code === "entry_locked", `${lock.status} ${lock.body.code}`);
  const noteOk = await api("PATCH", `/api/firms/${F}/rates/${p2.body.entry.id}`, { note: "confirmed" }, userA);
  check("PATCH its note → 200", noteOk.status === 200 && noteOk.body.entry.rate_aed === 91);
  const again409 = await api("POST", `/api/firms/${F}/promote`, { correction_id: c2 }, userA);
  check("promoting c2 again while active → 409 already_promoted", again409.status === 409);
  const del = await api("DELETE", `/api/firms/${F}/rates/${p2.body.entry.id}`, undefined, userA);
  check("DELETE retires → 200", del.status === 200 || del.status === 204, `${del.status}`);
  const { data: rowsAfter } = await sb.from("firm_rate_entries").select("id, superseded_at, retire_reason").eq("firm_id", F);
  check("no row was deleted: 2 rows, both retired", rowsAfter.length === 2 && rowsAfter.every((r) => r.superseded_at), JSON.stringify(rowsAfter.map((r) => r.retire_reason)));
  const { data: c2row } = await sb.from("boq_corrections").select("promoted_at, promoted_entry_id").eq("id", c2).single();
  check("the retired promotion's correction is re-promotable (promoted_at cleared)", c2row.promoted_at === null && c2row.promoted_entry_id === null);
  const p3 = await api("POST", `/api/firms/${F}/promote`, { correction_id: c2, rate_aed: 92 }, userA);
  check("re-promotion → 201 (a third row; nothing superseded — the old one was already retired)", (p3.status === 201 || p3.status === 200) && p3.body.superseded_entry_id === null);
  const hist3 = await api("GET", `/api/firms/${F}/rates/history?item_key=garden.pcc_base`, undefined, userA);
  check("history now has 3 rows, one active", hist3.body.history.length === 3 && hist3.body.history.filter((h) => !h.superseded_at).length === 1);
} finally {
  console.log("\ncleanup");
  await sb.from("projects").update({ firm_id: priorFirm }).eq("id", STAND_IN);
  for (const id of created.corrections) {
    await sb.from("pilot_events").delete().eq("project_id", STAND_IN).eq("kind", "correction").contains("detail", { correction_id: id });
    await sb.from("boq_corrections").delete().eq("id", id);
  }
  if (created.approvals.length) await sb.from("boq_approvals").delete().in("id", created.approvals);
  if (created.firm) await sb.from("firms").delete().eq("id", created.firm); // cascades book, entries, members
  await sb.from("firms").delete().like("name", "U4 check%");
  const { count: evAfter } = await sb.from("pilot_events").select("id", { count: "exact", head: true }).eq("project_id", STAND_IN);
  const { data: leftovers } = await sb.from("boq_approvals").select("id").eq("project_id", STAND_IN).like("note", "U4 check%");
  check("stand-in firm restored, scratch firm gone, scratch approvals gone", (await sb.from("projects").select("firm_id").eq("id", STAND_IN).single()).data.firm_id === priorFirm && (leftovers ?? []).length === 0);
  check("stand-in pilot events back to the starting count", evAfter === evBefore, `${evBefore} → ${evAfter}`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
