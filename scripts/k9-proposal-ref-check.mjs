#!/usr/bin/env node
// =============================================================================
// scripts/k9-proposal-ref-check.mjs — migration 054 live (K9): the proposal
// reference is a per-firm sequence, assigned once per project and reused.
//
//   node --env-file=.env.local scripts/k9-proposal-ref-check.mjs
//
// Scratch state only (two firms, three projects), all deleted at the end. It
// calls `assign_proposal_reference` straight through the service role — the
// route around it is covered by the unit tests; this proves the SQL.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

const { url, key } = resolveTarget({ script: "k9-proposal-ref-check", writes: true });
const sb = createClient(url, key);
const stamp = Date.now();
const firms = [];
const projects = [];
let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

async function firm(name) {
  const { data, error } = await sb.from("firms").insert({ name: `${name} ${stamp}`, created_by: "k9-proposal-ref-check" }).select("id").single();
  if (error) throw error;
  firms.push(data.id);
  return data.id;
}
async function project(firmId) {
  const { data, error } = await sb.from("projects").insert({ name: `K9 ref scratch ${stamp}`, city: "Dubai", currency: "AED", status: "draft", firm_id: firmId }).select("id").single();
  if (error) throw error;
  projects.push(data.id);
  return data.id;
}
async function assign(p, f, prefix) {
  const { data, error } = await sb.rpc("assign_proposal_reference", { p_project: p, p_firm: f, p_prefix: prefix });
  if (error) throw error;
  return data;
}

try {
  const a = await firm("K9 ref scratch A");
  const b = await firm("K9 ref scratch B");
  const p1 = await project(a);
  const p2 = await project(a);
  const p3 = await project(b);

  const r1 = await assign(p1, a, "KRA");
  check("first issue takes the firm's first number", r1 === "KRA-P-0001", r1);
  check("a re-issue of the same project reuses it (no number burnt)", (await assign(p1, a, "KRA")) === r1);
  const r2 = await assign(p2, a, "ZZZ");
  check("the firm's next project takes the next number, under the prefix it was first issued with", r2 === "KRA-P-0002", r2);
  const r3 = await assign(p3, b, "KRA");
  check("another firm has its own series (same prefix allowed)", r3 === "KRA-P-0001", r3);

  const { data: row } = await sb.from("project_proposals").select("reference, reference_firm_id, reference_assigned_at").eq("project_id", p1).single();
  check("stored on the project's proposal row (created when no setup was saved)", row?.reference === r1 && row.reference_firm_id === a && !!row.reference_assigned_at);
  const { data: fa } = await sb.from("firms").select("proposal_prefix, proposal_seq").eq("id", a).single();
  check("the firm keeps its prefix and last number", fa?.proposal_prefix === "KRA" && fa.proposal_seq === 2, JSON.stringify(fa));

  // The project moves to firm B: B's first issue for it comes from B's series.
  await sb.from("projects").update({ firm_id: b }).eq("id", p1);
  const moved = await assign(p1, b, "KRB");
  check("a project that changes firm is issued from the new firm's series", moved === "KRA-P-0002", moved);

  const { error: bad } = await sb.rpc("assign_proposal_reference", { p_project: p2, p_firm: "00000000-0000-0000-0000-000000000000", p_prefix: "XX" });
  check("an unknown firm is refused", !!bad, bad?.message ?? "no error");

  // Concurrency: ten projects issued at once take ten distinct numbers.
  const many = await Promise.all(Array.from({ length: 10 }, () => project(b)));
  const refs = await Promise.all(many.map((p) => assign(p, b, "KRB")));
  check("ten concurrent issues take ten distinct numbers", new Set(refs).size === 10, refs.sort().join(" "));
} finally {
  await sb.from("project_proposals").delete().in("project_id", projects);
  await sb.from("projects").delete().in("id", projects);
  await sb.from("firms").delete().in("id", firms);
  console.log(`cleaned up ${projects.length} projects, ${firms.length} firms`);
}
process.exit(failed ? 1 : 0);
