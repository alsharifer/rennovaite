#!/usr/bin/env node
// =============================================================================
// scripts/k10-renders-rail-shots.mjs — K10 #5 live: 03 Renders reads "N / M
// locked" until every renderable view is locked, on the rail AND as the
// Projects home's Next; Done once all are locked.
//
//   node --env-file=.env.local scripts/k10-renders-rail-shots.mjs [port] [--shots=screenshots/k10/renders]
//
// One scratch owner project (dev account "k10-renders" as its creator), three
// renderable rooms and a staircase, renders on all three, one locked — then
// all locked. Removed at the end.
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const SHOTS_BASE = (process.argv.find((a) => a.startsWith("--shots=")) ?? "--shots=screenshots/k10/renders").slice(8);
// --theme=dark: the same run in Dark (the rv_theme cookie, as the app sets it), shots under <dir>/dark.
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = THEME === "dark" ? `${SHOTS_BASE}/dark` : SHOTS_BASE;
const { url, key } = resolveTarget({ script: "k10-renders-rail-shots", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

const me = await devSession("k10-renders", { script: "k10-renders-rail-shots" });
const P = randomUUID();
try {
  await sb.from("projects").insert({ id: P, name: "Villa renders (K10 scratch)", city: "Dubai", created_by: me.userId }).throwOnError();
  await sb.from("project_members").insert({ project_id: P, user_id: me.userId }).throwOnError();
  const { data: plan } = await sb.from("plans").insert({ project_id: P, source: "parsed", total_area_m2: 60 }).select("id").single().throwOnError();
  const { data: rooms } = await sb
    .from("rooms")
    .insert([
      { plan_id: plan.id, name_en: "Living", room_type: "living", area_m2: 24, polygon: sq(0, 0, 0.5) },
      { plan_id: plan.id, name_en: "Master Bedroom", room_type: "master_bedroom", area_m2: 18, polygon: sq(0.5, 0, 0.5) },
      { plan_id: plan.id, name_en: "Bath", room_type: "bathroom", area_m2: 6, polygon: sq(0, 0.5, 0.3) },
      { plan_id: plan.id, name_en: "Stairs", room_type: "stairs", area_m2: 6, polygon: sq(0.5, 0.5, 0.3) },
    ])
    .select("id, room_type")
    .throwOnError();
  const renderable = rooms.filter((r) => r.room_type !== "stairs");
  const { data: renders } = await sb.from("renders").insert(renderable.map((r) => ({ project_id: P, room_id: r.id, status: "succeeded", prompt: "k10 scratch" }))).select("id, room_id").throwOnError();
  await sb.from("approved_designs").insert({ project_id: P, room_id: renders[0].room_id, render_id: renders[0].id }).throwOnError();
  // Three pinned references, so 02 Design is done and 03 Renders is the first step that needs anything.
  await sb.from("moodboard_items").insert(["living", "master-bed", "bathroom"].map((room) => ({ project_id: P, kind: "style", style_key: "scandi-arabic", style_room: room }))).throwOnError();

  const b = await openBrowser({ who: "k10-renders", script: "k10-renders-rail-shots" });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    await b.goto(`${BASE}/projects`, "[data-home]");
    const home = await b.evaluate(`document.querySelector('[data-project="${P}"]')?.innerText ?? ""`);
    check("Projects home Next: 03 · RENDERS — 1 / 3 locked", /03 · RENDERS/.test(home) && /1 \/ 3 locked/.test(home), home.replace(/\s+/g, " ").slice(0, 200));
    await b.screenshot(`${SHOTS}/1-home-next.png`);
    await b.goto(`${BASE}/project/${P}`, "nav");
    const rail = await b.evaluate(`[...document.querySelectorAll("nav a")].map((a) => a.innerText.replace(/\\s+/g, " ")).find((t) => /Renders/.test(t)) ?? ""`);
    check("the rail: 03 Renders — 1 / 3 locked (available, not done)", /1 \/ 3 locked/.test(rail), rail);
    const overview = await b.evaluate("document.body.innerText");
    check("the Overview's Next says the same", /Lock the remaining views/.test(overview) && /1 \/ 3 locked/.test(overview));
    await b.screenshot(`${SHOTS}/2-rail-partial.png`);

    // Lock the rest: Done.
    await sb.from("approved_designs").insert(renders.slice(1).map((r) => ({ project_id: P, room_id: r.room_id, render_id: r.id }))).throwOnError();
    await b.goto(`${BASE}/project/${P}`, "nav");
    const rail2 = await b.evaluate(`[...document.querySelectorAll("nav a")].map((a) => a.innerText.replace(/\\s+/g, " ")).find((t) => /Renders/.test(t)) ?? ""`);
    const done = await b.evaluate(`[...document.querySelectorAll("nav a")].find((a) => /Renders/.test(a.innerText))?.getAttribute("aria-label") ?? ""`);
    check("every view locked → 03 Renders is done, no count", !/locked/.test(rail2) && /done/i.test(done), `${rail2} | ${done}`);
    await b.screenshot(`${SHOTS}/3-rail-done.png`);
  } finally {
    await b.close();
  }
} finally {
  await sb.from("pilot_events").delete().eq("project_id", P);
  await sb.from("projects").delete().eq("id", P);
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K10 RENDERS-RAIL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
