#!/usr/bin/env node
// =============================================================================
// scripts/k11-issues-shots.mjs — K11 #3 live: the Issues navigator (spec §7.1,
// Figma 80:49) on the BoQ page and on another step page.
//
//   node --env-file=.env.local scripts/k11-issues-shots.mjs [port] [--theme=dark]
//
// Owner scratch project (lib/k11-scratch.mjs: 3 lines to be priced, 9 derived):
//   "⚑ 4 TO FIX" → popover groups → PLB-01 row → the line selected, the
//   inspector open on Add a price; "Show only these lines" filters the grid;
//   J / Shift+J cycle; 06 Tender shows its own blocked reason as one issue.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devSession } from "./lib/dev-auth.mjs";
import { createScratchOwnerProject } from "./lib/k11-scratch.mjs";

const SCRIPT = "k11-issues-shots";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = `screenshots/k11/issues${THEME === "dark" ? "/dark" : ""}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const me = await devSession("k11-owner", { script: SCRIPT });
const owner = await createScratchOwnerProject(sb, me.userId, { name: "Garden — K11 issues (scratch)" });
const P = owner.projectId;
try {
  const b = await openBrowser({ who: "k11-owner", script: SCRIPT });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    await b.goto(`${BASE}/project/${P}/boq`, "[data-issues-navigator]");
    const label = await b.evaluate(`document.querySelector('[data-testid="issues-button"]')?.innerText.replace(/\\s+/g, " ") ?? ""`);
    check("top bar: ⚑ 4 TO FIX (3 not priced + the derived group)", /4 TO FIX/.test(label), label);
    await b.evaluate(`document.querySelector('[data-testid="issues-button"]').click()`);
    check("the popover opens", await b.until(`!!document.querySelector("[data-issues-panel]")`, 3000));
    const groups = await b.evaluate(`[...document.querySelectorAll("[data-issue-group]")].map((g) => g.getAttribute("data-issue-group") + ":" + g.querySelectorAll("[data-issue-row]").length)`);
    check("groups: not priced (3 rows), derived (1 row)", JSON.stringify(groups) === JSON.stringify(["unpriced:3", "derived:1"]), JSON.stringify(groups));
    const axe = (await b.axe(`document.querySelector("[data-issues-panel]")`)) ?? [];
    check("axe: no violations in the popover", axe.length === 0, JSON.stringify(axe));
    await b.screenshot(`${SHOTS}/1-navigator-open.png`);
    await b.key("Escape");
    check("Escape closes and returns focus to the button", (await b.until(`!document.querySelector("[data-issues-panel]")`, 2000)) && (await b.evaluate(`document.activeElement?.getAttribute("data-testid") === "issues-button"`)));

    // A row → the line, selected, the inspector on Add a price.
    await b.evaluate(`document.querySelector('[data-testid="issues-button"]').click()`);
    await b.until(`!!document.querySelector("[data-issues-panel]")`, 3000);
    await b.evaluate(`document.querySelector('[data-issue-row="unpriced:Plumbing-0"]').click()`);
    check("PLB-01 row → the line is selected and the inspector opens on Add a price", (await b.until(`document.querySelector("[data-inspector-for]")?.getAttribute("data-inspector-for") === "PLB-01" && !!document.querySelector('form[data-capture="price"]')`, 5000)));
    const inView = await b.evaluate(`(() => { const row = document.querySelector('[data-line-key="Plumbing-0"]'); const r = row.getBoundingClientRect(); const h = row.closest('[data-section]').querySelector('[role="row"]').getBoundingClientRect(); return r.top >= h.bottom - 1 && r.bottom < innerHeight; })()`);
    check("…scrolled into view, below the sticky section header", inView, await b.evaluate(`(() => { const row = document.querySelector('[data-line-key="Plumbing-0"]'); const h = row.closest('[data-section]').querySelector('[role="row"]'); return JSON.stringify({ row: row.getBoundingClientRect().top, hTop: h.getBoundingClientRect().top, hBottom: h.getBoundingClientRect().bottom, pinned: getComputedStyle(document.querySelector('.bp-boq')).getPropertyValue('--bp-boq-pinned-h'), y: scrollY }); })()`));
    await b.screenshot(`${SHOTS}/2-row-opens-add-a-price.png`);

    // J / Shift+J.
    await b.evaluate(`document.activeElement?.blur()`);
    await b.key("j");
    const afterJ = await b.evaluate(`document.querySelector("[data-inspector-for]")?.getAttribute("data-inspector-for")`);
    await b.key("j", 8);
    const afterShiftJ = await b.evaluate(`document.querySelector("[data-inspector-for]")?.getAttribute("data-inspector-for")`);
    check("J → the next issue line; Shift+J → back", afterJ && afterJ !== "PLB-01" && afterShiftJ === "PLB-01", `${afterJ} → ${afterShiftJ}`);
    check("the inspector offers Next issue J too", await b.evaluate(`!!document.querySelector("[data-next-issue]")`));

    // Show only these lines.
    await b.evaluate(`document.querySelector('[data-testid="issues-button"]').click()`);
    await b.until(`!!document.querySelector("[data-issues-panel]")`, 3000);
    await b.evaluate(`document.querySelector("[data-show-only]").click()`);
    await b.until(`!!document.querySelector("[data-only-issues]")`, 3000);
    const rows = await b.evaluate(`document.querySelectorAll("[data-line-key]").length`);
    check("Show only these lines: 12 lines in the grid (3 not priced + 9 derived)", rows === 12, String(rows));
    await b.key("Escape");
    await b.screenshot(`${SHOTS}/3-show-only.png`);
    await b.evaluate(`[...document.querySelectorAll("[data-only-issues] button")][0].click()`);
    check("Show every line restores the grid", (await b.evaluate(`document.querySelectorAll("[data-line-key]").length`)) === 18);

    // Another step page: the rail's reason.
    await b.goto(`${BASE}/project/${P}/drawings`, "main");
    const tender = await b.evaluate(`document.querySelector('[data-testid="issues-button"]')?.innerText.replace(/\\s+/g, " ") ?? ""`);
    check("06 Tender: ⚑ 1 TO FIX — its blocked reason", /1 TO FIX/.test(tender), tender);
    await b.evaluate(`document.querySelector('[data-testid="issues-button"]').click()`);
    await b.until(`!!document.querySelector("[data-issues-panel]")`, 3000);
    const t = await b.evaluate(`document.querySelector("[data-issues-panel]").innerText.replace(/\\s+/g, " ")`);
    check("…'Price 3 items first' with its fix, Open cost", /Price 3 items first/.test(t) && /Open cost/.test(t), t);
    await b.screenshot(`${SHOTS}/4-tender-step-issue.png`);
    await b.goto(`${BASE}/project/${P}/timeline`, "main");
    check("05 Timeline (nothing to fix): no button", !(await b.evaluate(`!!document.querySelector('[data-testid="issues-button"]')`)));
  } finally {
    await b.close();
  }
} finally {
  await owner.cleanup();
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K11 ISSUES CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
