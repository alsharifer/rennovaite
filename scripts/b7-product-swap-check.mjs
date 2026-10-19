// =============================================================================
// scripts/b7-product-swap-check.mjs — B7 item 5, live: "Choose a cheaper
// product" on a BoQ line. Opens the shower-glass line, swaps the product, checks
// the new revision and its cause "Product changed by <name>", then swaps back
// (the dev test bathroom ends where it started). Signed-in headless Chrome.
//
//   node --env-file=.env.local scripts/b7-product-swap-check.mjs [port] [project-id]
// =============================================================================

import { mkdirSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { openBrowser } from "./lib/cdp.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

const SCRIPT = "b7-product-swap-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const P = process.argv.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? "a2661f34-9d96-4020-a755-40359440c302";
const BASE = `http://localhost:${PORT}`;
const SHOTS = "screenshots/bathroom-pilot/b7";
mkdirSync(SHOTS, { recursive: true });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const latest = async () => (await sb.from("boqs").select("id, total_aed").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single()).data;

const app = devFetch("b1-owner", { script: SCRIPT });
const b = await openBrowser({ who: "b1-owner", script: SCRIPT });
const start = await latest();
try {
  await b.viewport(1440, 1100);
  const swap = async (to) => {
    await b.goto(`${BASE}/project/${P}/boq`, "[data-display-total]");
    // Open the shower-glass line (fixed panel or enclosure, whichever is in the BoQ).
    await b.evaluate(`(() => { const row = [...document.querySelectorAll('[role="row"]')].find((r) => /walk-in glass panel|glass enclosure/i.test(r.innerText)); row.click(); })()`);
    for (let i = 0; i < 20 && !(await b.evaluate(`!!document.querySelector('[data-product-picker]')`)); i++) await sleep(300);
    const options = await b.evaluate(`[...document.querySelectorAll('[data-product-option]')].map((x) => x.getAttribute('data-product-option')).join(",")`);
    await b.evaluate(`document.querySelector('[data-product-option="${to}"]').click()`);
    await sleep(200);
    await b.screenshot(`${SHOTS}/5-product-picker-${to}.png`);
    await b.evaluate(`document.querySelector('[data-testid="product-use"]').click()`);
    for (let i = 0; i < 120 && !(await b.evaluate(`!!document.querySelector('[data-product-result], [data-product-picker] [role="alert"]')`)); i++) await sleep(1000);
    const result = await b.evaluate(`document.querySelector('[data-product-result]')?.innerText ?? document.querySelector('[data-product-picker] [role="alert"]')?.innerText ?? ""`);
    return { options, result };
  };

  const one = await swap("enclosure");
  check("the glass line offers the shower-glass products", one.options === "enclosure,fixed_panel", one.options);
  const after = await latest();
  check("choosing the hinged enclosure makes a new revision", after.id !== start.id, `${one.result}`);
  const diff = await (await app(`${BASE}/api/projects/${P}/boq-diff?from=${start.id}&to=${after.id}`)).json();
  const causes = JSON.stringify(diff).match(/Product changed by [^"]+/g) ?? [];
  check("the diff names the cause: Product changed by <name>", causes.length > 0, causes[0] ?? "none");
  const back = await swap("fixed_panel");
  const end = await latest();
  check("swapping back returns the BoQ to its total", Number(end.total_aed) === Number(start.total_aed), `${start.total_aed} → ${after.total_aed} → ${end.total_aed} · ${back.result}`);
} finally {
  await b.close();
}
console.log(failures === 0 ? "\nB7 PRODUCT SWAP: ALL CHECKS PASSED" : `\nB7 PRODUCT SWAP: ${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
