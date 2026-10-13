#!/usr/bin/env node
// =============================================================================
// scripts/k11-add-price-shots.mjs — K11 #4 live: Add a price + corrections that
// apply (spec §7.3, 80:9042 · 80:9088), through the real page and routes.
//
//   node --env-file=.env.local scripts/k11-add-price-shots.mjs [port] [--theme=dark]
//
// Owner scratch project (lib/k11-scratch.mjs: 116,679.56, 3 lines to be priced):
//   1. PLB-01 → inspector → Add a price 650.00 / no (supplier quote) → Apply →
//      rev 2 lands: the headline, the stored row and the excluded count agree,
//      subtotal +1,300.00 exactly; the line reads as your price with its basis;
//   2. the pergola: Capture correction (Apply now is the owner's default) →
//      1,250.00 → rev 3;
//   3. Revisions: the diff names "Price added by …" and "Correction by …";
//      Revert to rev 1 → rev 4 = 116,679.56 again, both corrections reverted;
// Firm scratch project: the capture form defaults to Save for review only.
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devSession } from "./lib/dev-auth.mjs";
import { arabellaStage7, createScratchOwnerProject } from "./lib/k11-scratch.mjs";

const SCRIPT = "k11-add-price-shots";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = `screenshots/k11/add-price${THEME === "dark" ? "/dark" : ""}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const r2 = (n) => Math.round(n * 100) / 100;

const me = await devSession("k11-owner", { script: SCRIPT });
const owner = await createScratchOwnerProject(sb, me.userId, { name: "Garden — K11 add a price (scratch)" });
const P = owner.projectId;
const firmUser = await devSession("k11-firm", { script: SCRIPT });
let firmId = null;
const FP = randomUUID();

const revs = async (pid) => (await sb.from("boqs").select("id, created_at, total_aed, sections").eq("project_id", pid).order("created_at", { ascending: true })).data ?? [];

async function openLine(b, rowKey) {
  await b.evaluate(`document.querySelector('[data-line-key="${rowKey}"]').scrollIntoView({ block: "center" })`);
  await b.evaluate(`document.querySelector('[data-line-key="${rowKey}"] [role="gridcell"]:nth-child(2)')?.click() ?? document.querySelector('[data-line-key="${rowKey}"]').click()`);
  return b.until(`!!document.querySelector('[data-inspector-for]')`, 5000);
}
async function typeInto(b, selector, text) {
  await b.evaluate(`(() => { const i = document.querySelector('${selector}'); i.focus(); i.select?.(); })()`);
  await b.send("Input.insertText", { text });
}

try {
  const b = await openBrowser({ who: "k11-owner", script: SCRIPT });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    await b.goto(`${BASE}/project/${P}/boq`, "[data-display-total]");
    const total0 = Number(await b.evaluate(`document.querySelector("[data-display-total]").getAttribute("data-display-total")`));
    check("rev 1 on screen: 116,679.56, 3 lines to be priced", total0 === 116679.56 && (await b.evaluate(`/excludes 3 lines/.test(document.body.innerText)`)), String(total0));

    // --- 1. Add a price ---------------------------------------------------------------
    check("PLB-01 opens the inspector", await openLine(b, "Plumbing-0"));
    check("an unpriced line offers Add a price", await b.evaluate(`!!document.querySelector('[data-testid="add-a-price"]')`));
    await b.evaluate(`document.querySelector('[data-testid="add-a-price"]').click()`);
    check("Add a price opens the price form (Rate)", await b.until(`!!document.querySelector('form[data-capture="price"]')`, 3000));
    await typeInto(b, "[data-capture-value]", "650");
    await b.evaluate(`(() => { const s = document.querySelector("[data-basis-kind]"); s.value = "supplier_quote"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await typeInto(b, 'input[aria-label="Basis note"]', "Oct 2026");
    const effect = await b.evaluate(`document.querySelector("[data-capture-effect]").innerText.replace(/\\s+/g, " ")`);
    check("live effect: 2 × 650.00 = 1,300.00 · adds 1,300.00 to the subtotal", /2 × 650\.00 = 1,300\.00/.test(effect) && /adds 1,300\.00 to the subtotal/.test(effect), effect);
    await b.screenshot(`${SHOTS}/1-add-a-price.png`);
    await b.evaluate(`document.querySelector('[data-testid="capture-submit"]').click()`);
    check("Apply price → rev 2 lands on the page", await b.until(`!!document.querySelector('[data-applied-rev="2"]') && document.querySelector("[data-boq-review]")?.getAttribute("data-rev") === "2"`, 30000));
    await b.until(`document.querySelector("[data-display-total]")?.getAttribute("data-display-total") !== "116679.56"`, 15000);
    const rows1 = await revs(P);
    const doc2 = rows1.at(-1).sections;
    const total1 = Number(await b.evaluate(`document.querySelector("[data-display-total]").getAttribute("data-display-total")`));
    check("stored rev 2: subtotal moved by exactly 2 × 650.00", rows1.length === 2 && doc2.subtotal_aed === r2(102892.03 + 1300), `${doc2.subtotal_aed}`);
    check("the headline is the stored total, to the fil", total1 === doc2.grand_total_aed && Number(rows1.at(-1).total_aed) === total1, `${total1} vs ${doc2.grand_total_aed}`);
    check("the chain recomputed: contingency 8% and VAT 5% on the new figures", doc2.contingency_aed === r2(doc2.subtotal_aed * 0.08) && doc2.vat_aed === r2((doc2.subtotal_aed + doc2.contingency_aed) * 0.05), `${doc2.contingency_aed} · ${doc2.vat_aed}`);
    check("2 lines left to be priced", await b.evaluate(`/excludes 2 lines/.test(document.body.innerText)`));
    const insp = await b.evaluate(`document.querySelector("[data-inspector-for]")?.innerText.replace(/\\s+/g, " ") ?? ""`);
    check("the line now reads as your price — measured (own basis), its basis and who added it", /1,300\.00 MEASURED/.test(insp) && /own price — added on review/.test(insp) && /Quote from a supplier — Oct 2026 · Price added by/.test(insp), insp.slice(0, 200));
    check("…and its correction is listed", await b.until(`/Corrections · 1/.test(document.querySelector("[data-inspector-for]")?.innerText ?? "")`, 10000));
    await b.screenshot(`${SHOTS}/2-price-applied.png`);

    // --- 2. a correction that applies --------------------------------------------------
    check("the pergola opens", await openLine(b, "Hardscape & Structures-5"));
    await b.evaluate(`[...document.querySelectorAll("[data-inspector-for] button")].find((x) => x.textContent.trim() === "Capture correction").click()`);
    check("Capture correction opens the form in the Line tab", await b.until(`!!document.querySelector('form[data-capture="correction"]')`, 3000));
    check("owner: Apply to this BoQ now is the default", await b.evaluate(`document.querySelector("[data-apply-now]").checked === true`));
    await typeInto(b, "[data-capture-value]", "1250");
    await typeInto(b, 'form[data-capture="correction"] input:not([data-capture-value]):not([type])', "Firm quote — aluminium pergola, Oct 2026");
    const eff2 = await b.evaluate(`document.querySelector("[data-capture-effect]").innerText.replace(/\\s+/g, " ")`);
    check("live effect: 12.25 × 1,250.00 = 15,312.50 · line effect −1,429.45", /12\.25 × 1,250\.00 = 15,312\.50/.test(eff2) && /−1,429\.45/.test(eff2), eff2);
    await b.screenshot(`${SHOTS}/3-correction-apply-now.png`);
    await b.evaluate(`document.querySelector('[data-testid="capture-submit"]').click()`);
    check("Apply correction → rev 3", await b.until(`!!document.querySelector('[data-applied-rev="3"]')`, 30000));
    const rows2 = await revs(P);
    check("stored rev 3 keeps the price and adds the correction", rows2.length === 3 && rows2.at(-1).sections.subtotal_aed === r2(102892.03 + 1300 - 1429.45), `${rows2.at(-1).sections.subtotal_aed}`);

    // --- 3. the diff and the revert ---------------------------------------------------
    await b.goto(`${BASE}/project/${P}/boq/revisions?from=${rows2[0].id}&to=${rows2[2].id}`, "[data-hydrated]");
    const diff = await b.evaluate("document.body.innerText");
    check("the diff names the causes: Price added by … and Correction by …", /Price added by /.test(diff) && /Correction by /.test(diff));
    await b.screenshot(`${SHOTS}/4-diff-causes.png`, { fullPage: true });
    check("Revisions offers Revert to rev 1", await b.evaluate(`!!document.querySelector('[data-testid="revert-button"]')`));
    await b.evaluate(`document.querySelector('[data-testid="revert-button"]').click()`);
    await b.until(`!new URLSearchParams(location.search).get("to")?.startsWith("${rows2[2].id}") && !!document.querySelector("[data-diff-to]") && document.querySelector("[data-diff-from]")?.getAttribute("data-diff-from") === "${rows2[2].id}"`, 30000);
    const rows3 = await revs(P);
    const back = rows3.at(-1).sections;
    check("Revert → rev 4 restores the previous totals exactly", rows3.length === 4 && back.subtotal_aed === 102892.03 && back.contingency_aed === 8231.36 && back.vat_aed === 5556.17 && back.grand_total_aed === 116679.56, JSON.stringify([back.subtotal_aed, back.grand_total_aed]));
    const { data: cs } = await sb.from("boq_corrections").select("origin, applied_boq_id, reverted_at, applied_by_name").eq("project_id", P);
    check("both corrections are kept on record, reverted", cs.length === 2 && cs.every((c) => c.applied_boq_id && c.reverted_at), JSON.stringify(cs));
    await b.screenshot(`${SHOTS}/5-reverted.png`);
    await b.goto(`${BASE}/project/${P}/boq`, "[data-display-total]");
    check("the BoQ page shows rev 4 at 116,679.56, 3 lines to be priced", (await b.evaluate(`document.querySelector("[data-display-total]").getAttribute("data-display-total")`)) === "116679.56" && (await b.evaluate(`/excludes 3 lines/.test(document.body.innerText)`)));
  } finally {
    await b.close();
  }

  // --- firm: save for review is the default --------------------------------------------
  const { data: firm } = await sb.from("firms").insert({ name: `Scratch Landscapes (K11 ${Date.now()})`, created_by: SCRIPT }).select("id").single().throwOnError();
  firmId = firm.id;
  await sb.from("firm_members").insert({ firm_id: firmId, user_id: firmUser.userId, role: "admin" }).throwOnError();
  await sb.from("firm_rate_books").insert({ firm_id: firmId, status: "reviewed", reviewed_at: new Date().toISOString() }).throwOnError();
  await sb.from("projects").insert({ id: FP, name: "Garden — K11 firm correction (scratch)", city: "Dubai", firm_id: firmId, created_by: firmUser.userId }).throwOnError();
  await sb.from("project_members").insert({ project_id: FP, user_id: firmUser.userId }).throwOnError();
  const boq = arabellaStage7();
  await sb.from("boqs").insert({ project_id: FP, total_aed: boq.grand_total_aed, sections: boq }).throwOnError();
  const fb = await openBrowser({ who: "k11-firm", script: SCRIPT });
  try {
    await fb.viewport(1440, 1000);
    await fb.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    await fb.goto(`${BASE}/project/${FP}/boq`, "[data-display-total]");
    await openLine(fb, "Hardscape & Structures-5");
    await fb.evaluate(`[...document.querySelectorAll("[data-inspector-for] button")].find((x) => x.textContent.trim() === "Capture correction").click()`);
    await fb.until(`!!document.querySelector('form[data-capture="correction"]')`, 3000);
    check("firm: Save for review only is the default; Promote to our rate book stays", (await fb.evaluate(`document.querySelector("[data-save-only]").checked === true`)) && (await fb.evaluate(`/Promote to our rate book after review/.test(document.querySelector("[data-inspector-for]").innerText)`)));
    await typeInto(fb, "[data-capture-value]", "1250");
    await fb.screenshot(`${SHOTS}/6-firm-save-for-review.png`);
    await fb.evaluate(`document.querySelector('[data-testid="capture-submit"]').click()`);
    await fb.until(`!document.querySelector('form[data-capture]')`, 10000);
    const n = (await revs(FP)).length;
    const { data: saved } = await sb.from("boq_corrections").select("applied_boq_id, line_key").eq("project_id", FP);
    check("saved for review: no new revision, the line's stable key recorded for later", n === 1 && saved.length === 1 && !saved[0].applied_boq_id && !!saved[0].line_key, JSON.stringify(saved));
    // …and it can be applied later from the Corrections tab.
    await fb.evaluate(`[...document.querySelectorAll('[role="tab"]')].find((t) => /Corrections/.test(t.textContent)).click()`);
    await fb.until(`!!document.querySelector('[data-testid="apply-saved-correction"]')`, 5000);
    await fb.screenshot(`${SHOTS}/7-firm-saved-apply-later.png`);
    await fb.evaluate(`document.querySelector('[data-testid="apply-saved-correction"]').click()`);
    check("a saved correction applied later → rev 2", await fb.until(`!!document.querySelector('[data-applied-rev="2"]')`, 30000));
  } finally {
    await fb.close();
  }
} finally {
  await owner.cleanup();
  await sb.from("pilot_events").delete().eq("project_id", FP);
  await sb.from("boq_corrections").delete().eq("project_id", FP);
  await sb.from("boqs").delete().eq("project_id", FP);
  await sb.from("projects").delete().eq("id", FP);
  if (firmId) {
    await sb.from("pilot_events").delete().eq("firm_id", firmId);
    await sb.from("firms").delete().eq("id", firmId);
  }
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K11 ADD-A-PRICE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
