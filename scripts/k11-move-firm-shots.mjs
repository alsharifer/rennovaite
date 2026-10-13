#!/usr/bin/env node
// =============================================================================
// scripts/k11-move-firm-shots.mjs — K11 #5 live: "Move to firm…" from the
// project ⋯ menu (Projects home + Overview / hub top bar).
//
//   node --env-file=.env.local scripts/k11-move-firm-shots.mjs [port] [--theme=dark]
//
// Scratch state only: an owner project created by "k11-owner", a scratch firm
// with k11-owner as admin, and a second account "k11-helper".
//   1. Projects home ⋯ → Move to firm… → the firm → Move project → the rail is
//      the firm journey (00–08);
//   2. hub ⋯ → Move to firm… → No firm — personal project → owner journey;
//   3. k11-helper joins the project (not the firm) → the firm option is blocked
//      with their address; the PATCH refuses the same way.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devFetch, devSession } from "./lib/dev-auth.mjs";
import { createScratchOwnerProject } from "./lib/k11-scratch.mjs";

const SCRIPT = "k11-move-firm-shots";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = `screenshots/k11/move-firm${THEME === "dark" ? "/dark" : ""}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const me = await devSession("k11-owner", { script: SCRIPT });
const helper = await devSession("k11-helper", { script: SCRIPT });
const owner = await createScratchOwnerProject(sb, me.userId, { name: `Villa — K11 move (scratch ${Date.now() % 10000})` });
const P = owner.projectId;
let firmId = null;
const FIRM = `Studio North (K11 ${Date.now() % 100000})`;
const firmOf = async () => (await sb.from("projects").select("firm_id").eq("id", P).single()).data.firm_id;
const rail = (b) => b.evaluate(`[...document.querySelectorAll("nav a")].map((a) => a.innerText.replace(/\\s+/g, " ")).join(" | ")`);
const openMove = async (b, scope) => {
  await b.evaluate(`document.querySelector('${scope} [data-testid="project-actions"]').click()`);
  await b.until(`!!document.querySelector('[data-testid="project-move-firm"]')`, 3000);
  await b.evaluate(`document.querySelector('[data-testid="project-move-firm"]').click()`);
  return b.until(`!!document.querySelector('[data-testid="move-firm-dialog"] [data-move-options]')`, 30000);
};
const pick = (b, id) => b.evaluate(`document.querySelector('[data-move-option="${id}"] input').click()`);

try {
  const { data: firm } = await sb.from("firms").insert({ name: FIRM, created_by: me.email }).select("id").single().throwOnError();
  firmId = firm.id;
  await sb.from("firm_members").insert({ firm_id: firmId, user_id: me.userId, role: "admin" }).throwOnError();

  const b = await openBrowser({ who: "k11-owner", script: SCRIPT });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });

    // --- 1. attach from the Projects home ---------------------------------------
    await b.goto(`${BASE}/projects`, "[data-home]");
    check("Projects home ⋯ → Move to firm… opens the dialog", await openMove(b, `[data-project="${P}"]`));
    const opts = await b.evaluate(`[...document.querySelectorAll("[data-move-option]")].map((o) => o.innerText.replace(/\\s+/g, " ") + " · " + o.getAttribute("data-allowed"))`);
    check("options: the firm (allowed) and No firm — personal project (now)", opts.length === 2 && opts[0].startsWith(FIRM) && opts[0].endsWith("true") && /No firm — personal project · now/.test(opts[1]), JSON.stringify(opts));
    const copy = await b.evaluate(`document.querySelector('[data-testid="move-firm-dialog"]').innerText`);
    check("it says what changes: the firm journey 00–08, the firm's book prices the next regenerate, every member in the firm", /firm’s journey \(00–08\)/.test(copy) && /next regenerate prices the BoQ from the firm’s rate book/.test(copy) && /Every member of the project must be a member of the firm/.test(copy));
    await pick(b, firmId);
    await b.screenshot(`${SHOTS}/1-move-to-firm.png`);
    const axe = (await b.axe(`document.querySelector('[data-testid="move-firm-dialog"]')`)) ?? [];
    check("axe: no violations in the dialog", axe.length === 0, JSON.stringify(axe));
    await b.evaluate(`document.querySelector('[data-testid="move-firm-confirm"]').click()`);
    await b.until(`!document.querySelector('[data-testid="move-firm-dialog"][open]')`, 15000);
    check("attached: the project is the firm's", (await firmOf()) === firmId);
    await b.goto(`${BASE}/project/${P}`, "nav");
    const r1 = await rail(b);
    check("…and the rail is the firm journey (00–08)", /08 Proposal/.test(r1) && /Rates & Basis/.test(r1), r1.slice(0, 200));
    await b.screenshot(`${SHOTS}/2-firm-journey.png`);

    // --- 2. detach from the hub top bar -------------------------------------------
    check("hub ⋯ → Move to firm… opens the dialog", await openMove(b, ".bp-topbar"));
    check("the project's current firm is named", await b.evaluate(`/Now in ${FIRM.replace(/[()]/g, ".")}/.test(document.querySelector("[data-current-firm]")?.innerText ?? "")`));
    await pick(b, "none");
    await b.screenshot(`${SHOTS}/3-make-personal.png`);
    await b.evaluate(`document.querySelector('[data-testid="move-firm-confirm"]').click()`);
    await b.until(`!document.querySelector('[data-testid="move-firm-dialog"][open]')`, 15000);
    check("detached: a personal project again", (await firmOf()) === null);
    await b.goto(`${BASE}/project/${P}`, "nav");
    const r2 = await rail(b);
    check("…and the rail is the owner journey (00–06)", /06 Tender/.test(r2) && !/08 Proposal/.test(r2), r2.slice(0, 200));

    // --- 3. blocked while a member is outside the firm --------------------------------
    await sb.from("project_members").insert({ project_id: P, user_id: helper.userId }).throwOnError();
    await b.goto(`${BASE}/projects`, "[data-home]");
    await openMove(b, `[data-project="${P}"]`);
    await pick(b, firmId);
    await b.until(`!!document.querySelector("[data-move-blocked]")`, 3000);
    const blocked = await b.evaluate(`document.querySelector("[data-move-blocked]").innerText.replace(/\\s+/g, " ")`);
    check("blocked: names who is not in the firm, and why", blocked.includes(helper.email) && /1 person on this project is not in/.test(blocked) && /Add them to the firm first/.test(blocked), blocked);
    check("…Move project is disabled with that reason", await b.evaluate(`document.querySelector('[data-testid="move-firm-confirm"]').getAttribute("aria-disabled") === "true"`));
    await b.screenshot(`${SHOTS}/4-blocked-member-outside.png`);
    await b.key("Escape");
  } finally {
    await b.close();
  }
  const f = devFetch("k11-owner", { script: SCRIPT });
  const direct = await f(`${BASE}/api/projects/${P}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ firm_id: firmId }) });
  const body = await direct.json();
  check("the PATCH refuses the same: 409 project_members_outside_firm, naming them", direct.status === 409 && body.code === "project_members_outside_firm" && String(body.error).includes(helper.email), `${direct.status} ${body.error}`);
  // A project member who is in the firm but did not create the project may not attach it.
  await sb.from("firm_members").insert({ firm_id: firmId, user_id: helper.userId, role: "member" }).throwOnError();
  const h = devFetch("k11-helper", { script: SCRIPT });
  const notCreator = await h(`${BASE}/api/projects/${P}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ firm_id: firmId }) });
  check("a member who did not create the project → 403 not_project_creator", notCreator.status === 403 && (await notCreator.json()).code === "not_project_creator", String(notCreator.status));
} finally {
  await sb.from("projects").update({ firm_id: null }).eq("id", P);
  await owner.cleanup();
  if (firmId) {
    await sb.from("pilot_events").delete().eq("firm_id", firmId);
    await sb.from("firms").delete().eq("id", firmId);
  }
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K11 MOVE-TO-FIRM CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
