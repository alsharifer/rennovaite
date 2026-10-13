#!/usr/bin/env node
// =============================================================================
// scripts/k10-spec-grid-shots.mjs — K10 #7 live: on 04 Cost → Specification
// the options sit in three EQUAL cells down to 1100 px, then stack.
//
//   node --env-file=.env.local scripts/k10-spec-grid-shots.mjs [port] [--shots=screenshots/k10/spec]
//
// Read-only: the dev Demo villa's Specification page, opened by the pipeline
// account (already a member) — the page writes nothing until an option is
// clicked, and this script clicks nothing.
// =============================================================================

import { openBrowser } from "./lib/cdp.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) ?? "--shots=screenshots/k10/spec").slice(8);
const DEMO = "6b5fda9d-e40f-4e16-940c-7a17d27ec5dc";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const MEASURE = `(() => {
  const ul = [...document.querySelectorAll("[data-spec-options]")].find((u) => u.children.length === 3);
  if (!ul) return null;
  const r = [...ul.children].map((li) => li.getBoundingClientRect());
  return { tops: r.map((x) => Math.round(x.top)), widths: r.map((x) => Math.round(x.width)), overflow: document.documentElement.scrollWidth > innerWidth };
})()`;

for (const theme of ["light", "dark"]) {
  const b = await openBrowser({ who: "pipeline", script: "k10-spec-grid-shots" });
  try {
    await b.send("Network.setCookie", { name: "rv_theme", value: theme, domain: "localhost", path: "/" });
    for (const [w, mobile] of [[1440, false], [1280, false], [1100, false], [1099, false], [390, true]]) {
      await b.viewport(w, 1000, { mobile });
      await b.goto(`${BASE}/project/${DEMO}/accessories`, "[data-spec-options]");
      const m = await b.evaluate(MEASURE);
      if (!m) {
        check(`${theme} ${w}px: an item with three options`, false, "none found");
        continue;
      }
      const oneRow = new Set(m.tops).size === 1;
      const equal = Math.max(...m.widths) - Math.min(...m.widths) <= 1;
      if (w >= 1100) check(`${theme} ${w}px: three equal cells in one row`, oneRow && equal, `widths ${m.widths.join(" / ")}`);
      else check(`${theme} ${w}px: stacked, one per row`, new Set(m.tops).size === 3, `tops ${m.tops.join(" / ")}`);
      check(`${theme} ${w}px: no horizontal scroll`, !m.overflow);
      await b.evaluate(`[...document.querySelectorAll("[data-spec-options]")].find((u) => u.children.length === 3)?.scrollIntoView({ block: "center" })`);
      await b.screenshot(`${SHOTS}/${theme === "dark" ? "dark/" : ""}${w}.png`);
    }
  } finally {
    await b.close();
  }
}
console.log(failures === 0 ? "\nALL K10 SPEC-GRID CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
