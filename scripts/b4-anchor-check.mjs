#!/usr/bin/env node
// =============================================================================
// scripts/b4-anchor-check.mjs — bathroom pilot B4 live: one design across the
// pilot bathroom's views, through the real studio (82:48).
//
//   node --env-file=.env.local scripts/b4-anchor-check.mjs [port] --phase=look|lock|render|change|shots [--version=N] [--asks=P4:text|P1:text|P2:text]
//
// On the dev test project a2661f34 (`bathroom` launch entry: MULTIVIEW_RENDERS_ENABLED,
// PHOTO_VIEW_MAX_ATTEMPTS=2, PHOTO_VIEW_MODEL=pro). Phases, so every paid step
// can be looked at before the next:
//   look    the studio: grouped list, five photo rows, centre + views strip,
//           views on the plan, design checks, render spend (no spend)
//   lock    select P2, pick version --version (default: the latest that passed),
//           Lock this view → it anchors the room; the room design spec is read
//   render  "Render remaining" — the cost guard's default scope (positioned,
//           unlocked views not rendered against the anchor): P1, P3, P4, P5 —
//           each must say "Finishes follow Photo 2 (locked) ✓" or say why not
//   change  three "Ask for a change" requests through the form (--asks); a change
//           on the anchor marks the other views TO UPDATE
//   shots   light + dark screenshots, desktop + tablet + phone; axe
// Screenshots: screenshots/bathroom-pilot/b4/ (gitignored — client photos).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";

const SCRIPT = "b4-anchor-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const BASE = `http://localhost:${PORT}`;
const arg = (n, d = "") => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const PHASE = arg("phase", "look");
const P = "a2661f34-9d96-4020-a755-40359440c302";
const SHOTS = "screenshots/bathroom-pilot/b4";
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const spendAed = async () => Number((await sb.from("render_spend").select("cost_aed").eq("project_id", P)).data?.reduce((s, r) => s + Number(r.cost_aed ?? 0), 0) ?? 0);

const b = await openBrowser({ who: "b1-owner", script: SCRIPT });
const rows = () => b.evaluate(`[...document.querySelectorAll('[data-view-row^="photo:"]')].map((el) => ({ id: el.getAttribute("data-view-row").slice(6), label: el.innerText.split("\\n")[0], state: el.getAttribute("data-view-state") }))`);
const pick = async (n) => {
  await b.evaluate(`document.querySelectorAll('[data-view-row^="photo:"]')[${n - 1}].click()`);
  await b.until(`!!document.querySelector("[data-photo-view-render]")`);
  await new Promise((r) => setTimeout(r, 300));
};
const centre = () => b.evaluate(`(() => { const el = document.querySelector("[data-photo-view-render]"); if (!el) return null; return { id: el.getAttribute("data-photo-view-render"), outcome: el.getAttribute("data-outcome"), follows: el.getAttribute("data-follows"), eyebrow: el.querySelector("[data-view-eyebrow]")?.innerText ?? "", check: el.querySelector("[data-design-check]")?.innerText.replace(/\\s+/g, " ") ?? "", notice: el.querySelector("[data-render-notice]")?.innerText ?? "", last: el.querySelector("[data-last-change]")?.innerText ?? "", versions: el.querySelectorAll("[data-version]").length, scores: el.querySelector("[data-scores]")?.innerText ?? "" }; })()`);
const waitIdle = (ms = 600000) => b.until(`![...document.querySelectorAll('[data-view-row^="photo:"]')].some((el) => el.getAttribute("data-view-state") === "rendering")`, ms);

try {
  await b.viewport(1440, 1000);
  await b.send("Network.setCookie", { name: "rv_theme", value: "light", domain: "localhost", path: "/" });
  await b.goto(`${BASE}/project/${P}/render`, '[data-view-row^="photo:"]');
  const spend0 = await spendAed();

  if (PHASE === "look") {
    const r = await rows();
    check("the left list groups the room and lists its five photo views", r.length === 5 && (await b.evaluate(`document.querySelectorAll("[data-room-group]").length`)) >= 1, r.map((x) => `${x.label}: ${x.state}`).join(" · "));
    const c = await centre();
    check("the centre shows the selected photo view with its eyebrow", !!c && /FROM YOUR PHOTO/.test(c.eyebrow), c?.eyebrow);
    check("the views strip lists every view + Add photos + Add a view", (await b.evaluate(`document.querySelectorAll("[data-views-strip] [data-photo-view]").length`)) === 5 && (await b.evaluate(`!!document.querySelector("[data-add-photos]") && !!document.querySelector("[data-add-view]")`)));
    check("views on the plan: room, openings, fixtures and five P markers", (await b.evaluate(`document.querySelectorAll("aside [data-photo-plan] [data-photo-marker]").length`)) === 5);
    check("design checks per view on the right", (await b.evaluate(`document.querySelectorAll("aside [data-check-view]").length`)) === 5);
    check("the render spend is visible", !!(await b.evaluate(`document.querySelector("[data-render-spend]")?.getAttribute("data-render-spend")`)));
    for (let n = 1; n <= 5; n++) {
      await pick(n);
      console.log(`  ·  P${n}:`, JSON.stringify(await centre()));
    }
    await pick(2);
    await b.screenshot(`${SHOTS}/0-look-P2.png`);
  }

  if (PHASE === "lock") {
    await pick(2);
    const want = Number(arg("version", "0"));
    const vs = await b.evaluate(`document.querySelectorAll("[data-photo-view-render] [data-version]").length`);
    const n = want || vs; // default latest
    if (vs > 1) await b.evaluate(`document.querySelector('[data-photo-view-render] [data-version="${n}"]').click()`);
    await new Promise((r) => setTimeout(r, 300));
    const before = await centre();
    console.log("  ·  P2 version", n, "of", vs, "—", before.check);
    await b.evaluate(`document.querySelector('[data-testid="lock-photo-view"]').click()`);
    await b.until(`document.querySelector('[data-view-row^="photo:"]:nth-of-type(1)') && [...document.querySelectorAll('[data-view-row^="photo:"]')][1].getAttribute("data-view-state") === "anchor"`, 120000);
    const after = await centre();
    check("P2 is locked and anchors the room", (await rows())[1].state === "anchor", after.check);
    const { data: anchor } = await sb.from("room_anchors").select("render_id, room_photo_id, spec").limit(5);
    console.log("  ·  room design spec:", JSON.stringify(anchor?.[0]?.spec, null, 2));
    check("the room design spec was read from the locked render", !!anchor?.[0]?.spec?.vanity || !!anchor?.[0]?.spec?.floor_tile);
    const r = await rows();
    console.log("  ·  states:", r.map((x) => `${x.label}: ${x.state}`).join(" · "));
    console.log("  ·  remaining:", await b.evaluate(`document.querySelector("[data-cost-guard]")?.innerText ?? "—"`));
    await b.screenshot(`${SHOTS}/1-locked-P2.png`);
  }

  if (PHASE === "render") {
    console.log("  ·  remaining:", await b.evaluate(`document.querySelector("[data-cost-guard]")?.innerText ?? "—"`), "·", await b.evaluate(`document.querySelector('[data-testid="render-remaining"]').innerText`));
    const t0 = Date.now();
    await b.evaluate(`document.querySelector('[data-testid="render-remaining"]').click()`);
    await b.until(`[...document.querySelectorAll('[data-view-row^="photo:"]')].some((el) => el.getAttribute("data-view-state") === "rendering")`, 30000);
    await waitIdle();
    console.log(`  ·  rendered in ${Math.round((Date.now() - t0) / 1000)} s`);
    for (const n of [1, 3, 4, 5]) {
      await pick(n);
      const c = await centre();
      console.log(`  ·  P${n}: ${c.outcome} · follows ${c.follows} · ${c.check} · ${c.scores}`);
      check(`P${n}: layout kept and "Finishes follow Photo 2 (locked) ✓"`, c.outcome === "passed" && c.follows === "follows", c.check);
      await b.until(`[...document.images].every((i) => i.complete)`, 30000);
      await b.screenshot(`${SHOTS}/2-follows-P${n}.png`);
    }
  }

  if (PHASE === "change") {
    const asks = arg("asks", "").split("|").filter(Boolean).map((s) => ({ n: Number(s.split(":")[0].replace("P", "")), text: s.slice(s.indexOf(":") + 1) }));
    for (const a of asks) {
      await pick(a.n);
      const before = await centre();
      await b.evaluate(`(() => { const i = document.querySelector("[data-ask-change] input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(a.text)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await new Promise((r) => setTimeout(r, 200));
      await b.evaluate(`document.querySelector('[data-ask-change] button[type="submit"]').click()`);
      await b.until(`[...document.querySelectorAll('[data-view-row^="photo:"]')][${a.n - 1}].getAttribute("data-view-state") === "rendering"`, 15000);
      await waitIdle(300000);
      const after = await centre();
      console.log(`  ·  P${a.n} "${a.text}": versions ${before.versions} → ${after.versions} · ${after.last || after.notice}`);
      check(`P${a.n}: the change is a new version with what it changed, or the honest message`, (after.versions > before.versions && /changed:/.test(after.last)) || /didn.t come through|was not kept|from your plan/.test(after.notice), after.last || after.notice);
      await b.until(`[...document.images].every((i) => i.complete)`, 30000);
      await b.screenshot(`${SHOTS}/3-change-P${a.n}.png`);
    }
    const r = await rows();
    console.log("  ·  states after the changes:", r.map((x) => `${x.label}: ${x.state}`).join(" · "));
  }

  if (PHASE === "shots") {
    for (const theme of ["light", "dark"]) {
      await b.send("Network.setCookie", { name: "rv_theme", value: theme, domain: "localhost", path: "/" });
      for (const [w, h, name] of [[1440, 1174, "desktop"], [1024, 1100, "tablet"], [390, 1600, "phone"]]) {
        await b.viewport(w, h);
        await b.goto(`${BASE}/project/${P}/render`, '[data-view-row^="photo:"], [data-photo-view-render]');
        await b.until(`!!document.querySelector("[data-photo-view-render]")`);
        await b.until(`[...document.images].every((i) => i.complete)`, 30000);
        await new Promise((r) => setTimeout(r, 500));
        await b.screenshot(`${SHOTS}/4-${theme}-${name}.png`);
        const axe = await b.axe();
        check(`axe ${theme} ${name}: no violations`, axe.length === 0, axe.map((v) => `${v.id}: ${v.nodes[0]}`).join(" | "));
        const overflow = await b.evaluate(`document.documentElement.scrollWidth > window.innerWidth + 1`);
        check(`${theme} ${name}: no horizontal overflow`, !overflow);
      }
    }
    check("no error in any page console", b.errors().length === 0, b.errors().join(" | ").slice(0, 600));
  }

  const spend1 = await spendAed();
  console.log(`  ·  render_spend_aed ${spend0.toFixed(2)} → ${spend1.toFixed(2)} (this phase AED ${(spend1 - spend0).toFixed(2)})`);
} finally {
  await b.close();
}
console.log(failures === 0 ? `\nB4 ${PHASE.toUpperCase()}: ALL CHECKS PASSED` : `\nB4 ${PHASE.toUpperCase()}: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
