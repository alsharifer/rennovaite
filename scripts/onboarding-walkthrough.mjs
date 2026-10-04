#!/usr/bin/env node
// =============================================================================
// scripts/onboarding-walkthrough.mjs — the onboarding walkthrough, live (UV).
//
//   node --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/walkthrough-scratch.mjs seed
//   node scripts/onboarding-walkthrough.mjs [port] [--shots=screenshots/uv]
//   node --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/walkthrough-scratch.mjs teardown
//
// A fresh account (seeded — a real Supabase user; the app's only sign-in is the
// magic link, so the script signs in the same way dev-auth does) drives headless
// Chrome through the app, as a firm would:
//   1. /firms — create their firm
//   2. /firms/:id — build a small book in the UI (element + garden keys), mark it
//      reviewed, set the proposal branding
//   3. attach the firm to the fresh villa — there is NO UI for this yet (PATCH
//      /api/projects/:id { firm_id } from the page context; a gap the report names)
//   4. /project/:id/boq — Generate BoQ; their rates resolve at tier 1; hover a
//      firm-priced figure and a fallback figure: the popovers say so
//   5. /project/:id/drawings?export=1 — Export pack with the client proposal,
//      through the gate (the book is reviewed → basis passes); downloads appear
//   6. one change — edit a rate in the book, press Regenerate on the BoQ page
//      (H4) — the result links to /project/:id/boq/revisions?from=&to=, which
//      shows the diff with the recorded cause
//   7. the milestone report prints the firm and the villa
// A screenshot at every step under --shots. Scratch state only; the seed/teardown
// script removes it and verifies nothing remains. Needs the `pack` launch config
// (PACK_EXPORT_ENABLED + DRAWINGS_ENABLED). Refuses production.
// =============================================================================

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

const PORT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "3098";
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, "").split("=")));
const BASE = `http://localhost:${PORT}`;
const SHOTS = opt.shots ?? "screenshots/uv";
const STATE_DIR = path.join(process.env.TEMP ?? process.env.TMP ?? ".", "walkthrough");
const state = JSON.parse(fs.readFileSync(path.join(STATE_DIR, "state.json"), "utf8"));
const cookieLine = fs.readFileSync(path.join(STATE_DIR, "cookie.txt"), "utf8").trim();
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("needs Chrome or Edge");
  process.exit(2);
}
const FIRM_NAME = "Walkthrough Landscapes";
const BRAND = "Walkthrough Landscapes LLC";
const DOC_NAME = "Walkthrough Villa — Client Proposal";
const BOOK = [
  { key: "wall_plaster", rate: "41.5", kind: "supply_and_install" },
  { key: "floor_finish", rate: "150", kind: "supply_and_install" },
  { key: "wall_paint", rate: "28", kind: "supply_and_install" },
  { key: "ceiling_finish", rate: "99", kind: "supply_and_install" },
  { key: "garden.pcc_base", rate: "95.5", kind: "labour" },
];

const { url, key } = resolveTarget({ script: "onboarding-walkthrough", writes: true });
const sb = createClient(url, key);
let failures = 0;
let step = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Chrome + CDP --------------------------------------------------------------------
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "uv-cdp-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,1100", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
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
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
for (const c of cookieLine.split("; ")) {
  const i = c.indexOf("=");
  await send("Network.setCookie", { name: c.slice(0, i), value: c.slice(i + 1), domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" });
}
const goto = async (u) => {
  await send("Page.navigate", { url: u });
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    if ((await evaluate("document.readyState")) === "complete") break;
  }
  await sleep(1200);
};
const q = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => evaluate(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? "").trim()`);
const setValue = async (sel, value) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return el.value; })()`);
const click = async (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const clickByText = async (tag, txt) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find((b) => b.textContent.trim() === ${JSON.stringify(txt)}); if (!el) return false; el.click(); return true; })()`);
const until = async (expr, ms = 15000) => {
  for (let i = 0; i < ms / 200; i++) {
    if (await evaluate(expr)) return true;
    await sleep(200);
  }
  return false;
};
const shot = async (name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  step += 1;
  const file = `${String(step).padStart(2, "0")}-${name}.png`;
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOTS, file), Buffer.from(data, "base64"));
  console.log(`       shot → ${SHOTS}/${file}`);
};
const hover = async (sel, index = 0) => {
  const rect = await evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${index}]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!rect) return false;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await sleep(600);
  return true;
};
const villa = state.projectId;

let firmId = null;
try {
  console.log(`\n1. a fresh account (${state.email}) creates its firm`);
  await goto(`${BASE}/firms`);
  check("signed in as the fresh account, no firm yet", (await q('[aria-label="Create a firm"]')) && (await evaluate(`document.body.textContent.includes("not a member of any firm yet")`)));
  await shot("firms-fresh-account");
  await setValue('[aria-label="Create a firm"] input', FIRM_NAME);
  await clickByText("button", "Create firm");
  check("firm created from the page", await until(`[...document.querySelectorAll('[data-testid="firm-list"] a')].some((a) => a.textContent.includes(${JSON.stringify(FIRM_NAME)}))`, 60000), await text("#create-firm-error"));
  firmId = await evaluate(`([...document.querySelectorAll('[data-testid="firm-list"] a')].find((a) => a.textContent.includes(${JSON.stringify(FIRM_NAME)}))?.getAttribute("href") ?? "").split("/").pop()`);
  await shot("firm-created");

  console.log("\n2. the book — entries in the UI, reviewed, branded");
  await goto(`${BASE}/firms/${firmId}`);
  check("book page mounted; vocabulary loaded", await until(`document.querySelectorAll('[aria-label="Item"] option').length > 20`, 20000));
  for (const e of BOOK) {
    await setValue('[aria-label="Item"]', e.key);
    await sleep(150);
    await setValue('[aria-label="Kind"]', e.kind);
    await setValue('[aria-label="Rate AED"]', e.rate);
    await clickByText("button", "Add entry");
    check(`entry ${e.key} @ ${e.rate}`, await until(`!!document.querySelector('[data-item-key=${JSON.stringify(e.key)}]')`, 60000), await text('[data-testid="add-errors"]'));
  }
  await shot("book-entries");
  await clickByText("button", "Mark reviewed");
  check("book marked Reviewed", await until(`(document.querySelector('[data-testid="book-status"] span')?.textContent ?? "") === "Reviewed"`, 60000));
  await shot("book-reviewed");
  check("branding panel present", await until(`!!document.querySelector('[data-testid="branding-panel"]')`));
  await setValue('[aria-label="Display name"]', BRAND);
  await setValue('[aria-label="Terms text"]', "Valid for 30 days.\nPayment: 40% on order, 50% on completion, 10% on handover.");
  await click('[data-testid="branding-save"]');
  check("branding saved", await until(`document.body.textContent.includes('Proposals print "${BRAND}"')`, 60000));
  await shot("branding-saved");

  console.log("\n3. attach the firm to the fresh villa (API — no UI for this yet)");
  const attach = await evaluate(`fetch("/api/projects/${villa}", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ firm_id: ${JSON.stringify(firmId)} }) }).then((r) => r.status)`);
  check("PATCH /api/projects/:id { firm_id } → 200 (the page's own session)", attach === 200, String(attach));

  console.log("\n4. generate the BoQ — their rates resolve, popovers honest");
  await goto(`${BASE}/project/${villa}/boq`);
  await shot("boq-before-generation");
  check("Generate BoQ button present", await clickByText("button", "Generate BoQ"));
  check("BoQ generated and rendered", await until(`document.querySelectorAll('[data-figure]').length > 40`, 120000), `${await evaluate(`document.querySelectorAll('[data-figure]').length`)} figures`);
  await shot("boq-generated");
  const { data: boqRow } = await sb.from("boqs").select("id, sections").eq("project_id", villa).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const lines = boqRow?.sections?.sections?.flatMap((s) => s.lines) ?? [];
  const firmLines = lines.filter((l) => l.rate_tier === "firm_private");
  check("their rates resolve at tier 1 on the element sections", firmLines.length >= 3, firmLines.map((l) => `${l.item_key ?? l.rule_id} ${l.rate_aed}`).join(", "));
  const plasterQty = lines.find((l) => l.item_key === "wall_plaster")?.quantity;
  // Popover on a firm-priced figure: find the Plaster section's rate figure.
  const plasterRowSel = `[data-provenance]`;
  const idx = await evaluate(`(() => { const els = [...document.querySelectorAll('[data-provenance]')]; return els.findIndex((el) => /41\\.50|41\\.5/.test(el.textContent)); })()`);
  check("a firm-priced figure is on the page", idx >= 0, `index ${idx}`);
  if (idx >= 0) {
    await hover(plasterRowSel, idx);
    const pop = await until(`!!document.querySelector('[data-provenance-popup]')`, 5000);
    const popText = pop ? await text("[data-provenance-popup]") : "";
    check("its popover names the Private tier (the firm's own rate)", pop && /Private/.test(popText), popText.slice(0, 120));
    await shot("popover-firm-rate");
  }
  // A figure the firm did NOT price: hover rate figures until a popover titled "Rate —" names a non-Private tier.
  const traced = await evaluate(`document.querySelectorAll('[data-provenance="traced"]').length`);
  let fallbackText = "";
  for (let i = 0; i < Math.min(traced, 60) && !fallbackText; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
    await sleep(250);
    await hover('[data-provenance="traced"]', i);
    if (!(await until(`!!document.querySelector('[data-provenance-popup]')`, 2500))) continue;
    const pt = await text("[data-provenance-popup]");
    if (/^Rate — /.test(pt) && !/Private/.test(pt)) fallbackText = pt;
  }
  check("a figure the firm did not price: its popover names its own tier (Fallback / reference / indicative), never Private", /Fallback|actual_transaction|Indicative|market_fair|QS to price/.test(fallbackText), fallbackText.slice(0, 140));
  await shot("popover-fallback-rate");
  check("the reference-basis banner does not show on a firm-priced BoQ… or shows with the reviewed book", !(await q('[data-reference-basis]')) || (await q('[data-basis-status="book_reviewed"]')));
  void plasterQty;

  console.log("\n5. export the client proposal through the gate");
  await goto(`${BASE}/project/${villa}/drawings?export=1`);
  check("Export pack panel open with the gate", await until(`!!document.querySelector('[data-pack-checklist]')`, 60000));
  await setValue('[data-pack-export] input[placeholder]', DOC_NAME);
  check("proposal toggle offered (the project has a firm)", await until(`!!document.querySelector('[data-testid="proposal-toggle"] input')`, 10000));
  await click('[data-testid="proposal-toggle"] input');
  check("gate re-checked with the proposal items; reference basis passes (book reviewed)", await until(`(() => { const li = document.querySelector('[data-check="reference_basis"]'); return !!li && li.getAttribute("data-ok") === "true"; })()`, 60000));
  await shot("export-gate-with-proposal");
  await clickByText("button", "Run export");
  const done = await until(`!!document.querySelector('[data-pack-downloads]') || !!document.querySelector('[data-pack-failed]') || (document.body.textContent.includes("Export blocked"))`, 420000);
  const downloads = await evaluate(`[...document.querySelectorAll('[data-pack-downloads] a')].map((a) => a.textContent.trim())`);
  check("the pack passed and the proposal PDF is among the downloads", done && (downloads ?? []).some((d) => d.includes("proposal.pdf")), (downloads ?? []).join(", ") || (await text("[data-pack-failed]")).slice(0, 200) || (await evaluate(`[...document.querySelectorAll('[data-check][data-ok="false"] p')].map((p) => p.textContent).join(" | ")`)).slice(0, 300));
  await shot("export-passed-downloads");

  console.log("\n6. one change → revision diff with its cause");
  await goto(`${BASE}/firms/${firmId}`);
  await until(`!!document.querySelector('[data-item-key="wall_plaster"]')`, 20000);
  await click('[aria-label="Edit wall_plaster"]');
  await setValue('[data-item-key="wall_plaster"] [aria-label="Rate AED"]', "45");
  await clickByText("button", "Save");
  check("plaster rate edited 41.5 → 45 (book returns to Draft)", await until(`(() => { const t = document.querySelector('[data-item-key="wall_plaster"]')?.textContent ?? ""; return t.includes("45 / m2") && !t.includes("41.5 / m2"); })() &&(document.querySelector('[data-testid="book-status"] span')?.textContent ?? "") === "Draft"`, 60000));
  await shot("rate-edited");
  // H4: the member regenerates from the BoQ page's own control — the payoff
  // loop: edit a rate → Regenerate → the diff link shows exactly what moved.
  await goto(`${BASE}/project/${villa}/boq`);
  const { data: prevRow } = await sb.from("boqs").select("id, total_aed").eq("project_id", villa).order("created_at", { ascending: false }).limit(1).single();
  check("the page's headline is the stored revision's total (what-if with no grade chosen moves nothing)", Number(await evaluate(`document.querySelector('[data-display-total]')?.getAttribute("data-display-total")`)) === Number(prevRow?.total_aed), `page ${await evaluate(`document.querySelector('[data-display-total]')?.getAttribute("data-display-total")`)} · stored ${prevRow?.total_aed}`);
  check("Regenerate control offered to the member, enabled", await until(`(() => { const b = document.querySelector('[data-testid="regenerate-button"]'); return !!b && !b.disabled; })()`, 30000));
  await shot("regenerate-ready");
  await click('[data-testid="regenerate-button"]');
  check("progress shown while it runs", await until(`document.querySelector('[data-testid="regenerate"]')?.getAttribute("data-regenerate-state") === "running"`, 5000));
  check("the resulting revision is shown", await until(`!!document.querySelector('[data-testid="regenerate-result"]')`, 120000), await text('[data-testid="regenerate-failure"]'));
  await sleep(1500);
  await shot("regenerate-result");
  const { data: newRow } = await sb.from("boqs").select("id, total_aed").eq("project_id", villa).order("created_at", { ascending: false }).limit(1).single();
  check("a new revision was stored", !!newRow && newRow.id !== prevRow?.id, `${prevRow?.id?.slice(0, 8)} → ${newRow?.id?.slice(0, 8)}`);
  check("after regenerating, the page shows the new revision's total", await until(`Number(document.querySelector('[data-display-total]')?.getAttribute("data-display-total")) === ${Number(newRow?.total_aed)}`, 30000), `page ${await evaluate(`document.querySelector('[data-display-total]')?.getAttribute("data-display-total")`)} · stored ${newRow?.total_aed}`);
  const href = await evaluate(`document.querySelector('[data-testid="regenerate-diff-link"]')?.getAttribute("href") ?? null`);
  check("the diff link compares exactly the superseded revision with the new one", href === `/project/${villa}/boq/revisions?from=${prevRow?.id}&to=${newRow?.id}`, String(href));
  const { data: ev } = await sb.from("pilot_events").select("actor, detail").eq("project_id", villa).eq("kind", "boq_generated").contains("detail", { boq_id: newRow?.id }).maybeSingle();
  check("boq_generated recorded with the member as actor, trigger=regenerate and the superseded revision", ev?.actor === state.userId && ev?.detail?.trigger === "regenerate" && ev?.detail?.previous_boq_id === prevRow?.id, JSON.stringify({ actor: ev?.actor?.slice(0, 8), trigger: ev?.detail?.trigger, prev: ev?.detail?.previous_boq_id?.slice(0, 8) }));
  await goto(`${BASE}${href}`);
  check("revisions page shows the diff of those two revisions", await until(`!!document.querySelector('[data-diff-from]')`, 30000) && (await evaluate(`document.querySelector('[data-diff-from]')?.getAttribute("data-diff-from")`)) === prevRow?.id, await evaluate(`document.querySelector('[data-diff-from]')?.getAttribute("data-diff-from") ?? "-"`));
  const moved = await evaluate(`[...document.querySelectorAll('[data-line-key]')].map((tr) => tr.getAttribute("data-line-key"))`);
  check("the Plaster line moved (rate), and only what the rate change touched", (moved ?? []).some((k) => k.includes("wall_plaster")), (moved ?? []).join(" · "));
  check("the moved line carries the recorded cause — the firm's rate-book change", await evaluate(`[...document.querySelectorAll('[data-line-key*="wall_plaster"] [data-causes="recorded"]')].some((ul) => /contractor rate book/i.test(ul.textContent))`), await evaluate(`(document.querySelector('[data-line-key*="wall_plaster"] [data-causes]')?.textContent ?? "").slice(0, 160)`));
  await shot("revision-diff-with-cause");

  console.log("\n7. the milestone report prints the firm and the villa");
  const report = execFileSync(process.execPath, ["--experimental-transform-types", "--import", "./scripts/_alias-hook.mjs", "scripts/three-firms-report.ts", "--firm", firmId], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  fs.writeFileSync(path.join(SHOTS, "99-milestone-report.txt"), report);
  const reportOut = execFileSync(process.execPath, ["--experimental-transform-types", "--import", "./scripts/_alias-hook.mjs", "scripts/three-firms-report.ts", "--firm", firmId, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const reportJson = JSON.parse(reportOut.slice(reportOut.indexOf("{"))); // the target banner precedes the JSON
  const firmRow = reportJson.firms?.[0];
  const villaRow = firmRow?.projects?.find((p) => p.project_id === villa);
  check("report names the firm and the villa with a first-BoQ time, a checking time and the firm's rate-book entries", firmRow?.name === FIRM_NAME && villaRow?.name === DOC_NAME && villaRow.time_to_first_boq_min != null && villaRow.checking_min != null && firmRow.rate_book.entries === BOOK.length, `→1st BoQ ${villaRow?.time_to_first_boq_min} min · checking ${villaRow?.checking_min} min · entries ${firmRow?.rate_book?.entries} · saved ${SHOTS}/99-milestone-report.txt`);
  check("the release that closes checking time carries the member's actor (the export they started)", villaRow?.gaps?.every((g) => !/first release carries no actor/.test(g)) === true, (villaRow?.gaps ?? []).join(" | ").slice(0, 200));
  console.log(report.split("\n").slice(0, 12).map((l) => "     " + l).join("\n"));
} finally {
  try {
    ws.close();
  } catch {}
  chrome.kill();
  await sleep(500);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}
console.log(failures === 0 ? "\nWALKTHROUGH PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
