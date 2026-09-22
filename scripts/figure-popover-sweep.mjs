#!/usr/bin/env node
// =============================================================================
// scripts/figure-popover-sweep.mjs — hover EVERY figure on a BoQ page (I4).
//
//   node scripts/figure-popover-sweep.mjs <url> [--shots=<dir>] [--prefix=<name>]
//
// Read-only. Drives headless Chrome over the DevTools protocol (no extra
// dependency — Node's built-in WebSocket): for each [data-figure] trigger it
// moves the real mouse onto it and waits for the provenance popup, recording
// the popup title. Reports how many figures resolved, lists any that did not,
// checks one TAP (click) opens a popup too, and — with --shots — writes
// screenshots of the summary rows and of representative popovers.
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.argv[2];
const opt = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, "").split("=")));
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
if (!url || !CHROME) {
  console.error("usage: figure-popover-sweep.mjs <url> [--shots=dir] [--prefix=name]  (needs Chrome or Edge)");
  process.exit(2);
}

const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "i4-cdp-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
for (let i = 0; i < 100; i++) {
  await sleep(300);
  if ((await evaluate("document.readyState")) === "complete" && (await evaluate("document.querySelectorAll('[data-figure]').length")) > 0) break;
}
await sleep(1500); // hydration

const box = (sel, i) =>
  evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, text: el.textContent.trim(), prov: el.getAttribute("data-provenance") }; })()`);
const popupTitle = () => evaluate(`(() => { const p = document.querySelector("[data-provenance-popup]"); return p ? (p.querySelector("h2,h3,[id]")?.textContent ?? p.textContent).trim().slice(0, 120) : null; })()`);
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
const away = () => mouse("mouseMoved", 5, 5);

const total = await evaluate("document.querySelectorAll('[data-figure]').length");
const results = [];
for (let i = 0; i < total; i++) {
  const b = await box("[data-figure]", i);
  if (!b || b.w === 0) { results.push({ i, text: b?.text ?? "?", prov: b?.prov, title: null, hidden: true }); continue; }
  await away();
  await sleep(120);
  await mouse("mouseMoved", b.x, b.y);
  let title = null;
  for (let t = 0; t < 12 && !title; t++) { await sleep(80); title = await popupTitle(); }
  results.push({ i, text: b.text, prov: b.prov, title });
}
await away();
await sleep(200);

// One TAP: a click opens it too (touch has no hover).
const tapBox = await box("[data-figure][data-provenance='traced']", 0);
let tapTitle = null;
if (tapBox) {
  await mouse("mousePressed", tapBox.x, tapBox.y);
  await mouse("mouseReleased", tapBox.x, tapBox.y);
  for (let t = 0; t < 12 && !tapTitle; t++) { await sleep(80); tapTitle = await popupTitle(); }
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}

const withProv = results.filter((r) => r.prov !== "none" && !r.hidden);
const opened = withProv.filter((r) => r.title);
console.log(`${url}`);
console.log(`  figures on page: ${total} · with provenance: ${withProv.length} · popover opened: ${opened.length} · tap opens: ${tapTitle ? "yes" : "NO"}`);
const noProv = results.filter((r) => r.prov === "none");
if (noProv.length) console.log(`  FINDING — figures with no source chain: ${noProv.map((r) => r.text).join(" | ")}`);
const gaps = results.filter((r) => r.prov === "gap");
if (gaps.length) console.log(`  FINDING — untraceable figures: ${gaps.map((r) => `${r.text} (${r.title})`).join(" | ")}`);
const failed = withProv.filter((r) => !r.title);
if (failed.length) console.log(`  popover did NOT open for: ${failed.map((r) => `#${r.i} ${r.text}`).join(" | ")}`);

// --- screenshots -------------------------------------------------------------
if (opt.shots) {
  fs.mkdirSync(opt.shots, { recursive: true });
  const prefix = opt.prefix ?? "boq";
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(opt.shots, `${prefix}-${name}.png`), Buffer.from(data, "base64"));
    console.log(`  shot → ${path.join(opt.shots, `${prefix}-${name}.png`)}`);
  };
  const hoverShot = async (predicateJs, name) => {
    const i = await evaluate(`[...document.querySelectorAll("[data-figure]")].findIndex((el, i) => (${predicateJs})(el, i))`);
    if (i < 0) return console.log(`  (no figure for ${name})`);
    const b = await box("[data-figure]", i);
    await away();
    await sleep(150);
    await mouse("mouseMoved", b.x, b.y);
    await sleep(700);
    await shot(name);
  };
  await evaluate(`document.querySelector('[data-summary-row="subtotal"]')?.scrollIntoView({ block: "center" })`);
  await away();
  await sleep(400);
  await shot("summary-rows");
  for (const spec of (opt.hover ?? "").split(",").filter(Boolean)) {
    const [name, match] = spec.split(":");
    await hoverShot(`(el) => el.closest("tr")?.textContent.includes(${JSON.stringify(match)}) && el.getAttribute("data-provenance") !== "none" && ${name.includes("qty") ? "el.parentElement.cellIndex === 3" : name.includes("rate") ? "el.parentElement.cellIndex === 4" : "true"}`, name);
  }
  await hoverShot(`(el) => el.closest("tr")?.textContent.includes("Project total")`, "popover-project-total");
}

ws.close();
chrome.kill();
process.exit(failed.length ? 1 : 0);
