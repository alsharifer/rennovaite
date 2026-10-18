#!/usr/bin/env node
// =============================================================================
// scripts/b1-room-check.mjs — bathroom pilot B1 live: the pilot bathroom from
// its room sheet, through the real pages and routes.
//
//   node --env-file=.env.local scripts/b1-room-check.mjs [port] [--keep]
//
// Needs a dev server with MULTIVIEW_RENDERS_ENABLED=true and OVERLAYS_ENABLED=true
// (and NOT GARDEN_PILOT_ENABLED — the intake must not depend on it); the
// `bathroom` entry in .claude/launch.json is exactly that (port 3096).
//
//   1. 01 Intake: "One room from its dimensions" — Bathroom, 2.66 × 2.63 × 2.80
//      typed into the form, Continue → 01 Plan on the Openings layer.
//   2. The door and the window marked on the Openings layer (click the wall,
//      Add): they start at the room-intake defaults (door 0.8 m, window 0.6 × 1.2
//      on a 1.2 m sill), derived; then set to the sheet's (§2) — measured.
//   3. The fixtures (§3) placed on the Plumbing layer: a WC through the palette
//      (snapped to the W wall, wall reference filled in), then the sheet's
//      centres and footprints; the floor drain as a point.
//   4. Reload: everything persisted; the plan check green; H shown as measured.
//   5. The BoQ, generated: floor 7.00 m², wet tiling 27.53 m² (§8 ≈ 27.5).
// Screenshots → screenshots/bathroom-pilot/b1/ (light, and dark for the plan).
// Scratch project, owned by "b1-owner"; deleted after unless --keep.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

const SCRIPT = "b1-room-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const BASE = `http://localhost:${PORT}`;
const KEEP = process.argv.includes("--keep");
const SHOTS = "screenshots/bathroom-pilot/b1";
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
const f = devFetch("b1-owner", { script: SCRIPT });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const json = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const post = (path, body, method = "POST") => f(`${BASE}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(json);

// The room sheet (cm, origin NW, x east, y south) → normalised plan space (x / L, y / L).
const L = 2.66;
const n = (x, y) => [x / 100 / L, y / 100 / L];
const cm = (p) => [Math.round(p[0] * L * 1000) / 10, Math.round(p[1] * L * 1000) / 10];

/** Set a React-controlled input's value as a user would. */
const typeInto = (sel, value) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`;

let P = null;
let seenErrors = 0;
const logErrors = (where) => { const e = b.errors(); if (e.length > seenErrors) console.log(`  ·  console errors at ${where}: ${e.slice(seenErrors).join(" | ").slice(0, 1500)}`); seenErrors = e.length; };
const b = await openBrowser({ who: "b1-owner", script: SCRIPT });
try {
  await b.viewport(1440, 1000);
  await b.send("Network.setCookie", { name: "rv_theme", value: "light", domain: "localhost", path: "/" });

  // --- 1. Intake -------------------------------------------------------------
  await b.goto(`${BASE}/project/new`, "[data-intake]");
  check("01 Intake offers One room from its dimensions", await b.evaluate(`!!document.querySelector('[data-way="room"]')`));
  await b.evaluate(`document.querySelector('[data-way="room"]').click()`);
  await b.until(`!!document.querySelector("[data-room-intake]")`);
  const reasonEmpty = await b.evaluate(`document.querySelector('[data-testid="intake-continue"]').getAttribute("aria-disabled")`);
  check("Continue is disabled, with its reason, until L × W × H are typed", reasonEmpty === "true" && (await b.evaluate(`/length, width and height/.test(document.body.innerText)`)));
  await b.evaluate(typeInto('[data-room-dim="length"]', "2.66"));
  await b.evaluate(typeInto('[data-room-dim="width"]', "2.63"));
  await b.evaluate(typeInto('[data-room-dim="height"]', "2.80"));
  await b.evaluate(typeInto("[data-intake] input[placeholder^='e.g. Our villa']", "Bathroom pilot — B1 check (scratch)"));
  check("the form reads back 2.66 × 2.63 m · floor 6.99… → 7.00 m² · ceiling 2.80 m", await b.until(`/2\\.66 × 2\\.63 m · floor 7\\.00 m² · ceiling 2\\.80 m/.test(document.body.innerText)`));
  await b.screenshot(`${SHOTS}/1-intake-room-from-dimensions.png`, { fullPage: true });
  await b.evaluate(`document.querySelector('[data-testid="intake-continue"]').click()`);
  check("Continue → 01 Plan on the Openings layer", await b.until(`/\\/project\\/[0-9a-f-]+\\/plan\\?layer=openings/.test(location.href)`, 60000));
  P = (await b.evaluate("location.pathname")).split("/")[2];
  await b.until(`!!document.querySelector("[data-wall-hit]")`, 60000);

  const { data: plan } = await sb.from("plans").select("id, source, intake, plot_width_m, plot_depth_m, total_area_m2, dims_derived").eq("project_id", P).single();
  const { data: rooms } = await sb.from("rooms").select("id, name_en, room_type, area_m2, polygon, ceiling_h_m, ceiling_h_source, dims_derived").eq("plan_id", plan.id);
  const room = rooms[0];
  check("one user_drawn room-intake plan, measured (plot = the room)", rooms.length === 1 && plan.source === "user_drawn" && plan.intake === "room_dimensions" && Number(plan.plot_width_m) === 2.66 && Number(plan.plot_depth_m) === 2.63 && plan.dims_derived === false, JSON.stringify(plan));
  check("the room: Bathroom, 7.00 m², ceiling 2.80 measured", room.name_en === "Bathroom" && room.room_type === "bathroom" && Number(room.area_m2) === 7 && Number(room.ceiling_h_m) === 2.8 && room.ceiling_h_source === "measured" && room.dims_derived === false, JSON.stringify({ ...room, polygon: undefined }));

  // --- 2. Door + window on the Openings layer -------------------------------
  const wallBy = async (pick) => b.evaluate(`(() => { const ws = [...document.querySelectorAll("[data-wall-hit]")].map((el) => { const r = el.getBoundingClientRect(); return { id: el.getAttribute("data-wall-hit"), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }); return ws.sort((a, b) => ${pick})[0]; })()`);
  const addOn = async (wall, kind) => {
    await b.click(wall.x, wall.y);
    await b.until(`!document.querySelector('[data-add-opening="${kind}"]').disabled`);
    await b.evaluate(`document.querySelector('[data-add-opening="${kind}"]').click()`);
    await b.until(`/opening/.test(document.body.innerText) && !document.querySelector('[data-add-opening="${kind}"]').disabled`, 15000);
    await new Promise((r) => setTimeout(r, 800));
    const { data } = await sb.from("plan_openings").select("id, kind, width_mm, height_mm, sill_mm, derived, position").eq("plan_id", plan.id).eq("kind", kind);
    return data?.[0] ?? null;
  };
  const south = await wallBy("b.y - a.y"); // the lowest wall on screen
  const door = await addOn(south, "door");
  logErrors("after the door");
  check("a door added on the S wall starts at 0.8 × 2.1 m, derived", door && door.width_mm === 800 && door.height_mm === 2100 && door.derived === true, JSON.stringify(door));
  const west = await wallBy("a.x - b.x"); // the leftmost wall
  const win = await addOn(west, "window");
  logErrors("after the window");
  check("a window added on the W wall starts at 0.6 × 1.2 m on a 1.2 m sill, derived", win && win.width_mm === 600 && win.height_mm === 1200 && win.sill_mm === 1200 && win.derived === true, JSON.stringify(win));
  await b.screenshot(`${SHOTS}/2-openings-defaults.png`);
  // The sheet's figures (§2) — what dragging along the wall and typing the sizes stores.
  const d2 = await post("/api/plan-openings", { id: door.id, position: n((118 + 205) / 2, 263), width_mm: 870, height_mm: 2100, sill_mm: 0 }, "PATCH");
  const w2 = await post("/api/plan-openings", { id: win.id, position: n(0, (28 + 73) / 2), width_mm: 450, height_mm: 600, sill_mm: 1500 }, "PATCH");
  check("door x 118–205 and window y 28–73 set from the sheet — measured", d2.status === 200 && w2.status === 200 && d2.body.opening?.derived === false && w2.body.opening?.derived === false, `${d2.status} ${w2.status}`);

  logErrors("after the PATCHes");
  // --- 3. Fixtures on the Plumbing layer ------------------------------------
  await b.goto(`${BASE}/project/${P}/plan`, "[data-plan-page]");
  await b.evaluate(`[...document.querySelectorAll('[aria-label="Plan layers"] button')].find((x) => /Plumbing/.test(x.innerText)).click()`);
  await b.until(`/plumbing fixtures/.test(document.body.innerText)`, 15000);
  await b.evaluate(`[...document.querySelectorAll("button")].find((x) => x.title === "WC point").click()`);
  // Click inside the room ~40 cm off the W wall, level with the sheet's WC (y 121).
  const svgBox = await b.evaluate(`(() => { const s = document.querySelector('svg[aria-label="plumbing overlay editor"]'); const r = s.getBoundingClientRect(); const p = s.querySelector("polygon").getBoundingClientRect(); return { l: p.left, t: p.top, w: p.width, h: p.height }; })()`);
  await b.click(svgBox.l + svgBox.w * (75 / 266), svgBox.t + svgBox.h * (121 / 263));
  await b.until(`!!document.querySelector('[data-fixture-type="wc_point"][data-footprint]')`, 15000);
  const { data: wc0 } = await sb.from("plan_fixtures").select("id, type, position, wall_id, spec, room_id").eq("project_id", P).eq("type", "wc_point").single();
  check("a WC placed from the palette backs onto the W wall: flush, facing east, wall reference filled in, default size", wc0 && wc0.wall_id && wc0.spec?.rotation_deg === 90 && wc0.spec?.footprint === "default" && Math.abs(cm(wc0.position)[0] - 35) <= 1, JSON.stringify({ ...wc0, at: wc0 && cm(wc0.position) }));
  await b.screenshot(`${SHOTS}/3-plumbing-wc-snapped.png`);

  // The sheet's fixtures (§3): centre + footprint (W along the wall, D into the room, gap to the wall).
  const FIX = [
    { type: "wc_point", id: wc0.id, at: [33, 121], spec: { width_mm: 420, depth_mm: 660, footprint: "entered", note: "close-coupled: 12 cistern + 54 pan" }, wall: 90 },
    { type: "bidet_point", at: [28, 212], spec: { width_mm: 360, depth_mm: 480, wall_gap_mm: 40, footprint: "entered" }, wall: 90 },
    { type: "basin_point", at: [239, 219.5], spec: { width_mm: 870, depth_mm: 540, footprint: "entered", note: "vanity, stone top, open below; basin (239, 220)" }, wall: 270 },
    { type: "shower_mixer", at: [195.5, 45.5], spec: { width_mm: 1410, depth_mm: 910, footprint: "entered", note: "enclosure NE corner, column on the E wall" }, wall: 180 },
  ];
  for (const x of FIX) {
    const r = await post("/api/plan-fixtures", { ...(x.id ? { id: x.id } : {}), project_id: P, type: x.type, room_id: room.id, position: n(...x.at), spec: x.spec });
    const got = r.body.fixture;
    const at = got ? cm(got.position) : null;
    check(`${x.type} at the sheet's (${x.at.join(", ")}) — ${x.spec.width_mm} × ${x.spec.depth_mm}, faces ${x.wall}°, on its wall`, r.status === 200 && at[0] === x.at[0] && at[1] === x.at[1] && got.spec.rotation_deg === x.wall && !!got.wall_id, JSON.stringify({ status: r.status, at, rot: got?.spec?.rotation_deg, wall: got?.wall_id }));
  }
  const drain = await post("/api/plan-fixtures", { project_id: P, type: "floor_drain", room_id: room.id, position: n(120, 110) });
  check("the floor drain stays a point at (120, 110)", drain.status === 200 && cm(drain.body.fixture.position).join() === "120,110" && drain.body.fixture.wall_id === null);

  logErrors("after the fixtures");
  // --- 4. Reload: persisted, plan check green, H measured --------------------
  await b.goto(`${BASE}/project/${P}/plan`, "[data-ceiling-heights]");
  const h = await b.evaluate(`(() => { const li = document.querySelector("[data-ceiling-room]"); return { source: li.getAttribute("data-ceiling-source"), value: li.querySelector("input").value, text: li.innerText }; })()`);
  check("01 Plan: Ceiling heights shows 2.80 m, measured", h.source === "measured" && h.value === "2.80" && /measured/.test(h.text), JSON.stringify(h));
  const meta = await b.evaluate(`document.querySelector("[data-plan-page] p.font-bp-mono")?.innerText ?? ""`);
  check("the header says 1 room · 7.00 m² · 2.66 × 2.63 × 2.80 m", /1 room · 7\.00 m²/.test(meta) && /2\.66 × 2\.63 × 2\.80 m/.test(meta), meta);
  const green = await b.evaluate(`({ check: document.querySelector("[data-plan-check]")?.getAttribute("data-plan-check"), rules: document.querySelectorAll("[data-plan-rule]").length, issues: document.querySelector("[data-issues-navigator]")?.getAttribute("data-issue-count") ?? "0" })`);
  check("the plan check is green — no overlap, no plan rule, nothing to fix", green.check === "clean" && green.rules === 0 && green.issues === "0", JSON.stringify(green));
  await b.screenshot(`${SHOTS}/4-plan-reloaded.png`, { fullPage: true });
  await b.evaluate(`[...document.querySelectorAll('[aria-label="Plan layers"] button')].find((x) => /Openings/.test(x.innerText)).click()`);
  await b.until(`document.querySelectorAll("[data-wall-hit]").length === 4`, 15000);
  await b.screenshot(`${SHOTS}/5-openings-from-sheet.png`);
  await b.evaluate(`[...document.querySelectorAll('[aria-label="Plan layers"] button')].find((x) => /Plumbing/.test(x.innerText)).click()`);
  await b.until(`document.querySelectorAll("[data-fixture-type]").length === 5`, 15000);
  check("the plumbing layer reloads 5 fixtures, 4 with footprints", (await b.evaluate(`document.querySelectorAll("[data-footprint]").length`)) === 4);
  await b.screenshot(`${SHOTS}/6-plumbing-from-sheet.png`);
  const axe = await b.axe();
  check("axe on 01 Plan (plumbing layer): no violations", axe.length === 0, axe.map((v) => `${v.id}: ${v.nodes[0]}`).join(" | "));
  await b.send("Network.setCookie", { name: "rv_theme", value: "dark", domain: "localhost", path: "/" });
  await b.goto(`${BASE}/project/${P}/plan`, "[data-ceiling-heights]");
  await b.screenshot(`${SHOTS}/dark-4-plan-reloaded.png`, { fullPage: true });
  const axeDark = await b.axe();
  check("axe on 01 Plan, dark: no violations", axeDark.length === 0, axeDark.map((v) => `${v.id}: ${v.nodes[0]}`).join(" | "));
  await b.send("Network.setCookie", { name: "rv_theme", value: "light", domain: "localhost", path: "/" });

  logErrors("after the reload");
  // --- 5. The BoQ ------------------------------------------------------------
  const g = await post("/api/generate-boq", { project_id: P, trigger: "regenerate" });
  check("generate-boq prices the room", g.status === 200 && !!g.body.boq_id, `${g.status} ${g.body.error ?? ""}`);
  const { data: items } = await sb.from("takeoff_items").select("work_item_key, qty").eq("project_id", P);
  const by = (k) => (items ?? []).filter((i) => i.work_item_key === k);
  const floor = by("floor_finish")[0], tiling = by("wet_tiling")[0];
  check("floor 7.00 m²", Number(floor?.qty) === 7, JSON.stringify(floor));
  check("wall tiling 27.53 m² net (10.58 × 2.80 − 0.87 × 2.10 − 0.45 × 0.60; sheet §8 ≈ 27.5)", Number(tiling?.qty) === 27.53, JSON.stringify(tiling));
  const { data: boq } = await sb.from("boqs").select("sections").eq("id", g.body.boq_id).single();
  const wt = boq.sections.sections.flatMap((s) => s.lines).find((l) => /tiling/i.test(l.description) && l.unit === "m2" && Number(l.quantity) === 27.53);
  check("the stored BoQ's wall-tiling line reads 27.53 m²", !!wt, wt ? `${wt.description} · ${wt.quantity} ${wt.unit}` : boq.sections.sections.flatMap((s) => s.lines).filter((l) => /til/i.test(l.description)).map((l) => `${l.description}=${l.quantity}`).join(" | "));
  const plumbing = boq.sections.sections.find((s) => s.work_section === "Plumbing & Sanitary");
  check("Plumbing & Sanitary counts WC 1 · bidet 1 (to be priced) · basin 1 · shower 1 · drain 1", !!plumbing && plumbing.lines.length === 5, plumbing?.lines.map((l) => `${l.description.split(" —")[0]}:${l.quantity}@${l.rate_aed}`).join(" | "));
  await b.goto(`${BASE}/project/${P}/boq`, "[data-boq-review]");
  await b.screenshot(`${SHOTS}/7-boq.png`);
  check("no error in any page console", b.errors().length === 0, b.errors().join(" | ").slice(0, 600));
} finally {
  await b.close();
  if (P && !KEEP) {
    await sb.from("pilot_events").delete().eq("project_id", P);
    await sb.from("boqs").delete().eq("project_id", P);
    await sb.from("projects").delete().eq("id", P);
    console.log("cleaned up the scratch project");
  } else if (P) console.log(`kept the scratch project ${P}`);
  console.log(`shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL B1 CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
