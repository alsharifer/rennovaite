#!/usr/bin/env node
// =============================================================================
// scripts/k10-proposal-chain-shots.mjs — K10 #3 live: the proposal's price
// summary (page 4) beside the BoQ page's total, for the SAME revision, through
// the app's own routes; and the gate refusing a pre-H7 revision.
//
//   node --env-file=.env.local scripts/k10-proposal-chain-shots.mjs [port] [--shots=screenshots/k10/proposal]
//
// Scratch state only, removed at the end: a scratch firm (book reviewed, so
// the basis passes) and a project carrying two copies of the Arabella G5d
// fixture's stage 7 — first as stored (pre-H7, engine 0.2.0), then as H7
// regeneration prices it (reroundRevision, engine 0.3.0). No real project is
// read or written.
// =============================================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Resvg } from "@resvg/resvg-js";
import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const SHOTS_BASE = (process.argv.find((a) => a.startsWith("--shots=")) ?? "--shots=screenshots/k10/proposal").slice(8);
// --theme=dark: the same run in Dark (the rv_theme cookie, as the app sets it), shots under <dir>/dark.
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = THEME === "dark" ? `${SHOTS_BASE}/dark` : SHOTS_BASE;
const { url, key } = resolveTarget({ script: "k10-proposal-chain-shots", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

// The two revisions, computed by the app's own module (reroundRevision) in a child process.
const fx = JSON.parse(fs.readFileSync("lib/boq/__fixtures__/arabella-g5d-revisions.json", "utf8"));
const stored = fx.boqs[fx.stages[7].boq_id];
const regen = JSON.parse(
  execFileSync(process.execPath, ["--experimental-transform-types", "--import", "./scripts/_alias-hook.mjs", "-e", `const { reroundRevision } = await import("@/lib/boq/totals"); const fx = JSON.parse((await import("node:fs")).readFileSync("lib/boq/__fixtures__/arabella-g5d-revisions.json", "utf8")); process.stdout.write(JSON.stringify(reroundRevision(fx.boqs[fx.stages[7].boq_id])));`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
);

const FONTS = fs.readdirSync("lib/documents/fonts").filter((f) => f.endsWith(".ttf")).map((f) => path.resolve("lib/documents/fonts", f));
const png = (svg, file) => fs.writeFileSync(file, new Resvg(svg.replace(/__PAGE_COUNT__/g, "5"), { fitTo: { mode: "width", value: 1240 }, font: { fontFiles: FONTS, loadSystemFonts: true, defaultFontFamily: "IBM Plex Sans", sansSerifFamily: "IBM Plex Sans", serifFamily: "EB Garamond", monospaceFamily: "JetBrains Mono" } }).render().asPng());

const P = randomUUID();
let firmId = null;
const f = devFetch("k10-admin", { script: "k10-proposal-chain-shots" });
try {
  const me = await (await import("./lib/dev-auth.mjs")).devSession("k10-admin", { script: "k10-proposal-chain-shots" });
  const { data: firm } = await sb.from("firms").insert({ name: `Scratch Landscapes (K10 ${Date.now()})`, created_by: "k10-proposal-chain-shots" }).select("id").single().throwOnError();
  firmId = firm.id;
  await sb.from("firm_members").insert({ firm_id: firmId, user_id: me.userId, role: "admin" }).throwOnError();
  await sb.from("firm_rate_books").insert({ firm_id: firmId, status: "reviewed", reviewed_at: new Date().toISOString() }).throwOnError();
  await sb.from("projects").insert({ id: P, name: "Garden — Draft for Review (K10 scratch)", city: "Dubai", firm_id: firmId, created_by: me.userId }).throwOnError();
  await sb.from("project_members").insert({ project_id: P, user_id: me.userId }).throwOnError();

  // 1. Latest revision = the pre-H7 one: refused with the reason.
  await sb.from("boqs").insert({ project_id: P, total_aed: stored.grand_total_aed, sections: stored, created_at: new Date(Date.now() - 60_000).toISOString() }).throwOnError();
  const g1 = await (await f(`${BASE}/api/projects/${P}/proposal?format=json`)).json();
  check("a pre-H7 latest revision: the proposal gate refuses with the reason", g1.ready === false && g1.verdict?.refusal === "Regenerate first — this revision predates the rounding fix.", JSON.stringify(g1.verdict));
  const b = await openBrowser({ who: "k10-admin", script: "k10-proposal-chain-shots" });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    await b.goto(`${BASE}/project/${P}/proposal`, "main");
    const txt = await b.evaluate("document.body.innerText");
    check("08 Proposal shows the refusal", txt.includes("Regenerate first — this revision predates the rounding fix."));
    await b.screenshot(`${SHOTS}/1-proposal-gate-pre-h7.png`);

    // 2. Regenerated (H7) revision becomes the latest: the proposal and the BoQ page print the same chain.
    await sb.from("boqs").insert({ project_id: P, total_aed: regen.grand_total_aed, sections: regen }).throwOnError();
    const g2 = await (await f(`${BASE}/api/projects/${P}/proposal?format=json`)).json();
    check("the regenerated revision passes the gate (book reviewed)", g2.ready === true, JSON.stringify(g2.verdict));
    const pv = await (await f(`${BASE}/api/projects/${P}/proposal-preview`)).json();
    const pages = pv.pages ?? [];
    const all = pages.join("\n");
    const v = (k) => Number(new RegExp(`data-summary="${k}" data-value="([0-9.]+)"`).exec(all)?.[1]);
    const proposal = { subtotal: v("subtotal"), contingency: v("contingency"), vat: v("vat"), grand: Number(/data-grand-total="([0-9.]+)"/.exec(all)?.[1]) };
    check("the proposal prints 102,892.03 / 8,231.36 / 5,556.17 / 116,679.56", JSON.stringify(proposal) === JSON.stringify({ subtotal: 102892.03, contingency: 8231.36, vat: 5556.17, grand: 116679.56 }), JSON.stringify(proposal));
    const pi = pages.findIndex((p) => p.includes('data-summary="subtotal"'));
    if (pi >= 0) png(pages[pi], `${SHOTS}/2-proposal-price-summary.png`);
    await b.goto(`${BASE}/project/${P}/boq`, "[data-display-total]");
    const page = await b.evaluate(`({ total: Number(document.querySelector("[data-display-total]")?.getAttribute("data-display-total")), text: document.body.innerText })`);
    check("the BoQ page's total is the proposal's total", page.total === proposal.grand, `${page.total} vs ${proposal.grand}`);
    for (const fig of ["102,892.03", "8,231.36", "5,556.17", "116,679.56"]) check(`the BoQ page shows ${fig}`, page.text.includes(fig));
    await b.evaluate(`document.querySelector("[data-display-total]")?.scrollIntoView({ block: "start" })`);
    await b.screenshot(`${SHOTS}/3-boq-page-total.png`);
    await b.evaluate(`[...document.querySelectorAll("*")].find((e) => e.textContent?.trim() === "Subtotal")?.scrollIntoView({ block: "center" })`);
    await b.screenshot(`${SHOTS}/4-boq-page-chain.png`);
  } finally {
    await b.close();
  }
} finally {
  await sb.from("pilot_events").delete().eq("project_id", P);
  await sb.from("boqs").delete().eq("project_id", P);
  await sb.from("projects").delete().eq("id", P);
  if (firmId) await sb.from("firms").delete().eq("id", firmId);
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K10 PROPOSAL-CHAIN CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
