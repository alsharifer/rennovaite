#!/usr/bin/env node
// =============================================================================
// scripts/k10-plan-gate-shots.mjs — K10 #4 live: the plan page opens the editor
// for a plan with rooms and no parse record (the Demo villa's state, from the
// read-only fixture lib/plan/__fixtures__/demo-villa-plan.json), and shows the
// "not analysed" card only for a plan with no rooms.
//
//   node --env-file=.env.local scripts/k10-plan-gate-shots.mjs [port] [--shots=screenshots/k10/plan]
//
// Two scratch projects, removed at the end — the dev Demo villa itself is
// never opened (its plan page would seed overlay fixtures on first load).
// =============================================================================

import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) ?? "--shots=screenshots/k10/plan").slice(8);
const { url, key } = resolveTarget({ script: "k10-plan-gate-shots", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
const demo = JSON.parse(fs.readFileSync("lib/plan/__fixtures__/demo-villa-plan.json", "utf8"));

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const WITH = randomUUID();
const EMPTY = randomUUID();
try {
  await sb.from("projects").insert([{ id: WITH, name: "Demo villa copy (K10 scratch)", city: "Dubai" }, { id: EMPTY, name: "Empty plan (K10 scratch)", city: "Dubai" }]).throwOnError();
  const { data: p1 } = await sb.from("plans").insert({ project_id: WITH, source: demo.plan.source, pdf_url: null, parsed_json: null, total_area_m2: demo.plan.total_area_m2 }).select("id").single().throwOnError();
  await sb.from("rooms").insert(demo.rooms.map((r) => ({ ...r, plan_id: p1.id }))).throwOnError();
  await sb.from("plans").insert({ project_id: EMPTY, source: "parsed", pdf_url: null, parsed_json: null, total_area_m2: null }).throwOnError();

  for (const theme of ["light", "dark"]) {
    const b = await openBrowser({ who: "pipeline", script: "k10-plan-gate-shots", projects: [WITH, EMPTY] });
    try {
      await b.viewport(1440, 1000);
      await b.send("Network.setCookie", { name: "rv_theme", value: theme, domain: "localhost", path: "/" });
      await b.goto(`${BASE}/project/${WITH}/plan`, "main");
      await b.until(`!!document.querySelector('[aria-label="Plan editor"]')`, 20000);
      const t = await b.evaluate("document.body.innerText");
      check(`${theme}: rooms, no parse record → the editor opens`, (await b.evaluate(`!!document.querySelector('[aria-label="Plan editor"]') && !document.querySelector("[data-plan-not-analysed]")`)));
      check(`${theme}: the header counts the same 13 rooms`, /13 ROOMS DETECTED/.test(t), (t.match(/\d+ ROOMS DETECTED/) ?? [""])[0]);
      await b.screenshot(`${SHOTS}/${theme === "dark" ? "dark/" : ""}1-demo-villa-editor.png`);
      await b.goto(`${BASE}/project/${EMPTY}/plan`, "main");
      const e = await b.evaluate("document.body.innerText");
      check(`${theme}: no rooms → the not-analysed card, no editor`, (await b.evaluate(`!document.querySelector('[aria-label="Plan editor"]') && !!document.querySelector("[data-plan-not-analysed]")`)), e.slice(0, 160).replace(/\s+/g, " "));
      await b.screenshot(`${SHOTS}/${theme === "dark" ? "dark/" : ""}2-no-rooms.png`);
    } finally {
      await b.close();
    }
  }
} finally {
  for (const id of [WITH, EMPTY]) {
    await sb.from("plan_fixtures").delete().eq("project_id", id);
    await sb.from("pilot_events").delete().eq("project_id", id);
  }
  await sb.from("projects").delete().in("id", [WITH, EMPTY]);
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K10 PLAN-GATE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
