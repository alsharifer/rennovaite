#!/usr/bin/env node
// =============================================================================
// scripts/k10-signin-code-check.mjs — K10 #2 live: sign in with the code from
// the e-mail, in a fresh headless browser that never requested anything (the
// "code read on another device" case), plus the replaced / expired code state.
//
//   node --env-file=.env.local scripts/k10-signin-code-check.mjs [port] [--shots=screenshots/k10/signin]
//
// Nothing is e-mailed: the admin API's generateLink returns the same one-time
// code the magic-link e-mail would carry ({{ .Token }}). Generating twice makes
// the first code a REPLACED one — the error state — and the second one signs in.
// A dev script account only (dev-scripts+k10-code@…).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) ?? "--shots=screenshots/k10/signin").slice(8);
const { url, key } = resolveTarget({ script: "k10-signin-code-check", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
const EMAIL = "dev-scripts+k10-code@rennovaite.local";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const { error: ce } = await sb.auth.admin.createUser({ email: EMAIL, email_confirm: true });
if (ce && !/already|exists|registered/i.test(ce.message)) throw ce;
const otp = async () => {
  const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  if (error) throw error;
  return data.properties.email_otp;
};

const fill = (b, testid, value) =>
  b.evaluate(`(() => { const i = document.querySelector('[data-testid="code-entry"] ${testid}'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);

for (const [label, vp] of [["desktop", { w: 1440, h: 1000, mobile: false }], ["phone", { w: 390, h: 844, mobile: true }]]) {
  const first = await otp();
  const second = await otp();
  check(`${label}: the e-mailed code is digits the form accepts (6–10)`, /^\d{6,10}$/.test(second ?? ""), `length ${String(second ?? "").length}`);
  if (String(second ?? "").length !== 6) console.log(`  NOTE  this project issues ${String(second ?? "").length}-digit codes — set Auth → Email → "Email OTP Length" to 6 (the brief)`);
  const b = await openBrowser({ signedIn: false, script: "k10-signin-code-check" });
  try {
    await b.viewport(vp.w, vp.h, { mobile: vp.mobile, touch: vp.mobile });
    await b.goto(`${BASE}/auth?next=/projects`, "[data-testid='have-code']");
    await b.evaluate(`document.querySelector('[data-testid="have-code"]').click()`);
    await b.until(`!!document.querySelector('[data-testid="code-entry"]')`);
    await fill(b, 'input[type="email"]', EMAIL);
    await b.screenshot(`${SHOTS}/${label}-1-code-entry.png`);
    check(`${label}: code entry — axe clean`, (await b.axe()).length === 0, JSON.stringify(await b.axe()).slice(0, 300));

    // The replaced code: the same answer as an expired one, in the inverse block.
    await fill(b, '[data-testid="code-input"]', first);
    await b.evaluate(`document.querySelector('[data-testid="code-submit"]').click()`);
    await b.until(`!!document.querySelector('[data-testid="code-error"]')`, 20000);
    const msg = await b.evaluate(`document.querySelector('[data-testid="code-error"]')?.textContent ?? ""`);
    check(`${label}: a replaced code is refused with the one answer`, /didn.t work — it may have expired or been replaced/.test(msg), msg);
    check(`${label}: still signed out after a bad code`, (await b.evaluate("location.pathname")) === "/auth");
    await b.screenshot(`${SHOTS}/${label}-2-code-expired.png`);
    check(`${label}: error state — axe clean`, (await b.axe()).length === 0, JSON.stringify(await b.axe()).slice(0, 300));

    // The newest code signs in — on a browser that never asked for the e-mail.
    await fill(b, '[data-testid="code-input"]', `${second.slice(0, 3)} ${second.slice(3)}`);
    await b.evaluate(`document.querySelector('[data-testid="code-submit"]').click()`);
    await b.until(`location.pathname === "/projects"`, 30000);
    check(`${label}: the newest code signs in and lands where the visit was going`, (await b.evaluate("location.pathname")) === "/projects", await b.evaluate("location.pathname"));
    const used = await b.evaluate(`fetch("/api/health").then((r) => r.json()).then((j) => j.signed_in)`);
    check(`${label}: the session is real (the API sees a signed-in caller)`, used === true, String(used));
  } finally {
    await b.close();
  }
}

// The existing link states are untouched.
const b = await openBrowser({ signedIn: false, script: "k10-signin-code-check" });
try {
  await b.goto(`${BASE}/auth?error=link_expired`, "[data-testid='link-error']");
  check("the expired-link state still shows", /expired or was already used/.test(await b.evaluate(`document.querySelector('[data-testid="link-error"]')?.textContent ?? ""`)));
  await b.screenshot(`${SHOTS}/desktop-3-link-expired.png`);
} finally {
  await b.close();
}
console.log(failures === 0 ? "\nALL K10 SIGN-IN CODE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
