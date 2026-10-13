#!/usr/bin/env node
// =============================================================================
// scripts/k11-step-footer-shots.mjs — K11 #2 live: the step footer on every
// journey step page, owner and firm; Continue disabled with the rail's reason
// when the next step is blocked; Cost → Timeline works.
//
//   node --env-file=.env.local scripts/k11-step-footer-shots.mjs [port] [--theme=dark]
//
// Scratch state only (lib/k11-scratch.mjs): an owner project (3 lines to be
// priced, so 06 Tender is blocked) and a firm project on a scratch firm.
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devSession } from "./lib/dev-auth.mjs";
import { arabellaStage7, createScratchOwnerProject } from "./lib/k11-scratch.mjs";

const SCRIPT = "k11-step-footer-shots";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = `screenshots/k11/footer${THEME === "dark" ? "/dark" : ""}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const me = await devSession("k11-owner", { script: SCRIPT });
const owner = await createScratchOwnerProject(sb, me.userId, { name: "Garden — K11 footer (scratch)" });
const firmUser = await devSession("k11-firm", { script: SCRIPT });
let firmId = null;
const FP = randomUUID();
try {
  const { data: firm } = await sb.from("firms").insert({ name: `Scratch Landscapes (K11 ${Date.now()})`, created_by: SCRIPT }).select("id").single().throwOnError();
  firmId = firm.id;
  await sb.from("firm_members").insert({ firm_id: firmId, user_id: firmUser.userId, role: "admin" }).throwOnError();
  await sb.from("firm_rate_books").insert({ firm_id: firmId, status: "reviewed", reviewed_at: new Date().toISOString() }).throwOnError();
  await sb.from("projects").insert({ id: FP, name: "Garden — K11 firm footer (scratch)", city: "Dubai", firm_id: firmId, created_by: firmUser.userId }).throwOnError();
  await sb.from("project_members").insert({ project_id: FP, user_id: firmUser.userId }).throwOnError();
  const boq = arabellaStage7();
  await sb.from("boqs").insert({ project_id: FP, total_aed: boq.grand_total_aed, sections: boq }).throwOnError();

  const footer = `(() => { const f = document.querySelector("[data-step-footer]"); if (!f) return null; const c = f.querySelector('[data-testid="step-footer-continue"]'); return { prev: f.querySelector("[data-step-previous]")?.getAttribute("data-step-previous") ?? null, next: f.querySelector("[data-step-next]")?.getAttribute("data-step-next") ?? null, state: f.querySelector("[data-step-next]")?.getAttribute("data-next-state") ?? null, href: c?.getAttribute("href") ?? null, disabled: c?.getAttribute("aria-disabled") === "true", why: f.querySelector("[data-step-next-reason]")?.textContent ?? null, text: f.innerText.replace(/\\s+/g, " ") }; })()`;

  // --- owner --------------------------------------------------------------------
  const b = await openBrowser({ who: "k11-owner", script: SCRIPT });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    const P = owner.projectId;
    const ownerPages = [
      ["overview", `/project/${P}`],
      ["plan", `/project/${P}/plan`],
      ["design", `/project/${P}/design`],
      ["renders", `/project/${P}/render`],
      ["cost", `/project/${P}/boq`],
      ["cost (specification tab)", `/project/${P}/accessories`],
      ["timeline", `/project/${P}/timeline`],
      ["tender", `/project/${P}/drawings`],
    ];
    for (const [name, path] of ownerPages) {
      await b.goto(`${BASE}${path}`, "main");
      const f = await b.evaluate(footer);
      check(`owner ${name}: footer present`, !!f, f ? f.text : "none");
    }
    await b.goto(`${BASE}/project/${P}/boq`, "[data-step-footer]");
    const cost = await b.evaluate(footer);
    check("04 Cost → previous 03 Renders, next 05 Timeline, Continue to timeline", cost?.prev === "renders" && cost?.next === "timeline" && cost.href === `/project/${P}/timeline` && !cost.disabled, JSON.stringify(cost));
    await b.evaluate(`document.querySelector("[data-step-footer]").scrollIntoView({ block: "end" })`);
    await b.screenshot(`${SHOTS}/1-cost-footer.png`);
    await b.evaluate(`document.querySelector('[data-testid="step-footer-continue"]').click()`);
    check("Continue to timeline lands on 05 Timeline", await b.until(`location.pathname === "/project/${P}/timeline"`, 20000));
    await b.goto(`${BASE}/project/${P}/timeline`, "[data-step-footer]");
    const tl = await b.evaluate(footer);
    check("05 Timeline → 06 Tender is blocked: Continue disabled with the rail's reason", tl?.next === "tender" && tl.state === "blocked" && tl.disabled && /Price 3 items first/.test(tl.why ?? ""), JSON.stringify(tl));
    await b.evaluate(`document.querySelector("[data-step-footer]").scrollIntoView({ block: "end" })`);
    await b.screenshot(`${SHOTS}/2-timeline-next-blocked.png`);
    const axe = (await b.axe(`document.querySelector("[data-step-footer]")`)) ?? [];
    check("axe: no violations in the footer", axe.length === 0, JSON.stringify(axe));
    await b.viewport(390, 844, { mobile: true, touch: true });
    await b.goto(`${BASE}/project/${P}/boq`, "[data-step-footer]");
    await b.evaluate(`document.querySelector("[data-step-footer]").scrollIntoView({ block: "end" })`);
    const overflow = await b.evaluate("document.documentElement.scrollWidth > window.innerWidth");
    check("phone: the footer does not widen the page", !overflow);
    await b.screenshot(`${SHOTS}/3-cost-footer-phone.png`);
  } finally {
    await b.close();
  }

  // --- firm ---------------------------------------------------------------------
  const fb = await openBrowser({ who: "k11-firm", script: SCRIPT });
  try {
    await fb.viewport(1440, 1000);
    await fb.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    const firmPages = [
      ["hub", `/project/${FP}`],
      ["project & plan", `/project/${FP}/plan`],
      ["rates & basis", `/project/${FP}/rates`],
      ["boq & review", `/project/${FP}/boq`],
      ["documents", `/project/${FP}/drawings`],
      ["revisions", `/project/${FP}/boq/revisions`],
      ["proposal", `/project/${FP}/proposal`],
    ];
    for (const [name, path] of firmPages) {
      await fb.goto(`${BASE}${path}`, "main");
      const f = await fb.evaluate(footer);
      check(`firm ${name}: footer present`, !!f, f ? f.text : "none");
    }
    await fb.goto(`${BASE}/project/${FP}/boq`, "[data-step-footer]");
    const r = await fb.evaluate(footer);
    check("firm 05 BoQ & Review → previous 04 Rates & Basis, next 06 Documents", r?.prev === "rates_basis" && r?.next === "documents", JSON.stringify(r));
    await fb.evaluate(`document.querySelector("[data-step-footer]").scrollIntoView({ block: "end" })`);
    await fb.screenshot(`${SHOTS}/4-firm-boq-footer.png`);
  } finally {
    await fb.close();
  }
} finally {
  await owner.cleanup();
  await sb.from("pilot_events").delete().eq("project_id", FP);
  await sb.from("boqs").delete().eq("project_id", FP);
  await sb.from("projects").delete().eq("id", FP);
  if (firmId) {
    await sb.from("pilot_events").delete().eq("firm_id", firmId);
    await sb.from("firms").delete().eq("id", firmId);
  }
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K11 STEP-FOOTER CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
