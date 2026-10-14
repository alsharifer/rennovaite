#!/usr/bin/env node
// =============================================================================
// scripts/r10a-ask-shots.mjs — R10a live: "Ask for a change" (spec §7.5),
// through the real renders page, the real /api/render-iterate refusal and the
// real /api/render/status answer. NO image-model call is made.
//
//   node --env-file=.env.local scripts/r10a-ask-shots.mjs [port] [--theme=dark]
//
// Scratch owner project "r10a-owner": one Dining Room with a rendered day view
// (an app image stands in) and a recorded tweak whose edit came back unchanged.
//   1. "Move the kitchen to the left …" → the route refuses before any model
//      call (422 structural_change); the studio says "Walls and windows come
//      from your plan — adjust them there" with the plan's Openings link, which
//      opens 01 Plan on that layer; no render row was added;
//   2. a finish request whose edit came back the same → the studio says "That
//      change didn't come through — the image is the same …" and keeps one
//      version (the page's own request to /api/render-iterate is answered with
//      the recorded tweak's prediction id; the status route reads that row).
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const SCRIPT = "r10a-ask-shots";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const THEME = (process.argv.find((a) => a.startsWith("--theme=")) ?? "--theme=light").slice(8);
const SHOTS = `screenshots/r10a${THEME === "dark" ? "/dark" : ""}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const me = await devSession("r10a-owner", { script: SCRIPT });
const P = randomUUID();
const PRED = `r10a-unchanged-${Date.now()}`;
try {
  await sb.from("projects").insert({ id: P, name: "Villa — R10a (scratch)", city: "Dubai", created_by: me.userId }).throwOnError();
  await sb.from("project_members").insert({ project_id: P, user_id: me.userId }).throwOnError();
  const { data: plan } = await sb.from("plans").insert({ project_id: P, source: "parsed", total_area_m2: 18 }).select("id").single().throwOnError();
  const { data: room } = await sb.from("rooms").insert({ plan_id: plan.id, name_en: "Dining Room", room_type: "dining", area_m2: 18, polygon: [[0, 0], [0.5, 0], [0.5, 0.6], [0, 0.6]] }).select("id").single().throwOnError();
  const image = `${BASE}/moodboards/luxe-minimal-living.png`;
  const { data: parent } = await sb.from("renders").insert({ project_id: P, room_id: room.id, prompt: "Renovate this exact dining room …", image_url: image, status: "succeeded", mode: "offplan", model: "google/nano-banana" }).select("id").single().throwOnError();
  await sb.from("renders").insert({ project_id: P, room_id: room.id, prompt: "Make the dining chairs a darker grey.", parent_render_id: parent.id, status: "unchanged", mode: "tweak", model: "google/nano-banana", prediction_id: PRED, qa: { unchanged: true, similarity: { ssim: 0.992, changedPct: 0, meanDiffPct: 0.5 } } }).throwOnError();
  const rows = async () => (await sb.from("renders").select("id").eq("project_id", P)).data.length;

  const b = await openBrowser({ who: "r10a-owner", script: SCRIPT });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: THEME, domain: "localhost", path: "/" });
    await b.goto(`${BASE}/project/${P}/render?room=${room.id}`, "main");
    await b.until(`!!document.querySelector('input[placeholder^="Ask for a change"]')`, 20000);
    // "Version N of M" in the eyebrow — the chain the studio holds for this room.
    const versions = () => b.evaluate(`Number((/Version \d+ of (\d+)/.exec(document.body.innerText) ?? [])[1] ?? 1)`);
    const v0 = await versions();
    const ask = async (text) => {
      await b.evaluate(`(() => { const i = document.querySelector('input[placeholder^="Ask for a change"]'); i.focus(); i.select(); })()`);
      await b.send("Input.insertText", { text });
      await b.evaluate(`document.querySelector('input[placeholder^="Ask for a change"]').closest("form").requestSubmit()`);
    };

    // 1. structural
    const before = await rows();
    await ask("Move the kitchen to the left side of the room and the windows to the right side");
    check("a structural request → the plan's answer, with the Openings link", await b.until(`/Walls and windows come from your plan — adjust them there/.test(document.querySelector("[data-render-notice]")?.innerText ?? "")`, 20000));
    check("…before any model call: no render row was added", (await rows()) === before);
    const href = await b.evaluate(`document.querySelector("[data-render-notice-link]")?.getAttribute("href")`);
    check("…the link opens the plan's Openings layer", href === `/project/${P}/plan?layer=openings`, href);
    await b.screenshot(`${SHOTS}/1-structural.png`);

    // 2. unchanged — the studio's own iterate request is answered with the recorded tweak.
    await b.evaluate(`(() => { const of = window.fetch; window.fetch = (u, o) => String(u).includes("/api/render-iterate") ? Promise.resolve(new Response(JSON.stringify({ prediction_id: ${JSON.stringify(PRED)} }), { status: 200, headers: { "content-type": "application/json" } })) : of(u, o); })()`);
    await ask("Make the dining chairs a darker grey");
    check("an edit that came back the same → \"That change didn't come through …\"", await b.until(`/That change didn.t come through — the image is the same\\. Try being more specific\\./.test(document.querySelector("[data-render-notice]")?.innerText ?? "")`, 30000));
    check("…and no new version appears (one version, as before)", (await versions()) === v0 && v0 === 1, `${v0} → ${await versions()}`);
    await b.screenshot(`${SHOTS}/2-unchanged.png`);

    // The link lands on the Openings layer.
    await b.goto(`${BASE}${href}`, "main");
    const active = await b.evaluate(`[...document.querySelectorAll("button, [role=tab]")].find((x) => /Openings/.test(x.innerText) && (x.getAttribute("aria-selected") === "true" || x.getAttribute("aria-pressed") === "true" || /border-bp-brass/.test(x.className)))?.innerText ?? ""`);
    check("01 Plan opens on the Openings layer", /Openings/.test(active), active);
    await b.screenshot(`${SHOTS}/3-plan-openings.png`);
  } finally {
    await b.close();
  }
} finally {
  await sb.from("pilot_events").delete().eq("project_id", P);
  await sb.from("renders").delete().eq("project_id", P);
  await sb.from("projects").delete().eq("id", P);
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL R10a CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
