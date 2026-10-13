#!/usr/bin/env node
// =============================================================================
// scripts/k11-unmatched-price-shots.mjs — K11 approval check 1, live: an
// applied price whose line is gone after a regenerate is NEVER dropped
// silently or attached elsewhere — the Issues navigator says "Your price for
// <item> no longer matches a line" with Remove / Re-apply to….
//
//   node --env-file=.env.local scripts/k11-unmatched-price-shots.mjs [port] [--theme=dark]
//
// Owner scratch project (lib/k11-scratch.mjs). PLB-01 is priced through the
// real route; then the regeneration a scope change would store is computed by
// the app's own applyOwnBasis (the outdoor tap gone from the scope; REFs
// renumber) and stored as the next revision — the scratch project has no plan
// to run the real generator on. Then: the navigator row, Re-apply to… a
// chosen line (next revision), and Remove on a second run.
// =============================================================================

import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devFetch, devSession } from "./lib/dev-auth.mjs";
import { createScratchOwnerProject } from "./lib/k11-scratch.mjs";

const SCRIPT = "k11-unmatched-price-shots";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = `screenshots/k11/unmatched${THEME === "dark" ? "/dark" : ""}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
const f = devFetch("k11-owner", { script: SCRIPT });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const post = async (path, body) => {
  const r = await f(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

/** The revision a regenerate would store when the outdoor tap leaves the scope — computed by the app's own modules. */
function regenerated(applied) {
  const code = `
    const { reroundRevision, rechain } = await import("@/lib/boq/totals");
    const { applyOwnBasis } = await import("@/lib/boq/own-basis");
    const fs = await import("node:fs");
    const fx = JSON.parse(fs.readFileSync("lib/boq/__fixtures__/arabella-g5d-revisions.json", "utf8"));
    const d = reroundRevision(fx.boqs[fx.stages[7].boq_id]);
    d.sections = d.sections.map((s) => (s.work_section === "Plumbing" ? { ...s, lines: s.lines.slice(1) } : s));
    const out = applyOwnBasis(rechain(d), ${JSON.stringify(applied)});
    process.stdout.write(JSON.stringify(out.boq));`;
  return JSON.parse(execFileSync(process.execPath, ["--experimental-transform-types", "--import", "./scripts/_alias-hook.mjs", "-e", code], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
}
const appliedRows = async (P) =>
  ((await sb.from("boq_corrections").select("id, correction_type, line_key, new_value, origin, basis_kind, note, applied_by_name, applied_at, line_description").eq("project_id", P).not("applied_boq_id", "is", null).is("reverted_at", null)).data ?? []).map((r) => ({
    id: r.id,
    type: r.correction_type,
    lineKey: r.line_key,
    value: Number(r.new_value),
    origin: r.origin,
    basisKind: r.basis_kind,
    note: r.note,
    byName: r.applied_by_name,
    appliedAt: r.applied_at,
    label: r.line_description,
  }));
const latestId = async (P) => (await sb.from("boqs").select("id").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single()).data.id;

async function setUp(name) {
  const me = await devSession("k11-owner", { script: SCRIPT });
  const o = await createScratchOwnerProject(sb, me.userId, { name });
  const a = await post(`/api/projects/${o.projectId}/boq-apply`, { boq_id: o.boqId, row_key: "Plumbing-0", correction_type: "rate", new_value: 650, origin: "add_price", basis_kind: "supplier_quote", note: "Oct 2026" });
  if (a.status !== 200) throw new Error(`apply: ${a.status} ${a.body.error}`);
  const doc = regenerated(await appliedRows(o.projectId));
  await sb.from("boqs").insert({ project_id: o.projectId, total_aed: doc.grand_total_aed, sections: doc }).throwOnError();
  return { ...o, doc, correctionId: a.body.correction_id };
}

const runs = [];
try {
  // --- Re-apply to… ---------------------------------------------------------------
  const one = await setUp("Garden — K11 unmatched price (scratch)");
  runs.push(one);
  check("the regenerated revision prices nothing with it and records it as unmatched", one.doc.own_basis?.unmatched?.[0]?.correction_id === one.correctionId && !one.doc.sections.flatMap((s) => s.lines).some((l) => l.rate_tier === "own_price"), JSON.stringify(one.doc.own_basis));
  const b = await openBrowser({ who: "k11-owner", script: SCRIPT });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    await b.goto(`${BASE}/project/${one.projectId}/boq`, "[data-issues-navigator]");
    await b.evaluate(`document.querySelector('[data-testid="issues-button"]').click()`);
    await b.until(`!!document.querySelector("[data-issues-panel]")`, 5000);
    const row = await b.evaluate(`document.querySelector('[data-issue-group="unmatched"]')?.innerText.replace(/\\s+/g, " ") ?? ""`);
    check("navigator: YOUR PRICES — NO LONGER MATCHED · Your price for Outdoor water tap … no longer matches a line · Remove · Re-apply to…", /YOUR PRICES — NO LONGER MATCHED/.test(row) && /Your price for Outdoor water tap \(hose bib\) with isolation valve no longer matches a line/.test(row) && /Remove/.test(row) && /Re-apply to…/.test(row), row);
    await b.screenshot(`${SHOTS}/1-navigator-unmatched.png`);
    await b.evaluate(`document.querySelector('[data-issue-group="unmatched"] [data-issue-action="retarget"]').click()`);
    check("Re-apply to… opens the line picker (nothing pre-chosen)", await b.until(`!!document.querySelector('[data-testid="retarget-dialog"][open]') && document.querySelector("[data-retarget-line]").value === ""`, 5000));
    await b.evaluate(`(() => { const s = document.querySelector("[data-retarget-line]"); s.value = "Plumbing-0"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await b.screenshot(`${SHOTS}/2-reapply-to.png`);
    await b.evaluate(`document.querySelector('[data-testid="retarget-apply"]').click()`);
    check("re-applied → the next revision lands", await b.until(`!!document.querySelector('[data-applied-rev="4"]')`, 30000));
    const { data: doc4 } = await sb.from("boqs").select("sections").eq("id", await latestId(one.projectId)).single();
    const plb = doc4.sections.sections.find((s) => s.work_section === "Plumbing").lines[0];
    check("…the price sits on the line the member chose, and nothing is unmatched any more", plb.rate_tier === "own_price" && plb.rate_aed === 650 && !doc4.sections.own_basis, `${plb.description} ${plb.rate_aed}`);
    await b.until(`document.querySelector("[data-boq-review]")?.getAttribute("data-rev") === "4"`, 15000);
    await b.evaluate(`document.querySelector('[data-testid="issues-button"]').click()`);
    await b.until(`!!document.querySelector("[data-issues-panel]")`, 5000);
    check("…and the navigator no longer lists it", !(await b.evaluate(`!!document.querySelector('[data-issue-group="unmatched"]')`)));
  } finally {
    await b.close();
  }

  // --- Remove -------------------------------------------------------------------------
  const two = await setUp("Garden — K11 unmatched remove (scratch)");
  runs.push(two);
  const b2 = await openBrowser({ who: "k11-owner", script: SCRIPT });
  try {
    await b2.viewport(1440, 1000);
    await b2.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    await b2.goto(`${BASE}/project/${two.projectId}/boq`, "[data-issues-navigator]");
    const nBefore = (await sb.from("boqs").select("id").eq("project_id", two.projectId)).data.length;
    await b2.evaluate(`document.querySelector('[data-testid="issues-button"]').click()`);
    await b2.until(`!!document.querySelector("[data-issues-panel]")`, 5000);
    await b2.evaluate(`document.querySelector('[data-issue-group="unmatched"] [data-issue-action="release"]').click()`);
    let c = null;
    for (let i = 0; i < 40 && !c?.reverted_at; i++) {
      await new Promise((r) => setTimeout(r, 500));
      c = (await sb.from("boq_corrections").select("reverted_at, applied_boq_id").eq("id", two.correctionId).single()).data;
    }
    await b2.goto(`${BASE}/project/${two.projectId}/boq`, "[data-boq-review]");
    await b2.evaluate(`document.querySelector('[data-testid="issues-button"]')?.click()`);
    await b2.until(`!!document.querySelector("[data-issues-panel]") || !document.querySelector('[data-testid="issues-button"]')`, 10000);
    const stillListed = await b2.evaluate(`!!document.querySelector('[data-issue-group="unmatched"]')`);
    const nAfter = (await sb.from("boqs").select("id").eq("project_id", two.projectId)).data.length;
    check("Remove: it stops applying (kept on record, reverted), no new revision, gone from the navigator", !!c?.reverted_at && !!c?.applied_boq_id && nAfter === nBefore && !stillListed, JSON.stringify(c));
    await b2.screenshot(`${SHOTS}/3-removed.png`);
  } finally {
    await b2.close();
  }
} finally {
  for (const r of runs) await r.cleanup();
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K11 UNMATCHED-PRICE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
