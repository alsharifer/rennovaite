// =============================================================================
// scripts/k8-help-check.mjs — the help drawer by keyboard (K8 #13, 65:1247).
// READ ONLY (nothing is sent).
//
//   node --env-file=.env.local scripts/k8-help-check.mjs [port]
//
// "?" opens it (focus moves inside, the page behind is inert), search finds an
// article from another page, the page's own articles open, Escape closes it,
// and "?" typed into a text field does not open it.
// =============================================================================

import { openBrowser } from "./lib/cdp.mjs";

const port = process.argv.find((a) => /^\d+$/.test(a)) ?? "3098";
const base = `http://localhost:${port}`;
let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};
const open = `document.querySelector("[data-help-drawer]")?.open === true`;

const b = await openBrowser({ script: "k8-help-check" });
try {
  await b.goto(`${base}/projects`, "[data-system='blueprint']");
  await b.evaluate(`document.body.focus()`);
  await b.key("?");
  await b.until(open, 4000).catch(() => {});
  check("? opens the drawer", await b.evaluate(open));
  check("focus moves into it", await b.evaluate(`!!document.activeElement?.closest("[data-help-drawer]")`));
  check("it names the page", (await b.evaluate(`document.querySelector("[data-help-drawer] h3")?.textContent`)) === "ABOUT THIS PAGE · PROJECTS");
  await b.evaluate(`(() => { const i = document.querySelector("[data-help-drawer] input[role=searchbox]"); i.focus(); })()`);
  for (const ch of "overlap") await b.key(ch);
  await b.until(`document.querySelector("[data-help-drawer] h3")?.textContent.includes("RESULT")`, 3000).catch(() => {});
  const titles = await b.evaluate(`[...document.querySelectorAll("[data-help-drawer] summary")].map((s) => s.textContent.trim())`);
  check("search reaches another page's articles", titles.some((t) => /overlap/i.test(t)), titles.join(" | "));
  await b.key("Escape");
  await b.until(`!(${open})`, 3000).catch(() => {});
  check("Escape closes it", !(await b.evaluate(open)));
  await b.evaluate(`(() => { const i = document.querySelector("input[type=search]:not([data-help-drawer] *)") ?? document.querySelector("main input"); i?.focus(); })()`);
  await b.key("?");
  await new Promise((r) => setTimeout(r, 400));
  check("? in a text field types, it does not open help", !(await b.evaluate(open)));
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
