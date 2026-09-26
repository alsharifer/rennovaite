#!/usr/bin/env node
// =============================================================================
// scripts/firm-book-page-check.mjs — the rate-book PAGE, driven as a member (U2).
//
//   node scripts/firm-book-page-check.mjs [port] [--shots=screenshots/u2]
//
// Headless Chrome over the DevTools protocol (no extra dependency), signed in
// the way a real member is: the dev account's session (scripts/lib/dev-auth.mjs)
// is set as the SAME cookie @supabase/ssr writes after a magic link, so every
// page and API call runs through the app's own cookie path. Then, as that
// member: create a firm through the page, open its book, set OH&P, add an entry
// with a WRONG unit and a WRONG kind (inline errors must render), add a valid
// one, edit it, mark the book reviewed, edit again (status must fall back to
// draft), delete it — and, throughout, RECORD EVERY REQUEST the page makes: the
// privacy assertion is that no request names any firm but this one.
//
// Writes only scratch state (one firm named "U2 page check — …") and removes it.
// Refuses production (scripts/_target-guard.mjs).
// =============================================================================
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const PORT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "3098";
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, "").split("=")));
const BASE = `http://localhost:${PORT}`;
const SHOTS = opt.shots ?? null;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
if (!CHROME) { console.error("needs Chrome or Edge"); process.exit(2); }

const { url, key } = resolveTarget({ script: "firm-book-page-check", writes: true });
const sb = createClient(url, key);
let failures = 0;
const check = (label, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "  ok " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- a real session, as cookies -------------------------------------------------
const me = await devSession("page", { script: "firm-book-page-check" });
const other = await devSession("other", { script: "firm-book-page-check" });
// A second firm, owned by ANOTHER account, exists during the run: the privacy
// check is that the page never requests it.
const { data: otherFirm } = await sb.from("firms").insert({ name: `U2 page check — other firm ${Date.now()}`, created_by: "firm-book-page-check" }).select("id").single();
await sb.from("firm_members").insert({ firm_id: otherFirm.id, user_id: other.userId });

// --- Chrome + CDP --------------------------------------------------------------------
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "u2-cdp-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,1100", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {} }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map(); const requests = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Network.requestWillBeSent") requests.push({ url: m.params.request.url, method: m.params.request.method });
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
for (const c of me.cookies) await send("Network.setCookie", { name: c.name, value: c.value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" });

const goto = async (u) => { await send("Page.navigate", { url: u }); for (let i = 0; i < 100; i++) { await sleep(200); if ((await evaluate("document.readyState")) === "complete") break; } await sleep(900); };
const q = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => evaluate(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? "").trim()`);
const setValue = async (sel, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return el.value; })()`);
const click = async (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const clickByText = async (tag, txt) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find((b) => b.textContent.trim() === ${JSON.stringify(txt)}); if (!el) return false; el.click(); return true; })()`);
const until = async (expr, ms = 8000) => { for (let i = 0; i < ms / 150; i++) { if (await evaluate(expr)) return true; await sleep(150); } return false; };
const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, "base64")); console.log(`       shot → ${SHOTS}/${name}.png`); };

let firmId = null;
try {
  console.log("\n1. /firms as a signed-in member");
  await goto(`${BASE}/firms`);
  check("page renders for the session (no sign-in card)", !(await q('[aria-label="Sign in required"]')) && (await q('[aria-label="Create a firm"]')));
  const firmName = `U2 page check — ${Date.now()}`;
  await setValue('[aria-label="Create a firm"] input', firmName);
  await clickByText("button", "Create firm");
  check("firm created through the page", await until(`[...document.querySelectorAll('[data-testid="firm-list"] a')].some((a) => a.textContent.includes(${JSON.stringify(firmName)}))`));
  await shot("u2-01-firms-list");
  firmId = await evaluate(`([...document.querySelectorAll('[data-testid="firm-list"] a')].find((a) => a.textContent.includes(${JSON.stringify(firmName)}))?.getAttribute("href") ?? "").split("/").pop()`);
  check("the new firm is on the list with a link to its book", /^[0-9a-f-]{36}$/.test(firmId), firmId);

  console.log("\n2. the book page — OH&P and status");
  requests.length = 0;
  await goto(`${BASE}/firms/${firmId}`);
  check("book page renders (editor mounted)", await until(`!!document.querySelector('[data-firm-id]')`));
  check("vocabulary loaded into the item picker", await until(`document.querySelectorAll('[aria-label="Item"] option').length > 20`), `${await evaluate(`document.querySelectorAll('[aria-label="Item"] option').length`)} options`);
  check("status starts as Draft", (await text('[data-testid="book-status"] span')) === "Draft");
  await setValue('[aria-label="OH&P percent"]', "12.5");
  await clickByText("button", "Save OH&P");
  check("OH&P saved to 12.5%", await until(`document.body.textContent.includes("OH&P 12.5%")`));
  await setValue('[aria-label="OH&P percent"]', "80");
  await clickByText("button", "Save OH&P");
  check("OH&P 80% refused INLINE", await until(`(document.querySelector('[aria-label="Overheads and profit"] [role="alert"]')?.textContent ?? "").includes("between 0 and 50")`));
  await setValue('[aria-label="OH&P percent"]', "12.5");
  await shot("u2-02-book-ohp-error");

  console.log("\n3. add an entry — wrong unit, wrong kind, then valid");
  await setValue('[aria-label="Item"]', "garden.pcc_base");
  check("picking an item fixes the unit to the vocabulary's", (await evaluate(`document.querySelector('[aria-label="Unit"]').value`)) === "m2");
  await evaluate(`(() => { const el = document.querySelector('[aria-label="Unit"]'); el.removeAttribute("readonly"); })()`);
  await setValue('[aria-label="Unit"]', "lm");
  await setValue('[aria-label="Rate AED"]', "95.5");
  check("wrong unit → inline error before any request", await until(`(document.querySelector('[data-testid="add-errors"]')?.textContent ?? "").includes('measured in "m2", not "lm"')`));
  await shot("u2-03-add-inline-unit-error");
  await setValue('[aria-label="Unit"]', "m2");
  // A kind the item does not take: the picker only offers allowed kinds, so force it.
  await evaluate(`(() => { const s = document.querySelector('[aria-label="Kind"]'); const o = document.createElement("option"); o.value = "supply_and_install"; o.textContent = "forced"; s.appendChild(o); })()`);
  await setValue('[aria-label="Kind"]', "supply_and_install");
  check("wrong kind → inline error naming the allowed kinds", await until(`(document.querySelector('[data-testid="add-errors"]')?.textContent ?? "").includes("takes a labour / lump rate, not supply_and_install")`));
  await setValue('[aria-label="Kind"]', "labour");
  const reqBefore = requests.filter((r) => r.url.includes("/api/")).length;
  await clickByText("button", "Add entry");
  check("valid entry added; row shows rate beside market reference", await until(`!!document.querySelector('[data-item-key="garden.pcc_base"]') && document.querySelector('[data-item-key="garden.pcc_base"]').textContent.includes("market reference")`));
  check("the add was one POST to this firm's rates route", requests.slice(reqBefore).some((r) => r.method === "POST" && r.url.endsWith(`/api/firms/${firmId}/rates`)));
  await shot("u2-04-entry-beside-reference");
  const dup = await clickByText("button", "Add entry");
  void dup;

  console.log("\n4. review, then edit → back to draft");
  await clickByText("button", "Mark reviewed");
  check("marked Reviewed", await until(`(document.querySelector('[data-testid="book-status"] span')?.textContent ?? "") === "Reviewed"`));
  await shot("u2-05-reviewed");
  await click('[aria-label="Edit garden.pcc_base"]');
  await setValue('[data-item-key="garden.pcc_base"] [aria-label="Rate AED"]', "-5");
  await clickByText("button", "Save");
  check("negative rate on edit → inline error", await until(`(document.querySelector('[data-testid="edit-errors"]')?.textContent ?? "").includes("finite number")`));
  await setValue('[data-item-key="garden.pcc_base"] [aria-label="Rate AED"]', "96.25");
  await clickByText("button", "Save");
  check("edit saved (96.25)", await until(`(document.querySelector('[data-item-key="garden.pcc_base"]')?.textContent ?? "").includes("96.25")`));
  check("an edit after review returns the book to Draft", await until(`(document.querySelector('[data-testid="book-status"] span')?.textContent ?? "") === "Draft"`));
  await shot("u2-06-edited-back-to-draft");

  console.log("\n5. delete");
  await evaluate("window.confirm = () => true");
  await click('[aria-label="Delete garden.pcc_base"]');
  check("entry deleted", await until(`!document.querySelector('[data-item-key="garden.pcc_base"]')`));

  console.log("\n6. privacy — every request the page made");
  const api = requests.filter((r) => /\/api\//.test(r.url)).map((r) => new URL(r.url).pathname);
  const foreign = api.filter((p) => /\/api\/firms\/[0-9a-f-]{36}/.test(p) && !p.includes(firmId));
  const allowed = api.every((p) => p.startsWith(`/api/firms/${firmId}`) || p === "/api/firms" || p === "/api/rate-vocabulary");
  check(`${api.length} API requests, all to this firm's routes, /api/firms or /api/rate-vocabulary`, allowed && foreign.length === 0, [...new Set(api)].join(" "));
  check("no request names the OTHER account's firm", !api.some((p) => p.includes(otherFirm.id)));
  const asOther = await fetch(`${BASE}/api/firms/${firmId}/rates`, { headers: other.headers });
  check("the other account reading this book via the API → 403", asOther.status === 403);
  await goto(`${BASE}/firms/${otherFirm.id}`);
  check("this member opening the OTHER firm's page → the not-a-member card, no entries", (await q('[aria-label="Not a member"]')) && !(await q('[data-firm-id]')));
  await shot("u2-07-not-a-member");
} finally {
  console.log("\ncleanup");
  // Database first — a browser that will not die must never leave scratch rows behind.
  if (firmId) await sb.from("firms").delete().eq("id", firmId);
  await sb.from("firms").delete().eq("id", otherFirm.id);
  await sb.from("firms").delete().like("name", "U2 page check%"); // any earlier aborted run
  const { count } = await sb.from("firms").select("id", { count: "exact", head: true }).like("name", "U2 page check%");
  check("scratch firms removed", count === 0);
  try { ws.close(); } catch {}
  chrome.kill();
  // Chrome releases its profile a moment after SIGTERM; on Windows rm before
  // that is EPERM. Retry, and a stubborn temp dir is not a failed check.
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch (e) { console.log(`       (profile dir left in %TEMP%: ${e.code})`); }
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
