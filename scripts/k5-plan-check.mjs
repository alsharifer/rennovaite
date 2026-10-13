// =============================================================================
// scripts/k5-plan-check.mjs — the K5 plan-check loop, live, on the J0
// 06-bad-parse scratch project (scripts/k5-bad-parse.mjs seed).
//
//   node scripts/k5-plan-check.mjs [port] <project-id> [--shots=dir]
//
// 1. the panel states the J0 numbers (12 pairs, 23.6%, 166.1 m²) as the inverse
//    block; the canvas draws 12 "counted twice" shapes and the legend;
// 2. the rail blocks downstream (the plan's own reason);
// 3. an overlap row selects BOTH rooms on the canvas;
// 4. Fix overlaps → Save becomes enabled → Save → the panel reads "can be
//    priced" and costing is no longer blocked.
// WRITES the scratch project's rooms (step 4). Exit 1 on any failure.
// =============================================================================

import { openBrowser } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 3098);
const id = args.find((a) => /^[0-9a-f-]{36}$/.test(a));
const SHOTS = args.find((a) => a.startsWith("--shots="))?.slice(8);
if (!id) throw new Error("usage: k5-plan-check.mjs [port] <project-id>");
let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const b = await openBrowser({ script: "k5-plan-check", projects: [id] });
const url = `http://localhost:${port}/project/${id}/plan`;
const q = (expr) => b.evaluate(expr);
try {
  await b.viewport(1440, 1000);
  await b.goto(url, "[data-plan-check]");
  await b.until(`!!document.querySelector('[data-plan-page]') && document.querySelector('[data-plan-check]').getAttribute('data-plan-check') !== null`, 30000);
  check("panel: PLAN CAN'T BE PRICED YET with the J0 figures", /12 pairs of rooms overlap — 23\.6% of the room area is counted twice \(parser total 166\.1 m²\)/.test(await q(`document.querySelector('[data-plan-check]').textContent`)));
  check("overlap list: 12 pairs, largest first", (await q(`document.querySelectorAll('[data-testid="overlap-list"] li').length`)) === 12);
  check("canvas: 12 shapes of floor counted twice, and the legend", (await q(`document.querySelectorAll('[data-overlap-fill] polygon').length`)) >= 12 && (await q(`!!document.querySelector('[data-overlap-legend]')`)));
  const blocked = await q(`[...document.querySelectorAll('[data-step][data-state="blocked"]')].map((a) => a.getAttribute('data-step')).join(",")`);
  check("rail: downstream blocked by the plan", /\b(cost|tender|boq_review)\b/.test(blocked), blocked);
  check("the mock 'Worth a second look' card is gone", !(await q(`document.body.textContent.includes("Worth a second look")`)));
  check("Save changes is disabled with its reason until something changes", (await q(`document.querySelector('[data-testid="plan-save"]')?.getAttribute('aria-disabled')`)) === "true");
  if (SHOTS) await b.screenshot(`${SHOTS}/k5-plan-overlaps.png`);

  await q(`document.querySelector('[data-testid="overlap-list"] button').click()`);
  check("an overlap row selects both rooms", await b.until(`document.querySelectorAll('[data-focus-room]').length === 2`, 5000));
  if (SHOTS) await b.screenshot(`${SHOTS}/k5-plan-pair-selected.png`);

  await q(`document.querySelector('[data-testid="fix-overlaps"]').click()`);
  check("Fix overlaps → Save becomes enabled", await b.until(`document.querySelector('[data-testid="plan-save"]')?.getAttribute('aria-disabled') === "false"`, 10000));
  await q(`document.querySelector('[data-testid="plan-save"]').click()`);
  check("saved → the panel reads 'can be priced'", await b.until(`document.querySelector('[data-plan-check]')?.getAttribute('data-plan-check') === "clean"`, 60000), await q(`document.querySelector('[data-plan-check]')?.textContent.slice(0, 160)`));
  await b.goto(url, "[data-plan-check]");
  const after = await q(`[...document.querySelectorAll('[data-step][data-state="blocked"]')].map((a) => a.getAttribute('data-step')).join(",")`);
  check("rail: costing no longer blocked by the plan", !/\b(cost|tender|boq_review)\b/.test(after), after || "none blocked");
  if (SHOTS) await b.screenshot(`${SHOTS}/k5-plan-clean.png`);
} finally {
  await b.close();
}
console.log(failures === 0 ? "\nK5 PLAN CHECK PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
