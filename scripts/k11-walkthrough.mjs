#!/usr/bin/env node
// =============================================================================
// scripts/k11-walkthrough.mjs — the K11 owner walkthrough, end to end:
//   04 Cost → find the unpriced line through the Issues navigator → Add a price
//   → the total updates → Continue to timeline.
//
//   node --env-file=.env.local scripts/k11-walkthrough.mjs [port] [--theme=dark]
//
// Scratch owner project (lib/k11-scratch.mjs: ≈ 116,679.56, 3 lines to be
// priced), the real pages and routes, keyboard where the frames say so.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devSession } from "./lib/dev-auth.mjs";
import { createScratchOwnerProject } from "./lib/k11-scratch.mjs";

const SCRIPT = "k11-walkthrough";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = `screenshots/k11/walkthrough${THEME === "dark" ? "/dark" : ""}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const me = await devSession("k11-owner", { script: SCRIPT });
const owner = await createScratchOwnerProject(sb, me.userId, { name: "Garden — K11 walkthrough (scratch)" });
const P = owner.projectId;
try {
  const b = await openBrowser({ who: "k11-owner", script: SCRIPT });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });

    // 1. The Overview → 04 Cost (the rail says why).
    await b.goto(`${BASE}/project/${P}`, "nav");
    const cost = await b.evaluate(`[...document.querySelectorAll("nav a")].map((a) => a.innerText.replace(/\\s+/g, " ")).find((t) => /Cost/.test(t)) ?? ""`);
    check("the rail: 04 Cost — 3 items not priced", /3 items not priced/.test(cost), cost);
    await b.goto(`${BASE}/project/${P}/boq`, "[data-issues-navigator]");
    const before = Number(await b.evaluate(`document.querySelector("[data-display-total]").getAttribute("data-display-total")`));
    check("04 Cost: ≈ 116,679.56 and ⚑ 4 TO FIX", before === 116679.56 && (await b.evaluate(`/4 TO FIX/.test(document.querySelector('[data-testid="issues-button"]').innerText)`)));
    await b.screenshot(`${SHOTS}/1-cost.png`);

    // 2. The navigator → the unpriced line, by keyboard.
    await b.evaluate(`document.querySelector('[data-testid="issues-button"]').focus()`);
    await b.key("Enter");
    check("Enter opens the navigator", await b.until(`!!document.querySelector("[data-issues-panel]")`, 3000));
    await b.screenshot(`${SHOTS}/2-navigator.png`);
    await b.evaluate(`document.querySelector('[data-issue-row="unpriced:Plumbing-0"]').focus()`);
    await b.key("Enter");
    check("PLB-01 → the inspector opens on Add a price", await b.until(`document.querySelector("[data-inspector-for]")?.getAttribute("data-inspector-for") === "PLB-01" && !!document.querySelector('form[data-capture="price"]')`, 5000));

    // 3. Add a price.
    await b.evaluate(`document.querySelector("[data-capture-value]").focus()`);
    await b.send("Input.insertText", { text: "650" });
    await b.evaluate(`document.querySelector('input[aria-label="Basis note"]').focus()`);
    await b.send("Input.insertText", { text: "Oct 2026" });
    await b.screenshot(`${SHOTS}/3-add-a-price.png`);
    await b.evaluate(`document.querySelector('[data-testid="capture-submit"]').click()`);
    check("Apply price → rev 2", await b.until(`!!document.querySelector('[data-applied-rev="2"]')`, 30000));
    await b.until(`document.querySelector("[data-display-total]")?.getAttribute("data-display-total") !== "116679.56"`, 15000);

    // 4. The total, the marks and the issues updated at once.
    const after = Number(await b.evaluate(`document.querySelector("[data-display-total]").getAttribute("data-display-total")`));
    const { data: rows } = await sb.from("boqs").select("total_aed, sections").eq("project_id", P).order("created_at", { ascending: true });
    check("the total updated to the stored rev 2 (subtotal +1,300.00)", rows.length === 2 && after === Number(rows[1].total_aed) && rows[1].sections.subtotal_aed === 104192.03, `${before} → ${after}`);
    check("the navigator now reads ⚑ 3 TO FIX; 2 lines to be priced", (await b.until(`/3 TO FIX/.test(document.querySelector('[data-testid="issues-button"]')?.innerText ?? "")`, 5000)) && (await b.evaluate(`/excludes 2 lines/.test(document.body.innerText)`)));
    const rail = await b.evaluate(`[...document.querySelectorAll("nav a")].map((a) => a.innerText.replace(/\\s+/g, " ")).find((t) => /Cost/.test(t)) ?? ""`);
    check("the rail agrees: 2 items not priced", /2 items not priced/.test(rail), rail);
    await b.screenshot(`${SHOTS}/4-total-updated.png`);

    // 5. Continue to timeline.
    await b.evaluate(`document.querySelector("[data-step-footer]").scrollIntoView({ block: "end" })`);
    await b.screenshot(`${SHOTS}/5-step-footer.png`);
    await b.evaluate(`document.querySelector('[data-testid="step-footer-continue"]').click()`);
    check("Continue to timeline → 05 Timeline", await b.until(`location.pathname === "/project/${P}/timeline"`, 20000));
    await b.until(`!!document.querySelector("[data-timeline]")`, 20000);
    await b.screenshot(`${SHOTS}/6-timeline.png`);
    check("no console errors on the way", b.errors().length === 0, b.errors().join(" | "));
  } finally {
    await b.close();
  }
} finally {
  await owner.cleanup();
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K11 WALKTHROUGH CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
