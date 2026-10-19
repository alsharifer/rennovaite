// =============================================================================
// scripts/b7-hinge-check.mjs — B7 item 2, live: the door's hinge side is set
// from 01 Plan (Openings layer), as seen from the room, and the drawing swings
// from it. Signed-in headless Chrome over CDP, dev only.
//
//   node --env-file=.env.local scripts/b7-hinge-check.mjs [port] [project-id] [--side=right]
// =============================================================================

import { mkdirSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { openBrowser } from "./lib/cdp.mjs";

const SCRIPT = "b7-hinge-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const P = process.argv.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? "a2661f34-9d96-4020-a755-40359440c302";
const SIDE = (process.argv.find((a) => a.startsWith("--side="))?.split("=")[1]) ?? "right";
const BASE = `http://localhost:${PORT}`;
const SHOTS = "screenshots/bathroom-pilot/b7";
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const b = await openBrowser({ who: "b1-owner", script: SCRIPT });
try {
  await b.viewport(1440, 1000);
  await b.goto(`${BASE}/project/${P}/plan?layer=openings`, "[data-plan-page]");
  await b.until(`!!document.querySelector("line[data-hinge]")`, 30000);
  const before = await b.evaluate(`document.querySelector("line[data-hinge]").getAttribute("data-hinge")`);
  // Select the door: its glyph listens for pointerdown.
  await b.evaluate(`(() => { const g = document.querySelector("line[data-hinge]").closest("g"); const r = g.getBoundingClientRect(); g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, isPrimary: true })); window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })); })()`);
  await b.until(`!!document.querySelector("[data-hinge-control]")`, 10000);
  check("selecting the door shows the hinge control (Left / Right, as seen from the room)", true, `glyph before: ${before}`);
  await b.screenshot(`${SHOTS}/1-hinge-control.png`);
  await b.evaluate(`document.querySelector('[data-testid="hinge-${SIDE}"]').click()`);
  await b.until(`document.querySelector('[data-testid="hinge-${SIDE}"]')?.getAttribute("aria-pressed") === "true"`, 10000);
  const after = await b.evaluate(`document.querySelector("line[data-hinge]").getAttribute("data-hinge")`);
  check(`choosing ${SIDE} stores it and the editor's swing follows`, after === SIDE, `glyph after: ${after}`);
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: plan } = await sb.from("plans").select("id").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single();
  const { data: door } = await sb.from("plan_openings").select("spec").eq("plan_id", plan.id).eq("kind", "door").limit(1).single();
  const stored = door?.spec?.hinge_side ?? null;
  check("the opening's spec carries hinge_side", stored === SIDE, String(stored));
  await b.screenshot(`${SHOTS}/2-hinge-${SIDE}.png`);
} finally {
  await b.close();
}
console.log(failures === 0 ? "\nB7 HINGE: ALL CHECKS PASSED" : `\nB7 HINGE: ${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
