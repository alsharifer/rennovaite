#!/usr/bin/env node
// =============================================================================
// scripts/b2-photo-view-check.mjs — bathroom pilot B2 (commit 2) live: the five
// pilot photos rendered as photo views through the real studio, every fixture
// checked against the photo, the style from the client's references, render
// spend recorded.
//
//   node --env-file=.env.local scripts/b2-photo-view-check.mjs [port] [--retries=2] [--only=1,3]
//
// On the dev test project a2661f34 (MULTIVIEW_RENDERS_ENABLED, `bathroom` launch
// entry). For each photo: "Render this view" in the studio → the route restyles
// and checks (one retry inside). A view whose check fails after that is pressed
// "Render again" up to --retries times — each press counted and reported, never
// hidden. Then: every view's check line, its style line, its scores, the spend
// rows; screenshots light + dark (gitignored — client photos).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";

const SCRIPT = "b2-photo-view-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const BASE = `http://localhost:${PORT}`;
const RETRIES = Number((process.argv.find((a) => a.startsWith("--retries=")) ?? "--retries=2").slice(10));
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean).map(Number);
const P = "a2661f34-9d96-4020-a755-40359440c302";
const SHOTS = "screenshots/bathroom-pilot/b2";
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const b = await openBrowser({ who: "b1-owner", script: SCRIPT });
const presses = {};
try {
  await b.viewport(1440, 1000);
  await b.send("Network.setCookie", { name: "rv_theme", value: "light", domain: "localhost", path: "/" });
  await b.goto(`${BASE}/project/${P}/render`, "[data-photo-views]");
  const count = await b.evaluate(`document.querySelectorAll("[data-photo-view]").length`);
  check("the studio lists the five photo views", count === 5, String(count));
  const spend0 = Number((await sb.from("render_spend").select("cost_aed").eq("project_id", P)).data?.reduce((s, r) => s + Number(r.cost_aed ?? 0), 0) ?? 0);

  for (let i = 0; i < count; i++) {
    if (ONLY.length && !ONLY.includes(i + 1)) continue;
    presses[i + 1] = 0;
    for (let press = 0; press <= RETRIES; press++) {
      await b.evaluate(`document.querySelectorAll("[data-photo-view]")[${i}].click()`);
      await b.until(`!!document.querySelector("[data-render-photo-view]")`);
      const id = await b.evaluate(`document.querySelectorAll("[data-photo-view]")[${i}].getAttribute("data-photo-view")`);
      const t0 = Date.now();
      await b.evaluate(`document.querySelector('[data-render-photo-view="${id}"]').click()`);
      presses[i + 1]++;
      const done = await b.until(`(() => { const el = document.querySelector('[data-photo-view-render="${id}"]'); return el && el.getAttribute("data-outcome") !== "none" && !/Rendering/.test(el.querySelector("[data-render-photo-view]").innerText); })()`, 420000);
      const out = await b.evaluate(`(() => { const el = document.querySelector('[data-photo-view-render="${id}"]'); return { outcome: el.getAttribute("data-outcome"), layout: el.querySelector('[data-check-line="layout"]')?.innerText ?? "", style: el.querySelector('[data-check-line="style"]')?.innerText ?? "", scores: el.querySelector("[data-scores]")?.innerText ?? "", error: el.querySelector('[role="alert"]')?.innerText ?? "" }; })()`);
      console.log(`  ·  P${i + 1} press ${press + 1}: ${out.outcome} in ${Math.round((Date.now() - t0) / 1000)} s — ${out.layout.replace(/\s+/g, " ")} · ${out.scores}${out.error ? ` · ${out.error}` : ""}`);
      if (!done || out.outcome === "passed" || out.error) break;
    }
  }

  // The stored views: the latest photo-view render of each photo.
  const { data: plan } = await sb.from("plans").select("id").eq("project_id", P).single();
  const { data: room } = await sb.from("rooms").select("id").eq("plan_id", plan.id).single();
  const { data: rows } = await sb.from("room_photos").select("id, created_at").eq("room_id", room.id).order("created_at");
  const { data: renders } = await sb.from("renders").select("id, room_photo_id, room_id, gate, image_url, created_at, mode").eq("project_id", P).eq("mode", "photo_view").order("created_at");
  const latest = {};
  for (const r of renders ?? []) latest[r.room_photo_id] = r;
  const views = (rows ?? []).filter((r) => latest[r.id]);
  let n = 0;
  for (const v of views) {
    n++;
    const g = latest[v.id].gate;
    check(`P${n}: "${g.line}" — checked ${g.checked.length} items, ${g.attempts.length} attempt(s), SSIM ${g.attempts.at(-1)?.ssim}`, g.outcome === "passed" && g.line === "Layout follows your photo ✓" && latest[v.id].room_id === null);
    check(`P${n}: "${g.style_line}"`, g.style_source === "references" && g.style_line === "Style follows your references ✓");
  }
  const spend = (await sb.from("render_spend").select("model, size, cost_aed, purpose").eq("project_id", P)).data ?? [];
  const spend1 = spend.reduce((s, r) => s + Number(r.cost_aed ?? 0), 0);
  const imageRows = spend.filter((r) => r.purpose === "photo_view");
  check("render spend recorded per call — model + size on every image call", imageRows.length > 0 && imageRows.every((r) => r.model && r.size), `${imageRows.length} image calls`);
  console.log(`  ·  render_spend_aed: ${spend0.toFixed(2)} → ${spend1.toFixed(2)} (this run AED ${(spend1 - spend0).toFixed(2)}) · presses ${JSON.stringify(presses)}`);

  await b.goto(`${BASE}/project/${P}/render`, "[data-photo-views]");
  check("the studio shows the project's render spend", (await b.evaluate(`document.querySelector("[data-render-spend]")?.getAttribute("data-render-spend") ?? ""`)) === spend1.toFixed(2));
  for (let i = 0; i < 5; i++) {
    await b.evaluate(`document.querySelectorAll("[data-photo-view]")[${i}].click()`);
    await new Promise((r) => setTimeout(r, 500));
    await b.evaluate(`document.querySelector("[data-photo-view-render]")?.scrollIntoView()`);
    await b.screenshot(`${SHOTS}/4-photo-view-P${i + 1}.png`);
  }
  const axe = await b.axe();
  check("axe on the studio with rendered photo views: no violations", axe.length === 0, axe.map((v) => `${v.id}: ${v.nodes[0]}`).join(" | "));
  await b.send("Network.setCookie", { name: "rv_theme", value: "dark", domain: "localhost", path: "/" });
  await b.goto(`${BASE}/project/${P}/render`, "[data-photo-views]");
  await b.evaluate(`document.querySelector("[data-photo-view-render]")?.scrollIntoView()`);
  await b.screenshot(`${SHOTS}/dark-4-photo-view-P1.png`);
  const axeDark = await b.axe();
  check("axe, dark: no violations", axeDark.length === 0, axeDark.map((v) => `${v.id}: ${v.nodes[0]}`).join(" | "));
  check("no error in any page console", b.errors().length === 0, b.errors().join(" | ").slice(0, 600));
} finally {
  await b.close();
}
console.log(failures === 0 ? "\nALL B2 PHOTO-VIEW RENDER CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
