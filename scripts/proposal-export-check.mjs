#!/usr/bin/env node
// =============================================================================
// scripts/proposal-export-check.mjs — live check of L4 through the real routes.
//
//   node scripts/proposal-export-check.mjs [port]     (dev server: the `pack` launch
//                                                     config — PACK_EXPORT_ENABLED,
//                                                     DRAWINGS_ENABLED, GARDEN_PILOT_ENABLED)
//
// On the isolation stand-in with a SCRATCH firm (a real dev session as its member):
//   1. branding: display name, terms, a logo — members only;
//   2. the reference-basis gate: the stand-in's BoQ is priced from the market
//      reference (the scratch firm has no book), so
//        - the BoQ's basis route reports it and the proposal route refuses (409),
//        - a pack export WITH the proposal is BLOCKED on the reference_basis item,
//        - a non-member cannot accept (403); the member accepts (an event);
//   3. after acceptance the proposal exports through the pack: the firm's brand
//      and logo on the cover, the prepared-with mark on every page, no rate
//      provenance, the draft watermark, the leak scan green — or, when another
//      gate of the stand-in blocks the full pack, the proposal document is read
//      through a verification job and checked page by page.
//
// Writes only scratch state and removes it: the scratch firm (cascades its book,
// membership, acceptance rows), its logo object, the stand-in's firm_id and
// display_name (restored), the pack_exports rows + outputs this run created.
// Never touches Mudon, Villa 94 or Arabella. Refuses production.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";
import { verificationJobs } from "./lib/verification-job.mjs";

const PORT = process.argv[2] ?? "3098";
const BASE = `http://localhost:${PORT}`;
const STAND_IN = "12904f6d-87c1-4398-b245-b926f950bd97";
const BRAND = "Scratch Landscapes & Co.";
// Not a WORKING name (isWorkingName would block the gate on "scratch" / "test").
const NAME = "Courtyard Garden — Proposal Review Copy";

const { url, key } = resolveTarget({ script: "proposal-export-check", writes: true });
const sb = createClient(url, key);
const jobs = verificationJobs(sb, "proposal-export-check");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
async function api(method, path, body, auth, extra = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }), ...(auth?.headers ?? {}), ...(extra.headers ?? {}) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) };
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const LEAK = ["Newspace", "KAME", "Atrium", "Global Creation", "Laspinas"];

console.log("\n0. sessions");
const userA = await devSession("a", { script: "proposal-export-check" });
const userB = await devSession("b", { script: "proposal-export-check" });
check("two dev sessions", !!userA.token && !!userB.token);

const { data: prior } = await sb.from("projects").select("firm_id, display_name").eq("id", STAND_IN).single();
const created = { firm: null, logo: null, jobs: [] };
const { data: jobsBefore } = await sb.from("pack_exports").select("id").eq("project_id", STAND_IN);
const knownJobs = new Set((jobsBefore ?? []).map((j) => j.id));

try {
  console.log("\n1. branding — members only");
  const fa = await api("POST", "/api/firms", { name: "L4 check — firm (scratch)" }, userA);
  created.firm = fa.body.firm.id;
  const F = created.firm;
  const b401 = await api("GET", `/api/firms/${F}/branding`);
  const b403 = await api("PATCH", `/api/firms/${F}/branding`, { display_name: "x" }, userB);
  check("branding: anonymous → 401, non-member → 403", b401.status === 401 && b403.status === 403, `${b401.status} ${b403.status}`);
  const bp = await api("PATCH", `/api/firms/${F}/branding`, { display_name: BRAND, terms_text: "Valid for 30 days.\nPayment: 40% on order, 50% on completion, 10% on handover." }, userA);
  check("PATCH branding → brand + terms", bp.status === 200 && bp.body.branding.brand === BRAND && !!bp.body.branding.terms_text, `${bp.status} ${bp.body.error ?? ""}`);
  const fd = new FormData();
  fd.append("logo", new Blob([PNG], { type: "image/png" }), "logo.png");
  const lg = await api("POST", `/api/firms/${F}/branding`, fd, userA);
  check("POST logo → stored, public URL returned", lg.status === 201 && typeof lg.body.branding?.logo_url === "string", `${lg.status} ${lg.body.error ?? ""}`);
  if (lg.body.branding?.logo_url) created.logo = new URL(lg.body.branding.logo_url).pathname.split("/plan-uploads/")[1];
  const bad = new FormData();
  bad.append("logo", new Blob([Buffer.from("not an image")], { type: "text/plain" }), "x.txt");
  check("a non-image logo → 422", (await api("POST", `/api/firms/${F}/branding`, bad, userA)).status === 422);

  console.log("\n2. the reference-basis gate — refusal path");
  const assign = await api("PATCH", `/api/projects/${STAND_IN}`, { firm_id: F, display_name: NAME }, userA);
  check("stand-in assigned to the scratch firm with a client-facing name", assign.status === 200, `${assign.status} ${assign.body.error ?? ""}`);
  const gen = await api("POST", "/api/generate-boq", { project_id: STAND_IN }, userA);
  check("BoQ regenerated on the stand-in (a revision this firm has not accepted)", gen.status === 200 && !gen.body.error, `${gen.status} ${gen.body.error ?? ""}`);
  const rb401 = await api("GET", `/api/projects/${STAND_IN}/reference-basis`);
  check("GET reference-basis anonymous → 401", rb401.status === 401);
  const rb = await api("GET", `/api/projects/${STAND_IN}/reference-basis`, undefined, userA);
  check("the BoQ is priced from the market reference and the proposal is refused", rb.status === 200 && rb.body.boq?.basis?.reference_lines > 0 && rb.body.verdict?.ok === false, `${rb.body.boq?.basis?.basis} · ${rb.body.boq?.basis?.reference_lines} ref lines · book ${rb.body.firm?.book_status}`);
  const pj = await api("GET", `/api/projects/${STAND_IN}/proposal?format=json`);
  check("proposal?format=json (open) says not ready", pj.status === 200 && pj.body.ready === false && pj.body.firm?.brand === BRAND);
  const vh = await jobs.headers(STAND_IN);
  const p409 = await api("GET", `/api/projects/${STAND_IN}/proposal?format=pages`, undefined, undefined, { headers: vh });
  check("proposal pages through a pack job → 409 proposal_not_ready", p409.status === 409 && p409.body.code === "proposal_not_ready", `${p409.status} ${p409.body.code}`);
  const pre = await api("GET", `/api/projects/${STAND_IN}/pack-export?proposal=1`);
  const rbItem = pre.body.checklist?.find((c) => c.key === "reference_basis");
  check("export gate checklist (proposal) names the reference-basis refusal with the fix link", !!rbItem && rbItem.ok === false && rbItem.fix?.href === `/project/${STAND_IN}/boq#reference-basis` && rbItem.items?.length === 2, JSON.stringify(rbItem?.items));
  check("…and the branding item says what the cover prints", pre.body.checklist?.find((c) => c.key === "branding")?.detail?.includes(BRAND));
  const preNo = await api("GET", `/api/projects/${STAND_IN}/pack-export`);
  check("without ?proposal=1 the checklist has no proposal items", !preNo.body.checklist?.some((c) => c.key === "reference_basis"));
  const startBlocked = await api("POST", `/api/projects/${STAND_IN}/pack-export`, { proposal: true, renders: "cached" });
  check("POST pack-export { proposal: true } → 202", startBlocked.status === 202, `${startBlocked.status}`);
  created.jobs.push(startBlocked.body.job_id);
  const blocked = await waitJob(startBlocked.body.job_id);
  check("the export is BLOCKED before any document, on reference_basis", blocked.status === "blocked" && blocked.checklist?.some((c) => c.key === "reference_basis" && !c.ok), `${blocked.status}: ${(blocked.checklist ?? []).filter((c) => !c.ok).map((c) => c.key).join(", ") || "-"}`);
  const boqHtml = await (await fetch(`${BASE}/project/${STAND_IN}/boq`, { headers: userA.headers })).text();
  check("the BoQ page shows the banner and the accept control", boqHtml.includes("priced from market reference — review rates before client use") && boqHtml.includes('data-basis-status="open"'));

  console.log("\n3. acceptance — a stated choice, recorded");
  const boqId = rb.body.boq.id;
  const a403 = await api("POST", `/api/projects/${STAND_IN}/reference-basis`, { boq_id: boqId }, userB);
  check("a non-member cannot accept → 403", a403.status === 403 && a403.body.code === "not_a_member", `${a403.status}`);
  const acc = await api("POST", `/api/projects/${STAND_IN}/reference-basis`, { boq_id: boqId, note: "L4 check — client agreed to market pricing" }, userA);
  check("the member accepts → 201, an event for this revision", acc.status === 201 && acc.body.acceptance?.boq_id === boqId && acc.body.acceptance?.reference_lines === rb.body.boq.basis.reference_lines, `${acc.status} ${acc.body.error ?? ""}`);
  const rb2 = await api("GET", `/api/projects/${STAND_IN}/reference-basis`, undefined, userA);
  check("the gate now passes as `accepted`", rb2.body.verdict?.ok === true && rb2.body.verdict?.reason === "accepted");
  const boqHtml2 = await (await fetch(`${BASE}/project/${STAND_IN}/boq`, { headers: userA.headers })).text();
  check("the BoQ page shows the acceptance", boqHtml2.includes('data-basis-status="accepted"'));

  console.log("\n4. the proposal document");
  const pages = await api("GET", `/api/projects/${STAND_IN}/proposal?format=pages`, undefined, undefined, { headers: vh });
  check("proposal pages through a pack job → 200", pages.status === 200 && pages.body.pages?.length >= 2, `${pages.status} ${pages.body.pages?.length ?? 0} pages ${pages.body.error ?? ""}`);
  const pp = pages.body.pages ?? [];
  const all = pp.join("\n");
  const text = pp.map((p) => p.replace(/<[^>]+>/g, " ")).join(" ");
  check("cover: the firm's brand and logo", !!pp[0]?.includes('data-proposal-cover="true"') && pp[0].includes("Scratch Landscapes &amp; Co.") && pp[0].includes('data-logo="present"'));
  check("every page: the prepared-with mark; no RennovAIte heading", pp.every((p) => p.includes('data-prepared-with="true"')) && !pp.some((p) => /font-size="(?:[4-9]|\d{2})[\d.]*"[^>]*>[^<]*RennovAIte/.test(p)));
  check("no rate provenance on the proposal", !/market reference|contractor rate book|indicative rate|QS to price|actual_transaction/i.test(text));
  check("leak scan: no contractor / reference identity", !LEAK.some((n) => all.includes(n)), LEAK.filter((n) => all.includes(n)).join(", "));
  check("the contract sum is the BoQ's grand total", pp[0]?.includes(`data-grand-total="${gen.body.grand_total_aed}"`), `${gen.body.grand_total_aed}`);
  check("terms page present (the firm's words)", all.includes('data-terms="true"') && text.includes("Valid for 30 days"));
  const isDraft = boqHtml2.includes("data-boq-draft");
  if (isDraft) check("draft watermark carries over to every proposal page", pp.every((p) => p.includes('data-boq-draft="true"')));
  const pdf = await fetch(`${BASE}/api/projects/${STAND_IN}/proposal`, { headers: vh });
  check("proposal PDF → application/pdf", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && (await pdf.arrayBuffer()).byteLength > 10_000, `${pdf.status}`);

  console.log("\n5. the proposal through the full pack export");
  const start = await api("POST", `/api/projects/${STAND_IN}/pack-export`, { proposal: true, renders: "cached" });
  created.jobs.push(start.body.job_id);
  const job = await waitJob(start.body.job_id);
  const rbAfter = job.checklist?.find((c) => c.key === "reference_basis");
  check("the gate's reference_basis item passes after acceptance — the pack's own regeneration kept the accepted pricing", !!rbAfter && rbAfter.ok === true, rbAfter?.detail);
  if (job.status === "passed") {
    check("pack passed: a proposal PDF is among the downloads", job.downloads?.some((d) => d.name.endsWith("-proposal.pdf")), job.downloads?.map((d) => d.name).join(", "));
    check(`all ${job.checks_total} printed checks passed (incl. the proposal's)`, job.failed_checks?.length === 0, job.failed_checks?.map((c) => c.label).join("; "));
  } else {
    const open = (job.checklist ?? []).filter((c) => !c.ok).map((c) => c.key);
    check(`full pack ${job.status} on the stand-in — the proposal gate itself held (blocked by: ${open.join(", ") || job.failed_checks?.map((c) => c.label).join("; ")})`, !open.includes("reference_basis") && !open.includes("proposal_firm"));
  }
} finally {
  console.log("\ncleanup");
  await sb.from("projects").update({ firm_id: prior.firm_id ?? null, display_name: prior.display_name ?? null }).eq("id", STAND_IN);
  await jobs.close();
  for (const id of created.jobs) {
    const { data: objs } = await sb.storage.from("packs").list(`projects/${STAND_IN}/${id}`);
    if (objs?.length) await sb.storage.from("packs").remove(objs.map((o) => `projects/${STAND_IN}/${id}/${o.name}`));
    await sb.from("pack_exports").delete().eq("id", id);
  }
  // The verification job rows this run opened (closed as released-nothing) are this run's too.
  await sb.from("pack_exports").delete().eq("project_id", STAND_IN).contains("options", { purpose: "proposal-export-check" });
  if (created.logo) await sb.storage.from("plan-uploads").remove([created.logo]);
  if (created.firm) await sb.from("firms").delete().eq("id", created.firm);
  await sb.from("firms").delete().like("name", "L4 check%");
  const { data: after } = await sb.from("projects").select("firm_id, display_name").eq("id", STAND_IN).single();
  const { data: jobsAfter } = await sb.from("pack_exports").select("id").eq("project_id", STAND_IN);
  check("stand-in firm + name restored; this run's jobs removed", after.firm_id === (prior.firm_id ?? null) && after.display_name === (prior.display_name ?? null) && (jobsAfter ?? []).every((j) => knownJobs.has(j.id)));
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

async function waitJob(jobId) {
  for (let i = 0; i < 160; i++) {
    // The job runs in the route's after(); a dev server busy rasterising may drop a
    // poll connection — a transient fetch failure is retried, not fatal.
    const r = await api("GET", `/api/projects/${STAND_IN}/pack-export/${jobId}`).catch((e) => ({ status: 0, body: { error: String(e?.cause?.code ?? e) } }));
    if (r.body.status && r.body.status !== "running" && r.body.status !== "queued") return r.body;
    await new Promise((res) => setTimeout(res, 2500));
  }
  return { status: "timeout", checklist: [], failed_checks: [] };
}
