// =============================================================================
// scripts/k8-firm-scratch.mjs — a scratch FIRM project for the pipeline account,
// so the firm journey's pages can be checked (K8 Part 3: dark). DEV ONLY.
//
//   node --env-file=.env.local scripts/k8-firm-scratch.mjs seed|teardown [port]
//
// seed: a scratch firm (through POST /api/firms — the pipeline account becomes
// its member), a scratch project with a COPY of the demo villa's latest BoQ
// (the demo villa is read, never written), the pipeline account made its
// member, the firm attached through PATCH /api/projects/:id (both memberships
// checked by the route). Prints the routes to check. teardown removes it all.
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devFetch, grantProjectMembership } from "./lib/dev-auth.mjs";

const [cmd = "seed", port = "3098"] = process.argv.slice(2);
const { url, key } = resolveTarget({ script: "k8-firm-scratch", writes: true });
const sb = createClient(url, key);
const base = `http://localhost:${port}`;
const f = devFetch("pipeline", { script: "k8-firm-scratch" });
const FIRM = "K8 dark scratch firm";
const PROJECT = "K8 dark scratch project";
const DEMO = "6b5fda9d-e40f-4e16-940c-7a17d27ec5dc";

async function teardown() {
  const { data: ps } = await sb.from("projects").select("id").eq("name", PROJECT);
  for (const p of ps ?? []) {
    for (const t of ["boq_approvals", "reference_basis_acceptances", "project_proposals", "vendor_selections", "boqs", "project_members", "pilot_events"]) await sb.from(t).delete().eq("project_id", p.id);
    await sb.from("projects").delete().eq("id", p.id);
  }
  const firms = ((await (await f(`${base}/api/firms`)).json()).firms ?? []).filter((x) => x.name === FIRM);
  for (const x of firms) await f(`${base}/api/firms/${x.id}`, { method: "DELETE" });
}

await teardown();
if (cmd === "seed") {
  const r = await f(`${base}/api/firms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: FIRM }) });
  if (!r.ok) throw new Error(`firm: ${r.status} ${await r.text()}`);
  const firm = (await r.json()).firm;
  const demo = await sb.from("boqs").select("*").eq("project_id", DEMO).order("created_at", { ascending: false }).limit(1).single();
  if (demo.error) throw new Error(demo.error.message);
  const projectId = randomUUID();
  const ins = await sb.from("projects").insert({ id: projectId, name: PROJECT, city: "Dubai", currency: "AED", status: "draft" });
  if (ins.error) throw new Error(ins.error.message);
  const row = { ...demo.data };
  for (const k of ["id", "project_id", "created_at"]) delete row[k];
  const bi = await sb.from("boqs").insert({ ...row, project_id: projectId });
  if (bi.error) throw new Error(bi.error.message);
  const { data: u } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const pipeline = u.users.find((x) => x.email === "dev-scripts+pipeline@rennovaite.local");
  if (!pipeline) throw new Error("pipeline account missing");
  await grantProjectMembership(pipeline.id, [projectId], { script: "k8-firm-scratch" });
  const a = await f(`${base}/api/projects/${projectId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ firm_id: firm.id }) });
  if (!a.ok) throw new Error(`attach: ${a.status} ${await a.text()}`);
  const P = `/project/${projectId}`;
  console.log(["hub=" + P, "book=/firms/" + firm.id, "rates=" + P + "/rates", "firm-boq=" + P + "/boq", "firm-revisions=" + P + "/boq/revisions", "firm-documents=" + P + "/drawings", "proposal=" + P + "/proposal", "firm-spec=" + P + "/accessories"].join(" "));
} else console.log("teardown done");
