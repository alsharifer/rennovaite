// =============================================================================
// scripts/k8-dark-check.mjs — K8 Part 3: Dark, the real way. READ ONLY.
//
//   node --env-file=.env.local scripts/k8-dark-check.mjs [port] [--shots=dir] [name=/path …]
//
// The rv_theme cookie is set BEFORE any page loads (the path a reader takes),
// never the data-theme attribute after the fact. For every route:
//   · no flash — the theme on <html> at the moment <body> first exists, and at
//     the first animation frame, is already "dark" (the pre-paint script ran);
//   · axe with colour contrast, in the dark palette;
//   · a desktop screenshot (1440 × 900) for the side-by-side with its Dark frame.
// Then System: cookie "system" + the OS in dark → dark; OS light → light; and
// a change of the OS setting is followed without a reload.
// The default routes are the owner journey on the dev demo villa (visited,
// never written) and the shell pages; pass name=/path to override.
// =============================================================================

import { openBrowser } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const port = args.find((a) => /^\d+$/.test(a)) ?? "3098";
const shots = args.find((a) => a.startsWith("--shots="))?.slice(8) ?? "screenshots/k8/dark";
const base = `http://localhost:${port}`;
const P = "/project/6b5fda9d-e40f-4e16-940c-7a17d27ec5dc";
const given = args.filter((a) => /^[\w-]+=\//.test(a)).map((a) => a.split(/=(.+)/).slice(0, 2));
const ROUTES = given.length
  ? given
  : [
      ["home", "/projects"],
      ["overview", P],
      ["plan", `${P}/plan`],
      ["design-direction", `${P}/design`],
      ["design-references", `${P}/design?view=references`],
      ["renders", `${P}/render`],
      ["boq", `${P}/boq`],
      ["specification", `${P}/accessories`],
      ["timeline", `${P}/timeline`],
      ["documents", `${P}/drawings`],
      ["tender", `${P}/vendors`],
      ["viewer", `${P}/viewer`],
      ["revisions", `${P}/boq/revisions`],
      ["settings", "/settings"],
      ["rate-books", "/firms"],
      ["not-found", "/no-such-page"],
      ["reading-plan", "/dev/reading-plan"],
      ["help-drawer", "/projects?help=1"],
      ["intake", "/project/new"],
      ["legal", "/privacy"],
    ];

let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

// Records the theme when <body> first appears and at the first frame — before anything a reader could see.
const PROBE = `(() => {
  window.__k8 = { atBody: null, atFrame: null };
  // <html> does not exist yet when this runs: watch the document itself.
  const theme = () => document.documentElement && document.documentElement.getAttribute("data-theme");
  const mo = new MutationObserver(() => { if (document.body && window.__k8.atBody === null) { window.__k8.atBody = theme(); mo.disconnect(); } });
  mo.observe(document, { childList: true, subtree: true });
  requestAnimationFrame(() => { window.__k8.atFrame = theme(); });
})();`;

const b = await openBrowser({ script: "k8-dark-check" });
const cookie = (value) => b.send("Network.setCookie", { name: "rv_theme", value, domain: "localhost", path: "/", sameSite: "Lax" });
try {
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
  await b.viewport(1440, 900);
  await cookie("dark");
  console.log("1. Dark, from the cookie, on every route");
  for (const [name, path] of ROUTES) {
    await b.goto(`${base}${path}`, "body");
    await b.until(`window.__k8 && window.__k8.atFrame !== null`, 5000).catch(() => {});
    // Past the segment's loading state (aria-busy skeleton) before judging the page.
    await b.until(`!document.querySelector('[aria-busy="true"]')`, 30000).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    const probe = await b.evaluate(`({ ...window.__k8, now: document.documentElement.getAttribute("data-theme"), blueprint: !!document.querySelector('[data-system="blueprint"]') })`);
    check(`${name}: dark before the first paint`, probe.atBody === "dark" && probe.atFrame === "dark" && probe.now === "dark", JSON.stringify(probe));
    check(`${name}: a Blueprint page`, probe.blueprint);
    const v = await b.axe();
    check(`${name}: axe (incl. contrast) in dark`, v.length === 0, v.map((x) => `${x.id}: ${x.nodes[0] ?? ""}`).join(" | "));
    await b.screenshot(`${shots}/${name}-dark.png`);
  }

  console.log("2. System follows the OS");
  await cookie("system");
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await b.goto(`${base}/projects`, "body");
  check("System + OS dark → dark", (await b.evaluate(`document.documentElement.getAttribute("data-theme")`)) === "dark");
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await new Promise((r) => setTimeout(r, 300));
  check("…and follows the OS to light without a reload", (await b.evaluate(`document.documentElement.getAttribute("data-theme")`)) === "light");
  await cookie("light");
  await b.goto(`${base}/projects`, "body");
  check("Light stays light whatever the OS", (await b.evaluate(`document.documentElement.getAttribute("data-theme")`)) === "light");
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
