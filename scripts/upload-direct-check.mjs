// =============================================================================
// scripts/upload-direct-check.mjs [port] — H9 live: direct-to-storage uploads
// and signed downloads, against a running dev server and the REAL Storage.
//
//   node scripts/upload-direct-check.mjs 3098
//
// Server: the `pack` launch config (PACK_EXPORT_ENABLED + DRAWINGS_ENABLED) so
// the render-pack route answers a verification job. Dev only (target guard).
//
//   1. a 6 MB plan (the canonical first-floor plan, padded after %%EOF) —
//      sign → PUT straight to Storage → complete → parse-plan succeeds
//   2. the 16.9 MB canonical master-bedroom photo as a project photo
//   3. 21 MB plan → 413 at sign, nothing minted
//   4. declared 1 MB / actual 21 MB room photo → complete 413, object deleted
//   5. an .exe renamed .pdf → complete 415, object deleted
//   6. a PUT above the bucket's own cap is refused by Storage
//   7. a second account: sign for the first's project → 403; complete the
//      first's path → 403
//   8. the reference garden's render pack + drawing set (> 4.5 MB) → 302 to
//      a signed URL for one object, minutes-lived → the PDF
//
// Scratch state only: the project it creates is deleted with its objects;
// the verification job releases nothing.
// =============================================================================

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devFetch } from "./lib/dev-auth.mjs";
import { verificationJobs } from "./lib/verification-job.mjs";

const PORT = process.argv[2] ?? "3098";
const BASE = `http://localhost:${PORT}`;
/** The reference garden (dev): its render pack and drawing set exceed the inline cap. */
const REFERENCE = "8d460645-9450-4072-af41-b37adf8512a0";
const MiB = 1024 * 1024;
const SCRIPT = "upload-direct-check";

const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const a = devFetch("h9a", { script: SCRIPT });
const b = devFetch("h9b", { script: SCRIPT });
const pipeline = devFetch("pipeline", { script: SCRIPT, projects: [REFERENCE] });

let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const json = async (r) => r.json().catch(() => null);
const post = (f, path, body) => f(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function sign(f, body) {
  const r = await post(f, "/api/uploads/sign", body);
  return { status: r.status, body: await json(r) };
}
/** The browser's PUT: straight to Storage, never through our server. */
async function put(signedUrl, bytes, contentType) {
  const t = Date.now();
  const r = await fetch(signedUrl, { method: "PUT", headers: { "content-type": contentType, "x-upsert": "false" }, body: bytes });
  return { status: r.status, ms: Date.now() - t, text: r.ok ? "" : await r.text() };
}
const pendingExists = async (path) => {
  const dir = path.split("/").slice(0, -1).join("/");
  const { data } = await admin.storage.from("uploads").list(dir);
  return (data ?? []).some((o) => `${dir}/${o.name}` === path);
};
const pad = (head, size) => {
  const out = new Uint8Array(size);
  out.set(head);
  const filler = new TextEncoder().encode("\n% H9 synthetic padding after %%EOF\n");
  for (let i = head.length; i < size; i++) out[i] = filler[(i - head.length) % filler.length];
  return out;
};

let projectId = null;
try {
  // --- 1. a 6 MB plan through intake ----------------------------------------------
  const plan = pad(readFileSync("assets/villa-plan-first-floor.pdf"), 6 * MiB);
  const s1 = await sign(a, { kind: "plan", size: plan.byteLength, type: "application/pdf", filename: "villa-plan-6mb.pdf" });
  check(s1.status === 200 && /^pending\/plan\/new\//.test(s1.body?.path ?? ""), "sign a 6 MB plan", `${s1.status} ${s1.body?.path ?? JSON.stringify(s1.body)}`);
  check(new URL(s1.body.signedUrl).host === new URL(url).host, "the signed URL is Storage, not our server", new URL(s1.body.signedUrl).host);
  const p1 = await put(s1.body.signedUrl, plan, s1.body.contentType);
  check(p1.status === 200, "PUT 6 MB straight to Storage", `${p1.status} in ${p1.ms} ms ${p1.text}`);
  const c1r = await post(a, "/api/uploads/complete", { path: s1.body.path, filename: "villa-plan-6mb.pdf" });
  const c1 = await json(c1r);
  projectId = c1?.project_id ?? null;
  check(c1r.status === 201 && !!projectId && /^[0-9a-f]{64}$/.test(c1?.sha256 ?? ""), "complete → a new project + plan", `${c1r.status} project ${projectId} sha256 ${c1?.sha256?.slice(0, 12)}…`);
  check(!(await pendingExists(s1.body.path)), "the pending object moved out of pending/");
  const parse = await post(a, "/api/parse-plan", { plan_id: c1.plan_id });
  const pj = await json(parse);
  const { count: rooms } = await admin.from("rooms").select("id", { count: "exact", head: true }).eq("plan_id", c1.plan_id);
  check(parse.ok && pj?.success === true && (rooms ?? 0) > 0, "parse-plan on the 6 MB plan succeeds", `${parse.status}, ${rooms} rooms`);

  // --- 2. the 16.9 MB canonical photo as a project photo ---------------------------
  const photo = readFileSync("assets/master-bed-before.jpg");
  const s2 = await sign(a, { kind: "project_asset", project_id: projectId, size: photo.byteLength, type: "image/jpeg", filename: "master-bed-before.jpg", asset_kind: "photo" });
  const p2 = await put(s2.body.signedUrl, photo, s2.body.contentType);
  const c2r = await post(a, "/api/uploads/complete", { path: s2.body.path, asset_kind: "photo", source: "intake", filename: "master-bed-before.jpg" });
  const c2 = await json(c2r);
  check(s2.status === 200 && p2.status === 200 && c2r.status === 201 && !!c2?.asset_id, `a ${(photo.byteLength / MiB).toFixed(1)} MB photo lands in the asset library`, `sign ${s2.status}, PUT ${p2.status} in ${p2.ms} ms, complete ${c2r.status}`);

  // --- 3. 21 MB plan refused at sign -------------------------------------------------
  const s3 = await sign(a, { kind: "plan", size: 21 * MiB, type: "application/pdf", filename: "big.pdf" });
  check(s3.status === 413 && s3.body?.code === "payload_too_large" && s3.body?.kind === "plan" && !s3.body?.signedUrl, "21 MB plan → 413 at sign, no URL", JSON.stringify(s3.body));

  // --- 4. declared 1 MB, actual 21 MB ------------------------------------------------
  const big = pad(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 21 * MiB);
  const { data: room } = await admin.from("rooms").select("id").eq("plan_id", c1.plan_id).limit(1).maybeSingle();
  const s4 = await sign(a, { kind: "room_photo", project_id: projectId, size: 1 * MiB, type: "image/png", filename: "small.png" });
  const p4 = await put(s4.body.signedUrl, big, s4.body.contentType);
  const c4r = await post(a, "/api/uploads/complete", { path: s4.body.path, room_id: room?.id });
  const c4 = await json(c4r);
  check(p4.status === 200 && c4r.status === 413 && c4?.code === "payload_too_large" && c4?.kind === "room_photo", "declared 1 MB / actual 21 MB → 413 at complete", `${c4r.status} ${JSON.stringify(c4)}`);
  check(!(await pendingExists(s4.body.path)), "…and the object is deleted");

  // --- 5. .exe renamed .pdf ----------------------------------------------------------
  const exe = pad(new TextEncoder().encode("MZ\x90\x00\x03\x00\x00\x00This program cannot be run in DOS mode."), 64 * 1024);
  const s5 = await sign(a, { kind: "plan", size: exe.byteLength, type: "application/pdf", filename: "plan.pdf" });
  await put(s5.body.signedUrl, exe, s5.body.contentType);
  const c5r = await post(a, "/api/upload", { path: s5.body.path });
  const c5 = await json(c5r);
  check(c5r.status === 415 && c5?.code === "unsupported_type", ".exe renamed .pdf → 415 (via the legacy /api/upload path)", JSON.stringify(c5));
  check(!(await pendingExists(s5.body.path)), "…and the object is deleted");

  // --- 6. Storage's own cap ----------------------------------------------------------
  const s6 = await sign(a, { kind: "project_asset", project_id: projectId, size: 1 * MiB, type: "application/pdf", filename: "x.pdf", asset_kind: "other" });
  const p6 = await put(s6.body.signedUrl, pad(new TextEncoder().encode("%PDF-1.7\n"), 26 * MiB), s6.body.contentType);
  check(p6.status >= 400, "a PUT above the bucket cap is refused by Storage itself", `${p6.status} ${p6.text.slice(0, 120)}`);

  // --- 7. a second account -----------------------------------------------------------
  const s7 = await sign(b, { kind: "project_asset", project_id: projectId, size: MiB, type: "image/jpeg", filename: "x.jpg", asset_kind: "photo" });
  check(s7.status === 403, "a second account cannot sign for the first's project", `${s7.status} ${s7.body?.code}`);
  const s7b = await sign(a, { kind: "plan", size: MiB, type: "application/pdf" });
  await put(s7b.body.signedUrl, pad(new TextEncoder().encode("%PDF-1.7\n"), MiB), "application/pdf");
  const c7r = await post(b, "/api/uploads/complete", { path: s7b.body.path });
  check(c7r.status === 403 && (await json(c7r))?.code === "upload_not_yours", "a second account cannot complete the first's path", String(c7r.status));
  await admin.storage.from("uploads").remove([s7b.body.path]);
  const anon = await fetch(`${BASE}/api/uploads/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "plan", size: 10, type: "application/pdf" }) });
  check(anon.status === 401, "no session → 401", String(anon.status));

  // --- 8. documents > 4.5 MB by redirect --------------------------------------------
  // The reference garden's render pack (~7.3 MB) and drawing set (~4.6 MB) are
  // both over the inline cap; read through a verification job (releases nothing).
  const jobs = verificationJobs(admin, "H9 signed-download check");
  try {
    const headers = { ...(await jobs.headers(REFERENCE)), authorization: await pipeline.authorization() };
    for (const doc of ["render-pack", "drawings?format=pdf&sheet=all"]) {
      const r8 = await fetch(`${BASE}/api/projects/${REFERENCE}/${doc}`, { headers, redirect: "manual" });
      const loc = r8.headers.get("location") ?? "";
      const signedOk = r8.status === 302 && new URL(loc).host === new URL(url).host && /\/object\/sign\/packs\/downloads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/?]+\.pdf\?token=/.test(loc);
      check(signedOk, `${doc} → 302 to a signed URL for one object`, `${r8.status} …${loc.split("?")[0].slice(-60)}`);
      if (r8.status !== 302) continue;
      const exp = JSON.parse(Buffer.from(new URL(loc).searchParams.get("token").split(".")[1], "base64url").toString()).exp;
      check(exp - Date.now() / 1000 <= 300, "…expiring in minutes", `${Math.round(exp - Date.now() / 1000)} s`);
      // What the pack-export transport does: the same request, redirects followed.
      const dl = await fetch(`${BASE}/api/projects/${REFERENCE}/${doc}`, { headers });
      const bytes = new Uint8Array(await dl.arrayBuffer());
      check(dl.ok && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-" && bytes.byteLength > 4 * MiB,"…and the transport's followed request gets the PDF", `${(bytes.byteLength / 1e6).toFixed(2)} MB`);
    }
    const noAuth = await fetch(`${BASE}/api/projects/${REFERENCE}/render-pack`, { headers: { "x-pack-export-job": headers["x-pack-export-job"] }, redirect: "manual" });
    check(noAuth.status === 401, "the gate stays server-side: no session, no redirect", String(noAuth.status));
  } finally {
    await jobs.close();
  }
} finally {
  if (projectId) {
    const { data: objs } = await admin.storage.from("plan-uploads").list(projectId, { limit: 100 });
    const { data: assets } = await admin.storage.from("plan-uploads").list(`${projectId}/assets`, { limit: 100 });
    const paths = [...(objs ?? []).filter((o) => o.id).map((o) => `${projectId}/${o.name}`), ...(assets ?? []).map((o) => `${projectId}/assets/${o.name}`)];
    if (paths.length) await admin.storage.from("plan-uploads").remove(paths);
    const { error } = await admin.from("projects").delete().eq("id", projectId);
    console.log(`cleanup: removed ${paths.length} objects, project ${error ? `NOT deleted (${error.message})` : "deleted"}`);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
