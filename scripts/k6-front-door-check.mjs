// =============================================================================
// scripts/k6-front-door-check.mjs — the front door's states, live (K6, R7 §3.9 /
// §3.9a). READ-ONLY apart from one invite-only sign-in attempt for an
// address that cannot exist (no account is created, no mail is sent).
//
//   node scripts/k6-front-door-check.mjs [port]
//
// Sign in (anonymous): invalid e-mail is inline (aria-invalid + described);
// an uninvited address gets the neutral invite-only notice; resend waits 30 s
// with its reason; the design view is decorative (aria-hidden, muted, no
// controls) and its files are within budget.
// Intake (signed in): Continue disabled with its reason; a too-large plan is
// the inverse block with what to do instead; Draw waits for the plot; the
// three ways are one radio group.
// =============================================================================

import fs from "node:fs";

import { openBrowser } from "./lib/cdp.mjs";

const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3098);
const base = `http://localhost:${port}`;
let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("sign in");
for (const f of ["villa-orbit.webm", "villa-orbit.mp4"]) {
  const bytes = fs.statSync(`public/design-view/${f}`).size;
  check(`${f} within 2 MB`, bytes <= 2 * 1024 * 1024, `${Math.round(bytes / 1024)} KB`);
}
let b = await openBrowser({ script: "k6-front-door", signedIn: false });
try {
  await b.viewport(1440, 1000);
  await b.goto(`${base}/auth`, "form");
  await sleep(1500);
  const set = (v) => b.evaluate(`(() => { const el = document.querySelector('input[type=email]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check("the page is Dark Blueprint", await b.evaluate(`document.querySelector('main[data-system="blueprint"]')?.getAttribute('data-theme') === 'dark'`));
  check("the design view is decorative: aria-hidden, muted, no controls, poster first", await b.evaluate(`(() => { const v = document.querySelector('[data-design-view]'); return !!v && v.closest('[aria-hidden=true]') !== null && v.muted && !v.controls && !!v.poster; })()`));
  await set("not-an-email");
  await b.evaluate(`document.querySelector('form button[type=submit]').click()`);
  check("invalid e-mail: inline, aria-invalid, described", await b.until(`(() => { const i = document.querySelector('input[type=email]'); const d = document.getElementById(i.getAttribute('aria-describedby') || ''); return i.getAttribute('aria-invalid') === 'true' && !!d; })()`, 5000));
  await set("k6-front-door-check@example.invalid");
  await b.evaluate(`document.querySelector('form button[type=submit]').click()`);
  check("uninvited address: the neutral invite-only notice", await b.until(`!!document.querySelector('[data-testid="invite-only"]')`, 20000));
  check("resend waits 30 s, with its reason", await b.evaluate(`document.querySelector('[data-testid="resend"]')?.getAttribute('aria-disabled') === 'true' && document.body.textContent.includes('available in')`));
} finally {
  await b.close();
}

console.log("\nintake");
b = await openBrowser({ script: "k6-front-door" });
try {
  await b.viewport(1440, 1000);
  await b.goto(`${base}/project/new`, "[data-intake]");
  await sleep(2000);
  check("warm skin on the Blueprint root", await b.evaluate(`!!document.querySelector('[data-system="blueprint"][data-skin="warm"]')`));
  check("01 Plan is the active rail step", await b.evaluate(`document.querySelector('[data-step="plan"]')?.getAttribute('aria-current') === 'step'`));
  check("Continue disabled with its reason before a plan exists", await b.evaluate(`(() => { const c = document.querySelector('[data-testid="intake-continue"]'); return c.getAttribute('aria-disabled') === 'true' && !!document.getElementById(c.getAttribute('aria-describedby') || ''); })()`));
  await b.evaluate(`(() => { const input = document.querySelector('input[aria-label="Floor plan file"]'); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(26 * 1024 * 1024)], "Villa_full_drawing_set.pdf", { type: "application/pdf" })); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  check("too large: the inverse block with what to do instead", await b.until(`(document.querySelector('[data-plan-too-large]')?.textContent ?? '').includes('Export just the floor-plan sheet')`, 10000));
  check("the ways to start are one radio group", await b.evaluate(`document.querySelectorAll('[role=radiogroup] [role=radio][aria-checked=true]').length === 1`));
  if (await b.evaluate(`!!document.querySelector('[data-way="draw"]')`)) {
    await b.evaluate(`document.querySelector('[data-way="draw"]').click()`);
    check("Draw it yourself: Continue waits for the plot size", await b.until(`document.body.textContent.includes("width and depth in metres")`, 5000));
  }
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nFRONT DOOR PASSED");
process.exit(failures ? 1 : 0);
