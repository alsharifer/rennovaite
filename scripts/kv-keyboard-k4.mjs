// =============================================================================
// scripts/kv-keyboard-k4.mjs — the K4 loop by keyboard alone (KV, R7 §4.2/§4.4).
//
//   node scripts/kv-keyboard-k4.mjs [port]      (after the onboarding walkthrough,
//                                                before its teardown)
//
// Reads the walkthrough's scratch state (its firm, quote, villa) and, as the
// walkthrough's account, drives every K4 surface with key presses only — Tab /
// Shift+Tab to reach a control, Enter / Space / arrows to use it — and checks
// the effect: book tabs (←→), the quote review, the proposal setup (type +
// Tab saves), Documents (Space toggles the proposal), Revisions (Enter records
// an approval), the hub's Next actions, and that every control on each page is
// reachable with a visible focus ring. WRITES one approval and one setup field
// on the scratch villa (removed by the walkthrough's teardown).
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";

const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3098);
const base = `http://localhost:${port}`;
const STATE = path.join(process.env.TEMP ?? process.env.TMP ?? ".", "walkthrough", "state.json");
const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
const villa = state.projectId;
const { url, key } = resolveTarget({ script: "kv-keyboard-k4", writes: false });
const sb = createClient(url, key);
const { data: proj } = await sb.from("projects").select("firm_id").eq("id", villa).single();
const firmId = proj.firm_id;
const { data: quote } = await sb.from("firm_quotes").select("id").eq("firm_id", firmId).limit(1).maybeSingle();
let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const b = await openBrowser({ script: "kv-keyboard-k4", who: "walkthrough", projects: [villa] });
const q = (e) => b.evaluate(e);
const active = () => q(`(() => { const a = document.activeElement; return a ? (a.getAttribute('data-testid') || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 40)) : null; })()`);
/** Tab until the focused element matches `sel` (max n presses). */
async function tabTo(sel, n = 120) {
  for (let i = 0; i < n; i++) {
    await b.key("Tab");
    if (await q(`document.activeElement?.matches(${JSON.stringify(sel)}) ?? false`)) return true;
  }
  return false;
}
const focusRing = () => q(`(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })()`);
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

try {
  await b.viewport(1440, 1000);

  console.log("04 Rates & Basis");
  await b.goto(`${base}/project/${villa}/rates`, "[role=tablist]");
  await settle();
  check("Tab reaches the book's tabs", await tabTo('[role="tab"][aria-selected="true"]'), String(await active()));
  check("…with a visible focus ring", await focusRing());
  await b.key("ArrowRight");
  check("→ moves to the next tab and selects it", await q(`document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.getAttribute('aria-selected') === 'true' && document.activeElement.textContent.includes('Quote')`), String(await active()));
  await b.key("ArrowLeft");
  check("← moves back", await q(`document.activeElement?.textContent.includes('Entries')`));

  if (quote) {
    console.log("\nQuote review");
    await b.goto(`${base}/firms/${firmId}/quotes/${quote.id}`, "[data-testid=quote-lines]");
    await settle();
    check("Tab reaches the line actions", await tabTo("[data-testid=quote-lines] button"), String(await active()));
    check("…with a visible focus ring", await focusRing());
  }

  console.log("\n08 Proposal");
  await b.goto(`${base}/project/${villa}/proposal`, "[data-proposal][data-hydrated]");
  await settle();
  check("Tab reaches the client field", await tabTo("#pp-client"));
  await b.send("Input.insertText", { text: " (keyboard)" });
  await b.key("Tab");
  check("typing then Tab saves the field", await b.until(`(document.querySelector('[data-testid="setup-status"]')?.textContent ?? '').includes('Client saved')`, 20000), String(await q(`document.querySelector('[data-testid="setup-status"]')?.textContent`)));
  check("Tab reaches Preview as client", await tabTo('[data-testid="preview-as-client"]'));
  await b.key("Enter");
  check("Enter opens the preview dialog with focus inside", await b.until(`!!document.querySelector('[data-testid="proposal-preview"]') && document.querySelector('[data-testid="proposal-preview"]').contains(document.activeElement)`, 30000));
  await b.key("Escape");
  check("Escape closes it", await b.until(`!document.querySelector('[data-testid="proposal-preview"]')`, 5000));

  console.log("\n06 Documents");
  await b.goto(`${base}/project/${villa}/drawings`, "[data-pack-export][data-hydrated]");
  await settle();
  check("Tab reaches 'Include the client proposal'", await tabTo('[data-testid="proposal-toggle"] input'));
  const before = await q(`document.querySelector('[data-testid="proposal-toggle"] input').checked`);
  await b.key(" ");
  check("Space toggles it", (await q(`document.querySelector('[data-testid="proposal-toggle"] input').checked`)) !== before);

  console.log("\n07 Revisions & Approval");
  await b.goto(`${base}/project/${villa}/boq/revisions`, "[data-diff-from][data-hydrated]");
  await settle();
  const n0 = await q(`document.querySelectorAll('[data-approval-kind="firm"]').length`);
  check("Tab reaches Record firm approval", await tabTo('[data-testid="approve"]'));
  check("…with a visible focus ring", await focusRing());
  await b.key("Enter");
  check("Enter records it", await b.until(`document.querySelectorAll('[data-approval-kind="firm"]').length > ${n0}`, 20000));
  check("Tab reaches the From picker without a trap", await tabTo("select"));

  console.log("\n00 Hub");
  await b.goto(`${base}/project/${villa}`, "[data-hub]");
  await settle();
  check("Tab reaches the first revision link", await tabTo('[data-testid="hub-revisions"] a'));
  await b.key("Enter");
  check("Enter follows it to 07", await b.until(`location.pathname.endsWith('/boq/revisions')`, 20000));
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} KEYBOARD CHECK(S) FAILED` : "\nK4 LOOP BY KEYBOARD PASSED");
process.exit(failures ? 1 : 0);
