// =============================================================================
// scripts/k-page-check.mjs — axe + screenshots of Blueprint pages, light and
// dark, at desktop / tablet / phone (K4–K7, KV).
//
//   node scripts/k-page-check.mjs [port] --shots=screenshots/k4 [--projects=<id,id>] \
//        name=/project/<id>/boq/revisions [name2=/firms/<id> …] [--sizes=desktop,tablet,phone,reflow] [--anon] [--who=walkthrough]
//
// Signs in as the pipeline dev account (scripts/lib/dev-auth.mjs — a real
// session, no bypass) and makes it a member of --projects. A page is checked
// inside its `[data-system="blueprint"]` root; Atelier pages are skipped by
// axe (they are out of this cycle's scope) but still photographed. Exit 1 on
// any violation.
// =============================================================================

import fs from "node:fs";

import { openBrowser } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 3098);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const SHOTS = opt("shots");
const projects = (opt("projects") ?? "").split(",").filter(Boolean);
const sizes = (opt("sizes") ?? "desktop").split(",");
const pages = args.filter((a) => !a.startsWith("--") && a.includes("=")).map((a) => a.split(/=(.*)/s).slice(0, 2));
// reflow = 1280 CSS px at 400% zoom (WCAG 1.4.10): the page must fit 320 px without horizontal scroll.
const SIZE = { desktop: [1440, 1000], laptop: [1280, 900], tablet: [834, 1112], phone: [390, 844], reflow: [320, 800] };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const anon = args.includes("--anon");
const who = opt("who") ?? "pipeline";
const b = await openBrowser({ script: "k-page-check", who, projects, signedIn: !anon });
let failures = 0;
try {
  for (const [name, path] of pages) {
    for (const size of sizes) {
      const [w, h] = SIZE[size];
      await b.viewport(w, h, size === "phone" || size === "reflow" ? { mobile: true, touch: true } : {});
      await b.goto(`http://localhost:${port}${path}`, "main, [data-system]");
      await new Promise((r) => setTimeout(r, 1200));
      for (const theme of size === "desktop" ? ["light", "dark"] : ["light"]) {
        await b.evaluate(`window.scrollTo(0, 0); document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
        await new Promise((r) => setTimeout(r, 400));
        const scope = `document.querySelector('main [data-system="blueprint"], [data-system="blueprint"]')`;
        const hasBp = await b.evaluate(`!!${scope}`);
        const v = hasBp ? await b.axe(scope) : [];
        // K7: every aria-describedby must point at an element that exists (a disabled control's reason);
        // and nothing may widen the page past the viewport (reflow; scroll regions excepted).
        const dangling = await b.evaluate(`[...document.querySelectorAll("[aria-describedby]")].flatMap((el) => el.getAttribute("aria-describedby").split(" ").filter((id) => id && !document.getElementById(id)).map((id) => el.tagName.toLowerCase() + "→#" + id))`);
        if (dangling.length) v.push({ id: "describedby-missing", nodes: dangling });
        const overflow = await b.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
        if (overflow > 1) v.push({ id: "horizontal-overflow", nodes: [overflow + " px"] });
        const tag = `${name}-${size}-${theme}`;
        if (v.length) failures++;
        console.log(`${v.length ? "FAIL" : "ok  "} ${tag}${hasBp ? "" : " (no Blueprint root — not axed)"}${v.length ? "  " + v.map((x) => `${x.id} (${x.nodes.length}) ${x.nodes[0] ?? ""}`).join(" | ").slice(0, 600) : ""}`);
        const height = await b.evaluate(`document.documentElement.scrollHeight`);
        if (SHOTS) {
          await b.screenshot(`${SHOTS}/${tag}.png`, { fullPage: true });
          console.log(`       shot → ${SHOTS}/${tag}.png · page height ${height}px`);
        }
      }
    }
  }
} finally {
  await b.evaluate(`document.documentElement.setAttribute("data-theme", "light")`).catch(() => {});
  await b.close();
}
console.log(failures === 0 ? "\nALL PAGES CLEAN" : `\n${failures} PAGE STATE(S) WITH VIOLATIONS`);
process.exit(failures === 0 ? 0 : 1);
