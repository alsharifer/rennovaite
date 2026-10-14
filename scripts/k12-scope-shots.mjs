#!/usr/bin/env node
// =============================================================================
// scripts/k12-scope-shots.mjs — K12 live: rooms in this renovation (spec §7.4,
// Figma 81:716 / dark 82:2244), through the real pages and routes.
//
//   node --env-file=.env.local scripts/k12-scope-shots.mjs [port] [--theme=dark]
//
// A scratch copy of the dev Demo villa's plan (13 rooms; the Demo villa itself
// is never opened — lib/plan/__fixtures__/demo-villa-plan.json), owned by
// "k12-owner":
//   1. rev 1 from the real generator; 01 Plan reads "13 of 13";
//   2. Terrace + Terrace 2 unticked → "11 of 13", both dashed with NOT IN THIS
//      RENOVATION; the BoQ's Regenerate says "Scope changed since rev 1";
//   3. regenerate → rev 2: lower subtotal, the diff's cause "Scope: 2 rooms
//      removed"; Overview "11 of 13 rooms in scope"; Renders "2 not in this
//      renovation"; the timeline recalculated;
//   4. Select all → regenerate → rev 3 equals rev 1 to the fil.
// =============================================================================

import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devFetch, devSession } from "./lib/dev-auth.mjs";

const SCRIPT = "k12-scope-shots";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = `screenshots/k12${THEME === "dark" ? "/dark" : ""}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
const demo = JSON.parse(fs.readFileSync("lib/plan/__fixtures__/demo-villa-plan.json", "utf8"));
const f = devFetch("k12-owner", { script: SCRIPT });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const generate = async (P) => {
  const r = await f(`${BASE}/api/generate-boq`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: P, trigger: "regenerate" }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`generate-boq ${r.status}: ${b.error}`);
  return b;
};
const latestBoq = async (P) => (await sb.from("boqs").select("id, sections").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single()).data;

const me = await devSession("k12-owner", { script: SCRIPT });
const P = randomUUID();
try {
  await sb.from("projects").insert({ id: P, name: "Villa — K12 scope (scratch)", city: "Dubai", created_by: me.userId }).throwOnError();
  await sb.from("project_members").insert({ project_id: P, user_id: me.userId }).throwOnError();
  const { data: plan } = await sb.from("plans").insert({ project_id: P, source: demo.plan.source, pdf_url: null, parsed_json: null, total_area_m2: demo.plan.total_area_m2 }).select("id").single().throwOnError();
  const { data: rooms } = await sb.from("rooms").insert(demo.rooms.map((r) => ({ ...r, plan_id: plan.id }))).select("id, name_en").throwOnError();
  const terraces = rooms.filter((r) => /^Terrace/.test(r.name_en)).map((r) => r.id);
  const g1 = await generate(P);
  const rev1 = await latestBoq(P);
  check("rev 1 from the real generator", !!g1.boq_id && rev1.sections.grand_total_aed > 0, String(rev1.sections.grand_total_aed));

  const b = await openBrowser({ who: "k12-owner", script: SCRIPT });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    await b.goto(`${BASE}/project/${P}/plan`, "[data-rooms-in-scope]");
    check("01 Plan: Rooms in this renovation — 13 of 13", (await b.evaluate(`document.querySelector("[data-rooms-in-scope]").getAttribute("data-in-scope-count")`)) === "13");
    const timelineBefore = await (async () => {
      await b.goto(`${BASE}/project/${P}/timeline`, "[data-timeline]");
      return b.evaluate(`document.querySelector("[data-timeline]").innerText.replace(/\\s+/g, " ")`);
    })();
    await b.goto(`${BASE}/project/${P}/plan`, "[data-rooms-in-scope]");
    // Both ticks at once — a tick never waits for another's save.
    for (const id of terraces) await b.evaluate(`document.querySelector('[data-scope-room="${id}"]').click()`);
    await b.until(`document.querySelector("[data-rooms-in-scope]").getAttribute("data-saving") === "false"`, 30000);
    check("unticking Terrace + Terrace 2 → 11 of 13", await b.until(`document.querySelector("[data-rooms-in-scope]").getAttribute("data-in-scope-count") === "11"`, 10000));
    const { data: stored } = await sb.from("rooms").select("id, in_scope").eq("plan_id", plan.id);
    check("…saved: exactly those two rooms are out of scope", stored.filter((r) => r.in_scope === false).map((r) => r.id).sort().join() === [...terraces].sort().join());
    const dashed = await b.evaluate(`[...document.querySelectorAll('[data-in-scope="false"]')].length + "/" + document.querySelectorAll("[data-not-in-scope]").length`);
    check("the canvas draws both dashed with NOT IN THIS RENOVATION", dashed === "2/2", dashed);
    await b.screenshot(`${SHOTS}/1-plan-rooms-in-scope.png`);

    await b.goto(`${BASE}/project/${P}/boq`, "[data-boq-review]");
    const regen = await b.evaluate(`document.querySelector(".bp-topbar")?.innerText.replace(/\\s+/g, " ") ?? ""`);
    check("the BoQ's Regenerate: Scope changed since rev 1", /Scope changed since rev 1/.test(regen), regen.slice(0, 200));
    await b.screenshot(`${SHOTS}/2-boq-scope-changed.png`);

    // Regenerate → rev 2.
    await generate(P);
    const rev2 = await latestBoq(P);
    check("rev 2: the subtotal is lower (the terraces' room-level work is out)", rev2.sections.subtotal_aed < rev1.sections.subtotal_aed, `${rev1.sections.subtotal_aed} → ${rev2.sections.subtotal_aed}`);
    const wholeHome = (doc) => doc.sections.flatMap((s) => s.lines).filter((l) => /^Q-(05|11|32|33|36|37)\b/.test(l.rule_id ?? "")).map((l) => `${l.rule_id}:${l.total_aed}`).sort().join();
    check("…the whole-home lines are unchanged", wholeHome(rev1.sections) === wholeHome(rev2.sections), wholeHome(rev2.sections));
    await b.goto(`${BASE}/project/${P}/boq/revisions?from=${rev1.id}&to=${rev2.id}`, "[data-hydrated]");
    const diff = await b.evaluate("document.body.innerText");
    check("the revision diff's cause: Scope: 2 rooms removed", /Scope: 2 rooms removed/.test(diff), (diff.match(/Scope[^\n]*/g) ?? []).join(" | ") || diff.slice(0, 300));
    await b.screenshot(`${SHOTS}/3-diff-scope-cause.png`, { fullPage: true });

    await b.goto(`${BASE}/project/${P}`, "main");
    check("Overview: 11 of 13 rooms in scope", await b.evaluate(`/11 of 13 rooms in scope/.test(document.body.innerText)`));
    await b.screenshot(`${SHOTS}/4-overview.png`);
    await b.goto(`${BASE}/project/${P}/render`, "main");
    const rend = await b.evaluate(`document.querySelector("[data-not-in-scope]")?.getAttribute("data-not-in-scope") ?? null`);
    const listed = await b.evaluate(`[...document.querySelectorAll("[data-view-row]")].map((r) => r.innerText).join(" | ")`);
    check("Renders: 2 not in this renovation; neither terrace is a view", rend === "2" && !/Terrace/.test(listed), `${rend} · ${listed.slice(0, 160)}`);
    await b.evaluate(`document.querySelector("[data-not-in-scope]")?.setAttribute("open", "")`);
    await b.screenshot(`${SHOTS}/5-renders-not-in-scope.png`);
    await b.goto(`${BASE}/project/${P}/timeline`, "[data-timeline]");
    const timelineAfter = await b.evaluate(`document.querySelector("[data-timeline]").innerText.replace(/\\s+/g, " ")`);
    check("the timeline recalculated", timelineAfter !== timelineBefore, `${timelineBefore.slice(0, 80)} … → ${timelineAfter.slice(0, 80)}`);
    await b.screenshot(`${SHOTS}/6-timeline.png`);

    // Select all → regenerate → rev 3 = rev 1.
    await b.goto(`${BASE}/project/${P}/plan`, "[data-rooms-in-scope]");
    await b.evaluate(`document.querySelector("[data-scope-all]").click()`);
    check("Select all → 13 of 13", await b.until(`document.querySelector("[data-rooms-in-scope]").getAttribute("data-in-scope-count") === "13"`, 10000));
    await b.until(`document.querySelector("[data-rooms-in-scope]").getAttribute("data-saving") === "false"`, 30000);
    const { data: back } = await sb.from("rooms").select("in_scope").eq("plan_id", plan.id);
    check("…saved: every room back in scope", back.every((r) => r.in_scope === true));
  } finally {
    await b.close();
  }
  await new Promise((r) => setTimeout(r, 1500));
  await generate(P);
  const rev3 = await latestBoq(P);
  const strip = (d) => JSON.stringify({ ...d, engine: { ...d.engine, generated_at: null } });
  check("rev 3 (everything back in scope) equals rev 1 — to the fil, line for line", rev3.sections.grand_total_aed === rev1.sections.grand_total_aed && strip(rev3.sections) === strip(rev1.sections), `${rev1.sections.grand_total_aed} / ${rev3.sections.grand_total_aed}`);
} finally {
  await sb.from("pilot_events").delete().eq("project_id", P);
  await sb.from("boqs").delete().eq("project_id", P);
  await sb.from("projects").delete().eq("id", P);
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K12 SCOPE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
