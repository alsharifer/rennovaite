// =============================================================================
// scripts/k-page-check.mjs — axe + screenshots of Blueprint pages, light and
// dark, at desktop / tablet / phone (K4–K7, KV).
//
//   node scripts/k-page-check.mjs [port] --shots=screenshots/k4 [--projects=<id,id>] \
//        name=/project/<id>/boq/revisions [name2=/firms/<id> …] [--sizes=desktop,tablet,phone] [--anon]
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
const SIZE = { desktop: [1440, 1000], tablet: [834, 1112], phone: [390, 844] };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const anon = args.includes("--anon");
const b = await openBrowser({ script: "k-page-check", projects, signedIn: !anon });
let failures = 0;
try {
  for (const [name, path] of pages) {
    for (const size of sizes) {
      const [w, h] = SIZE[size];
      await b.viewport(w, h, size === "phone" ? { mobile: true, touch: true } : {});
      await b.goto(`http://localhost:${port}${path}`, "main, [data-system]");
      await new Promise((r) => setTimeout(r, 1200));
      for (const theme of size === "desktop" ? ["light", "dark"] : ["light"]) {
        await b.evaluate(`window.scrollTo(0, 0); document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
        await new Promise((r) => setTimeout(r, 400));
        const scope = `document.querySelector('main [data-system="blueprint"], [data-system="blueprint"]')`;
        const hasBp = await b.evaluate(`!!${scope}`);
        const v = hasBp ? await b.axe(scope) : [];
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
