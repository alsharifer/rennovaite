#!/usr/bin/env node
// =============================================================================
// scripts/k11-intake-name-check.mjs — K11 #1 live: the project an intake upload
// creates keeps the name the owner typed.
//
//   node --env-file=.env.local scripts/k11-intake-name-check.mjs [port]
//
// 1. the browser path, as the walkthrough did it: upload the plan FIRST, then
//    type the name, then Continue → the project row carries the typed name, is
//    no longer a draft, and Projects lists it by that name (the parse request
//    is held in the page — no model call);
// 2. an abandoned upload stays a draft: hidden from Projects, kept 24 h;
// 3. the API path: a name sent with the completion lands on the row.
// Scratch projects only (dev account "k11-owner"); removed at the end.
// =============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

const SCRIPT = "k11-intake-name-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
const f = devFetch("k11-owner", { script: SCRIPT });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

// A tiny real PDF (the magic bytes are what the upload checks).
const pdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "k11-intake-")), "ground-floor.pdf");
fs.writeFileSync(pdf, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

const NAME = `Jumeirah Parks Garden (K11 ${Date.now() % 100000})`;
const created = new Set();
const row = async (id) => (await sb.from("projects").select("id, name, city, draft_since, deleted_at").eq("id", id).single()).data;
const onProjects = async (b, text) => {
  await b.goto(`${BASE}/projects`, "[data-home]");
  return b.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
};

try {
  const b = await openBrowser({ who: "k11-owner", script: SCRIPT });
  try {
    await b.viewport(1440, 1000);
    // --- 1. upload first, name second, Continue ---------------------------------
    await b.goto(`${BASE}/project/new`, "[data-intake]");
    const { root } = await b.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await b.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[aria-label="Floor plan file"]' });
    await b.send("DOM.setFileInputFiles", { nodeId, files: [pdf] });
    check("the plan uploads before anything is named", await b.until("!!document.querySelector('[data-plan-ready]')", 30000));
    // The project the upload created: the newest project this account is a member of.
    const { data: mine } = await sb.from("project_members").select("project_id, projects!inner(created_at, name)").eq("user_id", b.userId).order("created_at", { ascending: false, referencedTable: "projects" });
    const latest = (mine ?? []).map((m) => ({ id: m.project_id, ...m.projects })).sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
    created.add(latest.id);
    const before = await row(latest.id);
    check("uploaded before naming: a DRAFT called Untitled", before.name === "Untitled" && !!before.draft_since, JSON.stringify(before));
    await onProjects(b, "");
    check("the draft is not on Projects", !(await b.evaluate(`!!document.querySelector('[data-project="${latest.id}"]')`)));

    await b.goto(`${BASE}/project/new`, "[data-intake]");
    // Fresh intake: upload, THEN type the name, then Continue (the parse is held in the page).
    const { root: r2 } = await b.send("DOM.getDocument", { depth: -1 });
    const { nodeId: n2 } = await b.send("DOM.querySelector", { nodeId: r2.nodeId, selector: 'input[aria-label="Floor plan file"]' });
    await b.send("DOM.setFileInputFiles", { nodeId: n2, files: [pdf] });
    await b.until("!!document.querySelector('[data-plan-ready]')", 30000);
    await b.evaluate(`(() => { const of = window.fetch; window.fetch = (u, o) => (String(u).includes("/api/parse-plan") ? new Promise(() => {}) : of(u, o)); })()`);
    const nameInput = await b.evaluate(`(() => { const i = [...document.querySelectorAll("input")].find((x) => x.placeholder?.startsWith("e.g. Our villa")); i.focus(); return !!i; })()`);
    check("the name field is there after the upload", nameInput);
    await b.send("Input.insertText", { text: NAME });
    await b.evaluate(`[...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue").click()`);
    await b.until("document.body.innerText.includes('Reading your plan') || !!document.querySelector('[data-reading-plan]')", 20000);
    const { data: mine2 } = await sb.from("project_members").select("project_id").eq("user_id", b.userId);
    const ids = (mine2 ?? []).map((m) => m.project_id).filter((id) => !created.has(id));
    const rows = await Promise.all(ids.map(row));
    const named = rows.find((p) => p?.name === NAME);
    if (named) created.add(named.id);
    for (const p of rows) if (p && p.name === "Untitled" && p.draft_since) created.add(p.id);
    check("Continue: the project carries the typed name and is not a draft", !!named && named.draft_since === null && named.city === "Dubai", JSON.stringify(named ?? rows));
    check("Projects lists it by the typed name", await onProjects(b, NAME));
    await b.screenshot("screenshots/k11/intake/1-projects-typed-name.png");
    await b.goto(`${BASE}/project/${named?.id}`, "main");
    check("the Overview shows the typed name", await b.evaluate(`document.body.innerText.includes(${JSON.stringify(NAME)})`));
    await b.screenshot("screenshots/k11/intake/2-overview-typed-name.png");
  } finally {
    await b.close();
  }

  // --- 3. the API path -------------------------------------------------------------
  const bytes = fs.readFileSync(pdf);
  const s = await (await f(`${BASE}/api/uploads/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "plan", size: bytes.byteLength, type: "application/pdf" }) })).json();
  await fetch(s.signedUrl, { method: "PUT", headers: { "content-type": s.contentType, "x-upsert": "false" }, body: bytes });
  const c = await (await f(`${BASE}/api/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: s.path, filename: "ground-floor.pdf", name: "Typed at upload (K11)", city: "Sharjah" }) })).json();
  if (c.project_id) created.add(c.project_id);
  const api = c.project_id ? await row(c.project_id) : null;
  check("a name sent with the completion lands on the row (still a draft until Continue)", api?.name === "Typed at upload (K11)" && api?.city === "Sharjah" && !!api?.draft_since, JSON.stringify(api));
  const fin = await (await f(`${BASE}/api/projects/${c.project_id}/intake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: null, city: "Sharjah" }) })).json();
  check("Continue with a blank name keeps it and ends the draft", fin.name === "Typed at upload (K11)" && (await row(c.project_id)).draft_since === null, JSON.stringify(fin));
  const other = devFetch("k11-stranger", { script: SCRIPT });
  const denied = await other(`${BASE}/api/projects/${c.project_id}/intake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "hijack" }) });
  check("a non-member cannot finish someone else's intake", denied.status === 403, String(denied.status));
} finally {
  for (const id of created) {
    const { data: files } = await sb.storage.from("plan-uploads").list(id);
    if (files?.length) await sb.storage.from("plan-uploads").remove(files.map((x) => `${id}/${x.name}`));
    await sb.from("pilot_events").delete().eq("project_id", id);
    await sb.from("projects").delete().eq("id", id);
  }
  console.log(`cleaned up ${created.size} scratch project(s)`);
}
console.log(failures === 0 ? "\nALL K11 INTAKE-NAME CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
