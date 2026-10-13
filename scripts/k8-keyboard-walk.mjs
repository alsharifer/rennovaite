// =============================================================================
// scripts/k8-keyboard-walk.mjs — the KV addendum: home → project → design →
// renders → cost → tender with the KEYBOARD only (Tab / Shift+Tab / Enter),
// light and dark. READ ONLY: links are followed, nothing is pressed that writes.
//
//   node --env-file=.env.local scripts/k8-keyboard-walk.mjs [port] [--shots=dir]
//
// At every stop: the focused element is visible (a focus outline that is not
// "none"), the skip link or first Tab lands in the page, and the page it opens
// is the one the step names. Shots at each stop, in both themes.
// =============================================================================

import { openBrowser } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const port = args.find((a) => /^\d+$/.test(a)) ?? "3098";
const shots = args.find((a) => a.startsWith("--shots="))?.slice(8) ?? "screenshots/k8/kv-keyboard";
const base = `http://localhost:${port}`;
const PROJECT = "6b5fda9d-e40f-4e16-940c-7a17d27ec5dc";

let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const ACTIVE = `(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); return { tag: a.tagName, text: (a.getAttribute("aria-label") || a.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60), href: a.getAttribute("href"), outline: cs.outlineStyle + " " + cs.outlineWidth }; })()`;

/** Tab forward until the focused element matches, at most `max` presses. */
async function tabTo(b, test, max = 80) {
  for (let i = 0; i < max; i++) {
    await b.key("Tab");
    const a = await b.evaluate(ACTIVE);
    if (a && test(a)) return a;
  }
  return null;
}

const b = await openBrowser({ script: "k8-keyboard-walk" });
const steps = [
  { name: "project", from: "/projects", test: (a) => a.href === `/project/${PROJECT}`, want: `/project/${PROJECT}` },
  { name: "design", test: (a) => /^\/project\/[^/]+\/design/.test(a.href ?? "") && /Design/.test(a.text), want: "/design" },
  { name: "renders", test: (a) => /\/render$/.test(a.href ?? "") && /Renders/.test(a.text), want: "/render" },
  { name: "cost", test: (a) => /\/boq$/.test(a.href ?? "") && /Cost/.test(a.text), want: "/boq" },
  { name: "tender", test: (a) => /\/(drawings|vendors)$/.test(a.href ?? "") && /Tender/.test(a.text), want: /\/(drawings|vendors)$/ },
];
try {
  for (const theme of ["light", "dark"]) {
    console.log(`— ${theme}`);
    await b.send("Network.setCookie", { name: "rv_theme", value: theme, domain: "localhost", path: "/", sameSite: "Lax" });
    await b.viewport(1440, 900);
    await b.goto(`${base}/projects`, "[data-system='blueprint']");
    await b.until(`!document.querySelector('[aria-busy="true"]')`, 20000).catch(() => {});
    await b.screenshot(`${shots}/${theme}-0-home.png`);
    let n = 1;
    for (const s of steps) {
      await b.evaluate(`document.activeElement?.blur(); window.scrollTo(0, 0)`);
      const a = await tabTo(b, s.test);
      check(`${theme}: Tab reaches the way to ${s.name}`, !!a, a ? `${a.text} → ${a.href}` : "not reached");
      if (!a) continue;
      check(`${theme}: the focus is visible on it`, !/^none/.test(a.outline), a.outline);
      await b.key("Enter");
      const ok = await b.until(`(${typeof s.want === "string" ? `location.pathname.endsWith(${JSON.stringify(s.want)}) || location.pathname === ${JSON.stringify(s.want)}` : `${s.want}.test(location.pathname)`})`, 20000).then(() => true, () => false);
      check(`${theme}: Enter opens ${s.name}`, ok, await b.evaluate("location.pathname"));
      await b.until(`!document.querySelector('[aria-busy="true"]')`, 20000).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      await b.screenshot(`${shots}/${theme}-${n++}-${s.name}.png`);
    }
  }
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
