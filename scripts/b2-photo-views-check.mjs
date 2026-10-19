#!/usr/bin/env node
// =============================================================================
// scripts/b2-photo-views-check.mjs — bathroom pilot B2 (commit 1) live: the
// pilot's five photos become five views of the room, placed on the plan at the
// room sheet's §4 cameras, through the real renders studio.
//
//   node --env-file=.env.local scripts/b2-photo-views-check.mjs [port]
//
// Needs a dev server with MULTIVIEW_RENDERS_ENABLED=true (the `bathroom` launch
// entry, port 3096) and the dev test project a2661f34 (B1's bathroom).
//   1. "Add photos" takes the five client photos at once (the real file input:
//      compressed on the client, straight to Storage) — five views, "Photo 1 ·
//      your photo" … "Photo 5", every one listed; portrait kept.
//   2. P1 placed by pressing where it was taken and dragging toward what it
//      shows; P2 by typing X, Y and the heading; P3–P5 through the route.
//   3. Reload: P1–P5 on the plan with their directions; axe light + dark.
// Idempotent: photos already there are not uploaded again. Nothing is deleted —
// the views are B2's working state.
// =============================================================================

import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

const SCRIPT = "b2-photo-views-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const BASE = `http://localhost:${PORT}`;
const P = "a2661f34-9d96-4020-a755-40359440c302";
const PHOTOS = path.resolve("data/Bathroom Pilot/Current Photos");
const SHOTS = "screenshots/bathroom-pilot/b2";
// Room sheet §4 — camera (cm from the NW corner) and compass heading.
const SHEET = [
  { file: "IMG-20261018-WA0009.jpg", at: [35, 60], heading: 155, looks: [161.5, 263] },
  { file: "IMG-20261018-WA0011.jpg", at: [30, 130], heading: 105, looks: [239, 219.5] },
  { file: "IMG-20261018-WA0012.jpg", at: [40, 230], heading: 40, looks: [195.5, 45.5] },
  { file: "IMG-20261018-WA0014.jpg", at: [235, 235], heading: 300, looks: [0, 50.5] },
  { file: "IMG-20261018-WA0016.jpg", at: [118, 105], heading: 60, looks: [266, 43] },
];
const n = ([x, y]) => [x / 266, y / 266];
const cm = (p) => p.map((v) => Math.round(v * 266 * 10) / 10);

const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
const f = devFetch("b1-owner", { script: SCRIPT });
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const patch = async (id, camera) => {
  const r = await f(`${BASE}/api/room-photos`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, camera }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const { data: plan } = await sb.from("plans").select("id").eq("project_id", P).single();
const { data: room } = await sb.from("rooms").select("id, name_en").eq("plan_id", plan.id).single();
const photosOf = async () => (await sb.from("room_photos").select("id, public_url, storage_path, created_at, camera_position, camera_heading_deg").eq("room_id", room.id).order("created_at")).data ?? [];

const b = await openBrowser({ who: "b1-owner", script: SCRIPT });
try {
  await b.viewport(1440, 1000);
  await b.send("Network.setCookie", { name: "rv_theme", value: "light", domain: "localhost", path: "/" });
  await b.goto(`${BASE}/project/${P}/render`, "[data-photo-views]");
  check("the renders studio shows Your photos for the bathroom (MULTIVIEW_RENDERS_ENABLED)", await b.evaluate(`!!document.querySelector("[data-photo-views]")`));

  // --- 1. Add photos: all five at once, through the real file input ----------
  if ((await photosOf()).length === 0) {
    const { root } = await b.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await b.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"][aria-label^="Add photos"]' });
    await b.send("DOM.setFileInputFiles", { nodeId, files: SHEET.map((s) => path.join(PHOTOS, s.file)) });
    check("Add photos takes the five photos at once", await b.until(`document.querySelector("[data-photo-views]")?.getAttribute("data-photo-views") === "5"`, 180000));
  } else console.log("  ·  photos already uploaded — not uploading again");
  const rows = await photosOf();
  check("five room_photos rows, all listed (not just the latest)", rows.length === 5 && (await b.evaluate(`document.querySelectorAll("[data-photo-view]").length`)) === 5, String(rows.length));
  const labels = await b.evaluate(`[...document.querySelectorAll("[data-photo-view]")].map((x) => x.innerText.split("\\n")[0])`);
  check("labelled Photo 1 · your photo … Photo 5 · your photo", labels.join("|") === [1, 2, 3, 4, 5].map((i) => `Photo ${i} · your photo`).join("|"), labels.join(" | "));
  const dims = await b.evaluate(`Promise.all([...document.querySelectorAll("[data-photo-view] img")].map((i) => (i.complete ? Promise.resolve() : new Promise((r) => (i.onload = r))).then(() => [i.naturalWidth, i.naturalHeight])))`);
  check("every photo kept portrait (no 3:2 re-crop): 2048 px tall, 1848 : 4000", dims.every(([w, h]) => h === 2048 && Math.abs(w / h - 1848 / 4000) < 0.002), JSON.stringify(dims));

  // --- 2. Place them ----------------------------------------------------------
  // P1 by drag: press at the camera, drag toward what it shows.
  await b.evaluate(`document.querySelectorAll("[data-photo-view]")[0].click()`);
  await new Promise((r) => setTimeout(r, 300));
  const box = await b.evaluate(`(() => { const s = document.querySelector("[data-photo-plan]"); const r = s.getBoundingClientRect(); const vb = s.viewBox.baseVal; return { l: r.left, t: r.top, w: r.width, h: r.height, vw: vb.width, vh: vb.height }; })()`);
  // The plan draws the room 266 cm wide inside a 26-unit pad on a 320-unit box.
  const s = (320 - 52) / 1; // normalised units → viewBox units (room is 1 unit wide)
  const toScreen = ([x, y]) => [box.l + ((26 + (x / 266) * s) / box.vw) * box.w, box.t + ((26 + (y / 266) * s) / box.vh) * box.h];
  const [fx, fy] = toScreen(SHEET[0].at);
  const [tx, ty] = toScreen(SHEET[0].looks);
  await b.mouse(fx, fy, "mouseMoved");
  await b.mouse(fx, fy, "mousePressed");
  for (let i = 1; i <= 8; i++) await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fx + ((tx - fx) * i) / 8, y: fy + ((ty - fy) * i) / 8, button: "left", buttons: 1 });
  await b.mouse(tx, ty, "mouseReleased");
  await b.until(`document.querySelectorAll("[data-photo-view]")[0].getAttribute("data-placed") === "true"`, 15000);
  const p1 = (await photosOf())[0];
  const p1at = cm(p1.camera_position ?? [NaN, NaN]);
  const off = Math.abs(((Number(p1.camera_heading_deg) - SHEET[0].heading + 540) % 360) - 180);
  check("P1 placed by dragging on the plan: at the sheet's (35, 60) and heading ~155° SSE", Math.hypot(p1at[0] - 35, p1at[1] - 60) <= 4 && off <= 20, `at (${p1at.join(", ")}), ${p1.camera_heading_deg}°`);
  await b.screenshot(`${SHOTS}/1-photo-views-p1-dragged.png`, { fullPage: true });

  // P2 by the keyboard: X, Y in metres and the heading.
  await b.evaluate(`document.querySelectorAll("[data-photo-view]")[1].click()`);
  await b.until(`!!document.querySelector("[data-camera-fields]")`);
  const fill = (i, v) => `(() => { const el = document.querySelectorAll("[data-camera-fields] input")[${i}]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`;
  await b.evaluate(fill(0, "0.30"));
  await b.evaluate(fill(1, "1.30"));
  await b.evaluate(fill(2, "105"));
  await b.evaluate(`document.querySelector("[data-camera-fields] button[type=submit]").click()`);
  await b.until(`document.querySelectorAll("[data-photo-view]")[1].getAttribute("data-placed") === "true"`, 15000);
  const p2 = (await photosOf())[1];
  check("P2 placed from the keyboard: (30, 130) cm, 105° ESE", cm(p2.camera_position).join() === "30,130" && Number(p2.camera_heading_deg) === 105, `${cm(p2.camera_position ?? [0, 0]).join(", ")} · ${p2.camera_heading_deg}°`);

  // Every photo at the sheet's §4 camera exactly (P1 too — the drag is ~), through the route.
  const all = await photosOf();
  for (let i = 0; i < 5; i++) {
    const r = await patch(all[i].id, { position: n(SHEET[i].at), heading_deg: SHEET[i].heading });
    check(`P${i + 1} (${SHEET[i].file.slice(-8, -4)}) at (${SHEET[i].at.join(", ")}) → ${SHEET[i].heading}°`, r.status === 200 && r.body.view?.camera?.heading_deg === SHEET[i].heading, `${r.status} ${r.body.error ?? ""}`);
  }
  const outside = await patch(all[0].id, { position: n([300, 60]), heading_deg: 90 });
  check("a camera outside the room is refused (422 outside_room)", outside.status === 422 && outside.body.code === "outside_room", JSON.stringify(outside.body));
  const anon = await fetch(`${BASE}/api/room-photos?room_id=${room.id}`);
  check("the route needs a signed-in member (401 anonymous)", anon.status === 401, String(anon.status));

  // --- 3. Reload: on the plan -------------------------------------------------
  await b.goto(`${BASE}/project/${P}/render`, "[data-photo-views]");
  const markers = await b.evaluate(`[...document.querySelectorAll("[data-photo-marker]")].map((m) => m.getAttribute("data-photo-marker")).join(",")`);
  check("after reload the plan shows P1–P5 with their directions", markers === "P1,P2,P3,P4,P5", markers);
  check("…and every view reads placed", (await b.evaluate(`[...document.querySelectorAll("[data-photo-view]")].every((x) => x.getAttribute("data-placed") === "true")`)) === true);
  await b.evaluate(`document.querySelectorAll("[data-photo-view]")[1].click()`);
  await new Promise((r) => setTimeout(r, 400));
  await b.evaluate(`document.querySelector("[data-photo-views]").scrollIntoView()`);
  await b.screenshot(`${SHOTS}/2-photo-views-placed.png`, { fullPage: true });
  const axe = await b.axe();
  check("axe on the studio with the photo views: no violations", axe.length === 0, axe.map((v) => `${v.id}: ${v.nodes[0]}`).join(" | "));
  await b.send("Network.setCookie", { name: "rv_theme", value: "dark", domain: "localhost", path: "/" });
  await b.goto(`${BASE}/project/${P}/render`, "[data-photo-views]");
  await b.screenshot(`${SHOTS}/dark-2-photo-views-placed.png`, { fullPage: true });
  const axeDark = await b.axe();
  check("axe, dark: no violations", axeDark.length === 0, axeDark.map((v) => `${v.id}: ${v.nodes[0]}`).join(" | "));
  await b.viewport(390, 844, { mobile: true, touch: true });
  await b.goto(`${BASE}/project/${P}/render`, "[data-photo-views]");
  const overflow = await b.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check("phone: no horizontal overflow", overflow <= 0, String(overflow));
  await b.evaluate(`document.querySelector("[data-photo-views]").scrollIntoView()`);
  await b.screenshot(`${SHOTS}/3-photo-views-phone.png`);
  check("no error in any page console", b.errors().length === 0, b.errors().join(" | ").slice(0, 600));
} finally {
  await b.close();
}
console.log(failures === 0 ? "\nALL B2 PHOTO-VIEW CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
