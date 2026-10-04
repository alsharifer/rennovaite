#!/usr/bin/env node
// =============================================================================
// scripts/quote-import-check.mjs — template → upload → review → accept, live (U3).
//
//   node scripts/quote-import-check.mjs [port] [--shots=screenshots/u3]
//
// Through the real routes on the dev server, as an authenticated member
// (scripts/lib/dev-auth.mjs): download the template, fill it, upload it,
// confirm suggestions, accept — and prove the rates landed in the book with
// quote provenance and price a BoQ under the constant label. Then re-import
// the same reference and prove idempotence with history. A second account is
// refused throughout. With --shots, headless Chrome (signed in via the session
// cookie) captures the review screen before and after accept.
//
// Writes only scratch state (one firm "U3 quote check — …") and removes it.
// Refuses production.
// =============================================================================
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devSession, grantProjectMembership } from "./lib/dev-auth.mjs";
import { readXlsx, writeXlsx } from "../lib/quotes/xlsx.ts";

const PORT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "3098";
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, "").split("=")));
const BASE = `http://localhost:${PORT}`;
const SHOTS = opt.shots ?? null;
const STAND_IN = "12904f6d-87c1-4398-b245-b926f950bd97";

const { url, key } = resolveTarget({ script: "quote-import-check", writes: true });
const sb = createClient(url, key);
let failures = 0;
const check = (label, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "  ok " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const me = await devSession("quote", { script: "quote-import-check" });
const other = await devSession("other", { script: "quote-import-check" });
// H5: the project routes answer members only — this check's accounts are made
// members of the projects it works on (service role, like project-member-add),
// and exactly those rows are removed again at cleanup.
const memberships = [await grantProjectMembership(me.userId, [STAND_IN], { script: "quote-import-check" })];
const api = async (method, p, body, auth = me, raw = false) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { ...(raw ? {} : { "content-type": "application/json" }), ...(auth?.headers ?? {}) }, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, headers: res.headers, body: raw ? await res.arrayBuffer() : await res.json().catch(() => ({})) };
};
const upload = async (firmId, bytes, meta, auth = me) => {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), meta.filename ?? "quote.xlsx");
  for (const [k, v] of Object.entries(meta)) if (k !== "filename") fd.append(k, String(v));
  const res = await fetch(`${BASE}/api/firms/${firmId}/quotes`, { method: "POST", headers: auth?.headers ?? {}, body: fd });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const { data: standIn } = await sb.from("projects").select("firm_id").eq("id", STAND_IN).single();
const priorFirm = standIn.firm_id ?? null;
let firmId = null;
let chrome = null, profile = null;
try {
  console.log("\n1. a firm, and the template");
  const f = await api("POST", "/api/firms", { name: `U3 quote check — ${Date.now()}` });
  check("firm created (member)", f.status === 201);
  firmId = f.body.firm.id;
  const anon = await fetch(`${BASE}/api/firms/${firmId}/quotes/template`);
  check("template anonymous → 401", anon.status === 401);
  const asOther = await api("GET", `/api/firms/${firmId}/quotes/template`, undefined, other, true);
  check("template as the other account → 403", asOther.status === 403);
  const t = await api("GET", `/api/firms/${firmId}/quotes/template`, undefined, me, true);
  const template = readXlsx(new Uint8Array(t.body));
  check("template downloads: Quote / How to fill / Vocabulary sheets", t.status === 200 && template.map((s) => s.name).join(",") === "Quote,How to fill,Vocabulary", `${template[2]?.rows.length ?? 0} vocabulary rows`);

  console.log("\n2. fill it and upload");
  const filled = writeXlsx([{ name: "Quote", rows: [
    template[0].rows[0],
    ["garden.pcc_base", "PCC base 100mm under paving", 64, "m2", 98.5, "AED"],
    ["", "Artificial grass supply (35mm)", 50, "m2", 82, "AED"],
    ["", "Aluminium louvred pergola 3.5 x 3.5 m", 1, "no", 24500, "AED"],
    ["", "Boundary wall lights, IP65", 6, "no", 95, "USD"],
    ["", "Irrigation controller programming", 1, "lump", "on request", "AED"],
    ["", "Site sign board 2 x 1 m", 1, "no", 1200, "AED"],
  ] }]);
  const meta = { supplier_label: "Scratch Supplier LLC", supplier_role: "supplier", quote_ref: "U3-CHECK-001", quote_date: "2026-09-20", valid_until: "2026-12-31", currency: "AED", vat_treatment: "excl", rates_are: "net", discount_pct: "0" };
  const xo = await upload(firmId, filled, meta, other);
  check("upload as the other account → 403", xo.status === 403, `${xo.status}`);
  const up = await upload(firmId, filled, meta);
  check("upload → 201, quote in review, 6 lines, nothing confirmed", up.status === 201 && up.body.quote?.status === "review" && up.body.lines?.length === 6 && up.body.lines.every((l) => l.item_key === null), JSON.stringify(up.body.summary));
  const quoteId = up.body.quote.id;
  const held = up.body.lines.filter((l) => l.hold_reason);
  check("USD, unreadable-rate and unmatched lines are HELD with reasons", held.length === 3, held.map((l) => l.hold_reason).join(" | "));
  const before = await api("GET", `/api/firms/${firmId}/rates`);
  check("no rate entered the book on upload", before.body.entries.length === 0);

  if (SHOTS) {
    console.log("\n   screenshots of the review screen (headless Chrome, session cookie)");
    const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
    const port = 9300 + Math.floor(Math.random() * 500);
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "u3-cdp-"));
    chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,1100", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
    let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {} }
    const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let seq = 0; const pending = new Map();
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
    await send("Page.enable"); await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    for (const c of me.cookies) await send("Network.setCookie", { name: c.name, value: c.value, domain: "localhost", path: "/" });
    const goto = async (u) => { await send("Page.navigate", { url: u }); for (let i = 0; i < 100; i++) { await sleep(200); if ((await evaluate("document.readyState")) === "complete") break; } await sleep(1200); };
    const shot = async (name) => { fs.mkdirSync(SHOTS, { recursive: true }); const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, "base64")); console.log(`       shot → ${SHOTS}/${name}.png`); };
    await goto(`${BASE}/firms/${firmId}/quotes/${quoteId}`);
    check("review page renders for the member", await evaluate(`!!document.querySelector('[data-quote-id]')`));
    check("held lines show their reasons on screen", (await evaluate(`document.querySelectorAll('[data-testid="hold-reason"]').length`)) >= 3);
    await shot("u3-01-review-before");
    globalThis.__shot = { goto, shot, evaluate, ws };
  }

  console.log("\n3. confirm suggestions, accept");
  const conf = await api("POST", `/api/firms/${firmId}/quotes/${quoteId}`, { action: "confirm_suggestions", min_score: 0.5 });
  check("confirm suggestions ≥ 0.5 (an explicit act)", conf.status === 200 && conf.body.confirmed >= 3, `${conf.body.confirmed} confirmed`);
  const q1 = await api("GET", `/api/firms/${firmId}/quotes/${quoteId}`);
  const matched = q1.body.lines.filter((l) => l.status === "matched");
  check("matched lines carry the vocabulary unit/kind and a derived rate", matched.every((l) => l.unit && l.kind && l.rate_aed != null), matched.map((l) => `${l.item_key}=${l.rate_aed}/${l.unit}`).join(" "));
  const acc = await api("POST", `/api/firms/${firmId}/quotes/${quoteId}`, { action: "accept" });
  check("accept → rates in the book, held lines stay held", acc.status === 200 && acc.body.accepted === matched.length && acc.body.held === 6 - matched.length, JSON.stringify({ accepted: acc.body.accepted, held: acc.body.held, rejected: acc.body.rejected }));
  const entries = (await api("GET", `/api/firms/${firmId}/rates`)).body.entries;
  check("every entry is origin quote_import and traced to this quote", entries.length === acc.body.accepted && entries.every((e) => e.origin === "quote_import" && e.quote_id === quoteId));
  const again = await api("POST", `/api/firms/${firmId}/quotes/${quoteId}`, { action: "accept" });
  check("accept twice → 409", again.status === 409);
  if (globalThis.__shot) { await globalThis.__shot.goto(`${BASE}/firms/${firmId}/quotes/${quoteId}`); await globalThis.__shot.shot("u3-02-review-accepted"); await globalThis.__shot.goto(`${BASE}/firms/${firmId}`); await globalThis.__shot.shot("u3-03-book-with-quote-rates"); }

  console.log("\n4. the BoQ prices from it, under the constant label");
  await api("PATCH", `/api/projects/${STAND_IN}`, { firm_id: firmId });
  const dry = await api("POST", "/api/generate-boq", { project_id: STAND_IN, dry_run: true });
  const pcc = dry.body.boq.sections.flatMap((s) => s.lines).find((l) => l.rule_id === "GL-04");
  check("PCC resolves at firm_private from the quote (98.5)", pcc?.rate_tier === "firm_private" && pcc.rate_aed === 98.5, `${pcc?.rate_aed} · ${pcc?.vendor_or_source}`);
  check("the line's source is the constant quote label", pcc?.vendor_or_source === "contractor rate book (supplier quotation)");
  const doc = JSON.stringify(dry.body);
  check("supplier label and quote reference appear nowhere in the BoQ", !doc.includes("Scratch Supplier") && !doc.includes("U3-CHECK-001"));

  console.log("\n5. re-import the same reference → version 2, history kept");
  const filled2 = writeXlsx([{ name: "Quote", rows: [template[0].rows[0], ["garden.pcc_base", "PCC base 100mm under paving", 64, "m2", 101, "AED"]] }]);
  const up2 = await upload(firmId, filled2, { ...meta, filename: "quote-revised.xlsx" });
  check("re-import → version 2 naming v1", up2.status === 201 && up2.body.quote.version === 2 && up2.body.quote.supersedes_quote_id === quoteId);
  await api("POST", `/api/firms/${firmId}/quotes/${up2.body.quote.id}`, { action: "confirm_suggestions", min_score: 0.5 });
  const acc2 = await api("POST", `/api/firms/${firmId}/quotes/${up2.body.quote.id}`, { action: "accept" });
  check("v2 accept supersedes v1's PCC entry (1 superseded, 1 accepted)", acc2.body.accepted === 1 && acc2.body.superseded === 1, JSON.stringify(acc2.body).slice(0, 120));
  const active = (await api("GET", `/api/firms/${firmId}/rates`)).body.entries;
  const { count: total } = await sb.from("firm_rate_entries").select("id", { count: "exact", head: true }).eq("firm_id", firmId);
  check("active entries unchanged in count; superseded rows kept in the table", active.filter((e) => e.item_key === "garden.pcc_base").length === 1 && total === entries.length + 1, `active ${active.length}, total rows ${total}`);
  const dry2 = await api("POST", "/api/generate-boq", { project_id: STAND_IN, dry_run: true });
  const pcc2 = dry2.body.boq.sections.flatMap((s) => s.lines).find((l) => l.rule_id === "GL-04");
  check("BoQ now prices PCC at v2's 101", pcc2?.rate_aed === 101);
  const v1 = await api("GET", `/api/firms/${firmId}/quotes/${quoteId}`);
  check("v1 is marked superseded, its lines and entry links intact", v1.body.quote.status === "superseded" && v1.body.lines.some((l) => l.entry_id));
} finally {
  for (const m of memberships) await m.revoke();
  console.log("\ncleanup");
  await sb.from("projects").update({ firm_id: priorFirm }).eq("id", STAND_IN);
  if (firmId) {
    await sb.from("pilot_events").delete().eq("firm_id", firmId); // L5 firm-level events (quote accept)
    await sb.from("firms").delete().eq("id", firmId);
  }
  await sb.from("firms").delete().like("name", "U3 quote check%");
  const { count } = await sb.from("firms").select("id", { count: "exact", head: true }).like("name", "U3 quote check%");
  check("scratch firm removed (quotes, lines and entries cascade)", count === 0);
  const { data: si } = await sb.from("projects").select("firm_id").eq("id", STAND_IN).single();
  check("stand-in firm_id restored", (si.firm_id ?? null) === priorFirm);
  if (globalThis.__shot) { try { globalThis.__shot.ws.close(); } catch {} }
  if (chrome) { chrome.kill(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch {} }
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
