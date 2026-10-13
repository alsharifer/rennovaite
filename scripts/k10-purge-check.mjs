#!/usr/bin/env node
// =============================================================================
// scripts/k10-purge-check.mjs — K10 #1 live: delete is soft and permissioned,
// "Delete now" and the daily purge remove a project's Storage objects as well
// as its rows — and nobody else's.
//
//   node --env-file=.env.local scripts/k10-purge-check.mjs [port]
//
// Scratch state only: two scratch projects (service role), SYNTHETIC files in
// every bucket prefix a project writes to plus a control file under another
// project's id, a scratch firm with an admin and a plain member. Everything it
// makes is removed at the end, whatever happens.
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const { url, key } = resolveTarget({ script: "k10-purge-check", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
async function call(who, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...who.headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json, text };
}

const PREFIXES = (P) => [
  ["plan-uploads", `${P}/k10-synthetic.txt`],
  ["plan-uploads", `${P}/assets/k10-synthetic.txt`],
  ["renders", `projects/${P}/renders/k10-synthetic.txt`],
  ["renders", `projects/${P}/scene/k10-synthetic.txt`],
  ["packs", `projects/${P}/job/k10-synthetic.txt`],
  ["packs", `downloads/${P}/x/k10-synthetic.txt`],
  ["drawings", `projects/${P}/drawings/k10-synthetic.txt`],
  ["uploads", `pending/plan/${P}/u/k10-synthetic.txt`],
];
const exists = async (bucket, path) => {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const { data } = await sb.storage.from(bucket).list(dir);
  return (data ?? []).some((o) => o.name === path.slice(path.lastIndexOf("/") + 1));
};

const owner = await devSession("k10-owner", { script: "k10-purge-check" });
const admin = await devSession("k10-admin", { script: "k10-purge-check" });
const member = await devSession("k10-member", { script: "k10-purge-check" });
const P = randomUUID();
const Q = randomUUID(); // a firm project, deleted 31 days ago (the cron's case)
const CONTROL = randomUUID(); // never a project: its file must survive every purge
const NAME = "K10 purge check — scratch";
let firmId = null;
const uploaded = [];
try {
  // Setup: an owner project (creator = owner) and a firm project (admin + plain member).
  await sb.from("projects").insert([{ id: P, name: NAME, city: "Dubai", created_by: owner.userId }, { id: Q, name: `${NAME} (firm)`, city: "Dubai" }]).throwOnError();
  await sb.from("project_members").insert([{ project_id: P, user_id: owner.userId }, { project_id: P, user_id: member.userId }]).throwOnError();
  const { data: firm } = await sb.from("firms").insert({ name: `K10 scratch firm ${Date.now()}`, created_by: "k10-purge-check" }).select("id").single().throwOnError();
  firmId = firm.id;
  await sb.from("firm_members").insert([{ firm_id: firmId, user_id: admin.userId, role: "admin" }, { firm_id: firmId, user_id: member.userId, role: "member" }]).throwOnError();
  await sb.from("projects").update({ firm_id: firmId }).eq("id", Q).throwOnError();
  await sb.from("project_members").insert([{ project_id: Q, user_id: admin.userId }, { project_id: Q, user_id: member.userId }]).throwOnError();
  for (const [bucket, path] of [...PREFIXES(P), ...PREFIXES(Q), ["plan-uploads", `${CONTROL}/k10-synthetic.txt`], ["renders", `projects/${CONTROL}/renders/k10-synthetic.txt`]]) {
    const { error } = await sb.storage.from(bucket).upload(path, new Blob(["synthetic — k10-purge-check"], { type: "text/plain" }), { upsert: true, contentType: "text/plain" });
    if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
    uploaded.push([bucket, path]);
  }
  check("synthetic files written to every bucket prefix (2 projects + control)", uploaded.length === PREFIXES(P).length * 2 + 2, `${uploaded.length}`);

  // Permission: a non-admin firm member cannot delete a firm project; the plain member of an owner project cannot either.
  const m1 = await call(member, "DELETE", `/api/projects/${Q}`, { confirm_name: `${NAME} (firm)` });
  check("non-admin firm member → 403 not_allowed_to_delete with the menu's reason", m1.status === 403 && m1.body?.code === "not_allowed_to_delete" && m1.body?.error === "Only a firm admin can delete this project", `${m1.status} ${m1.body?.code}`);
  const m2 = await call(member, "DELETE", `/api/projects/${P}`, { confirm_name: NAME });
  check("a member who did not create an owner project → 403", m2.status === 403, `${m2.status} ${m2.body?.code}`);
  const pv = await call(member, "GET", `/api/projects/${Q}/delete-preview`);
  check("the preview tells the member why (disabled with reason)", pv.status === 200 && pv.body?.permission?.allowed === false && /firm admin/.test(pv.body?.permission?.reason ?? ""), `${pv.status}`);

  // Owner soft-deletes P, then Delete now — files gone, rows gone, control untouched.
  const d = await call(owner, "DELETE", `/api/projects/${P}`, { confirm_name: "  k10 PURGE check — SCRATCH " });
  check("the creator soft-deletes (name case-insensitive, trimmed)", d.status === 200, `${d.status} ${d.body?.code ?? ""}`);
  check("soft delete keeps the files (Recently deleted, 30 days)", (await Promise.all(PREFIXES(P).map(([b, p]) => exists(b, p)))).every(Boolean));
  const bad = await call(owner, "POST", `/api/projects/${P}/delete-now`, { confirm_name: "nope" });
  check("Delete now asks for the name again (422)", bad.status === 422, `${bad.status}`);
  const now = await call(owner, "POST", `/api/projects/${P}/delete-now`, { confirm_name: NAME });
  check("Delete now → 200 and reports the objects it removed", now.status === 200 && now.body?.objects === PREFIXES(P).length, `${now.status} objects=${now.body?.objects}`);
  const left = await Promise.all(PREFIXES(P).map(async ([b, p]) => ((await exists(b, p)) ? `${b}/${p}` : null)));
  check("every synthetic file of the project is gone from Storage", left.filter(Boolean).length === 0, left.filter(Boolean).join(", "));
  check("its row is gone (and its members with it)", !(await sb.from("projects").select("id").eq("id", P).maybeSingle()).data && ((await sb.from("project_members").select("project_id").eq("project_id", P)).data ?? []).length === 0);
  check("the control project's files are untouched", (await exists("plan-uploads", `${CONTROL}/k10-synthetic.txt`)) && (await exists("renders", `projects/${CONTROL}/renders/k10-synthetic.txt`)));

  // The daily job: Q deleted 31 days ago. Dry-run (the default) lists it and removes nothing.
  await sb.from("projects").update({ deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString(), deleted_by: admin.userId }).eq("id", Q).throwOnError();
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const cron = await call({ headers: { authorization: `Bearer ${secret}` } }, "GET", "/api/cron/projects-purge");
    const mine = (cron.body?.projects ?? []).find((p) => p.id === Q);
    check("the daily purge (dry-run) lists the 31-day-old project with its object count", cron.status === 200 && cron.body?.apply === false && mine?.objects === PREFIXES(Q).length, `${cron.status} ${JSON.stringify(mine)}`);
    check("dry-run removed nothing", (await Promise.all(PREFIXES(Q).map(([b, p]) => exists(b, p)))).every(Boolean));
    const anon = await call({ headers: {} }, "GET", "/api/cron/projects-purge");
    check("the purge refuses a caller without the cron secret", anon.status === 401, `${anon.status}`);
  } else check("CRON_SECRET set locally for the purge-route check", false, "skipped — set CRON_SECRET in .env.local");
  // The firm admin may Delete now; the plain member may not.
  const qm = await call(member, "POST", `/api/projects/${Q}/delete-now`, { confirm_name: `${NAME} (firm)` });
  check("Delete now: a non-admin firm member → 403", qm.status === 403, `${qm.status}`);
  const qa = await call(admin, "POST", `/api/projects/${Q}/delete-now`, { confirm_name: `${NAME} (firm)` });
  check("Delete now: the firm admin → 200, files gone", qa.status === 200 && (await Promise.all(PREFIXES(Q).map(([b, p]) => exists(b, p)))).every((x) => !x), `${qa.status}`);
} finally {
  for (const [bucket, path] of uploaded) await sb.storage.from(bucket).remove([path]);
  await sb.from("projects").delete().in("id", [P, Q]);
  if (firmId) await sb.from("firms").delete().eq("id", firmId);
  console.log("cleaned up scratch projects, firm and synthetic files");
}
console.log(failures === 0 ? "\nALL K10 PURGE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
