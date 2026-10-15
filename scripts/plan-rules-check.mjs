// =============================================================================
// scripts/plan-rules-check.mjs — the plan editor's guardrails, live (15 Oct).
//
//   node --env-file=.env.local scripts/plan-rules-check.mjs [port] [--shots=dir] [--keep]
//
// Seeds lib/plan/__fixtures__/jumeirah-parks-plan-15oct.json (prod Jumeirah
// Parks as the owner left it on 15 Oct: 12 rooms, 16 openings) as a SCRATCH
// project on DEV, opens 01 Plan signed in, and checks:
//   1. "PLAN RULES" lists the audit (2 unnamed zones blocking regenerate, the
//      garden-edge door needing a wall, the Hall's Arabic label, the skewed
//      outlines) and the top bar's "⚑ N TO FIX" carries the same count;
//   2. the rail refuses regenerate with "no name";
//   3. the Openings layer draws every opening on the wall it sits on and the
//      garden-edge door as "Needs a wall";
//   4. "Keep anyway" on a soft rule moves it to "Kept anyway"; Undo puts it back;
//   5. every room label stays inside its room's box.
// Refuses production; the scratch project is removed afterwards (--keep leaves it).
// =============================================================================

import { randomUUID } from "node:crypto";
import fs from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 3091);
const SHOTS = args.find((a) => a.startsWith("--shots="))?.slice(8);
const KEEP = args.includes("--keep");
const NAME = "Plan rules check (scratch)";
const { url: sbUrl, key } = resolveTarget({ script: "plan-rules-check", writes: true });
const sb = createClient(sbUrl, key);
const fx = JSON.parse(fs.readFileSync("lib/plan/__fixtures__/jumeirah-parks-plan-15oct.json", "utf8"));

let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

async function teardown() {
  const { data: projects } = await sb.from("projects").select("id").eq("name", NAME);
  for (const p of projects ?? []) {
    for (const t of ["boqs", "pilot_events", "project_members"]) await sb.from(t).delete().eq("project_id", p.id);
    const { data: plans } = await sb.from("plans").select("id").eq("project_id", p.id);
    for (const pl of plans ?? []) {
      await sb.from("plan_openings").delete().eq("plan_id", pl.id);
      await sb.from("rooms").delete().eq("plan_id", pl.id);
    }
    await sb.from("plans").delete().eq("project_id", p.id);
    await sb.from("projects").delete().eq("id", p.id);
  }
}

await teardown();
const me = await devSession("pipeline", { script: "plan-rules-check" });
const projectId = randomUUID();
const planId = randomUUID();
const roomIds = new Map(fx.rooms.map((r) => [r.id, randomUUID()]));
let r = await sb.from("projects").insert({ id: projectId, name: NAME, city: "Dubai", currency: "AED", status: "draft" });
if (!r.error) r = await sb.from("project_members").insert({ project_id: projectId, user_id: me.userId });
if (!r.error) r = await sb.from("plans").insert({ id: planId, project_id: projectId, total_area_m2: fx.total_area_m2, parsed_json: { rooms: [], total_area_m2: fx.total_area_m2 } });
if (!r.error) r = await sb.from("rooms").insert(fx.rooms.map((x) => ({ id: roomIds.get(x.id), plan_id: planId, name_en: x.name_en, name_ar: x.name_ar, room_type: x.room_type, area_m2: x.area_m2, polygon: x.polygon, unroofed: x.unroofed, in_scope: x.in_scope })));
if (!r.error) {
  r = await sb.from("plan_openings").insert(
    fx.openings.map((o) => ({
      id: randomUUID(), plan_id: planId, kind: o.kind, width_mm: o.width_mm, height_mm: o.height_mm, sill_mm: o.sill_mm, position: o.position,
      room_id: o.room_id ? roomIds.get(o.room_id) ?? null : null, source: o.source, wall_ref: o.wall_ref, derived: o.derived,
      ...(o.source === "detected" ? { confirmed_at: new Date().toISOString(), detection: { ...(o.detection ?? {}), opens_to_room_id: o.detection?.opens_to_room_id ? roomIds.get(o.detection.opens_to_room_id) ?? null : null } } : {}),
    })),
  );
}
if (r.error) throw new Error(r.error.message);
console.log(`scratch project ${projectId} (${fx.rooms.length} rooms, ${fx.openings.length} openings)`);

const b = await openBrowser({ script: "plan-rules-check", projects: [projectId] });
const q = (expr) => b.evaluate(expr);
const page = `http://localhost:${port}/project/${projectId}/plan`;
try {
  await b.viewport(1440, 1100);
  await b.goto(page, "[data-plan-page]");
  await b.until(`!!document.querySelector('[data-plan-rules]')`, 30000);

  // 1. the list
  const rules = await q(`[...document.querySelectorAll('[data-plan-rule]')].map((li) => li.getAttribute('data-plan-rule') + '|' + li.getAttribute('data-severity') + '|' + li.querySelector('p:nth-of-type(2)').textContent)`);
  console.log(rules.map((x) => `      ${x}`).join("\n"));
  const has = (rule, re) => rules.some((x) => x.startsWith(rule + "|") && (!re || re.test(x)));
  check("2 unnamed zones block regenerate", rules.filter((x) => x.startsWith("unnamed|blocks|")).length === 2);
  check("the door on the garden edge needs a wall", has("on_wall", /edge of Grass — not a wall/));
  check("the Hall's Arabic label is flagged", has("label_lang", /Hall: the Arabic label still says/));
  check("the skewed outlines are flagged (Entrance Foyer, Kitchen, Powder Room)", ["Entrance Foyer", "Kitchen", "Powder Room"].every((n) => has("skew", new RegExp(n))));
  const navCount = Number(await q(`document.querySelector('[data-issues-navigator]')?.getAttribute('data-issue-count') ?? 0`));
  const listCount = Number(await q(`document.querySelector('[data-plan-rules]').getAttribute('data-plan-rules')`));
  check("the top bar's ⚑ N TO FIX carries the list (plus the step's own reason)", navCount >= listCount && listCount > 0, `navigator ${navCount}, list ${listCount}`);

  // 2. the rail
  const rail = await q(`document.querySelector('[data-rail]')?.textContent ?? document.body.textContent`);
  check("the rail refuses regenerate: rooms with no name", /no name/i.test(rail));
  if (SHOTS) await b.screenshot(`${SHOTS}/plan-rules-panel.png`);

  // 5. labels inside their rooms (Plan layer)
  const spill = await q(`(() => {
    const out = [];
    for (const g of document.querySelectorAll('.room-group')) {
      const poly = g.querySelector('polygon');
      if (!poly) continue;
      const pb = poly.getBBox();
      for (const t of g.querySelectorAll('[data-room-label]')) {
        const tb = t.getBBox();
        if (tb.x < pb.x - 0.5 || tb.x + tb.width > pb.x + pb.width + 0.5 || tb.y < pb.y - 0.5 || tb.y + tb.height > pb.y + pb.height + 0.5) out.push(t.textContent);
      }
    }
    return out;
  })()`);
  check("every room label stays inside its room", spill.length === 0, spill.join(", "));
  if (SHOTS) await b.screenshot(`${SHOTS}/plan-rules-labels.png`);

  // 3. the openings layer
  await q(`[...document.querySelectorAll('[aria-label="Plan layers"] button')].find((x) => /Openings/.test(x.textContent)).click()`);
  await b.until(`!document.body.textContent.includes('Loading openings')`, 15000);
  const needs = await q(`document.querySelectorAll('[data-needs-wall]').length`);
  check("the garden-edge door is drawn as Needs a wall (the only one)", needs === 1, `${needs}`);
  const spill2 = await q(`(() => {
    const out = [];
    for (const g of document.querySelectorAll('svg g')) {
      const poly = g.querySelector(':scope > polygon'), t = g.querySelector(':scope > text');
      if (!poly || !t) continue;
      const pb = poly.getBBox(), tb = t.getBBox();
      if (tb.width && (tb.x < pb.x - 0.5 || tb.x + tb.width > pb.x + pb.width + 0.5)) out.push(t.textContent);
    }
    return out;
  })()`);
  check("Openings layer: every room name stays inside its room", spill2.length === 0, spill2.join(", "));
  if (SHOTS) await b.screenshot(`${SHOTS}/plan-rules-openings.png`);

  // 4. keep anyway → kept → undo
  await q(`[...document.querySelectorAll('[aria-label="Plan layers"] button')].find((x) => /Plan/.test(x.textContent)).click()`);
  const before = listCount;
  await q(`document.querySelector('[data-plan-rule="skew"] [data-keep-anyway]').click()`);
  const kept = await b.until(`Number(document.querySelector('[data-plan-rules]')?.getAttribute('data-plan-rules')) === ${before - 1} && /Kept anyway · 1/.test(document.querySelector('[data-plan-rules]').textContent)`, 20000);
  check("Keep anyway: one fewer to fix, listed under Kept anyway", kept);
  await q(`[...document.querySelectorAll('[data-plan-rules] details button')][0].click()`);
  const undone = await b.until(`Number(document.querySelector('[data-plan-rules]')?.getAttribute('data-plan-rules')) === ${before}`, 20000);
  check("Undo puts it back", undone);
} finally {
  await b.close();
  if (!KEEP) await teardown();
}
console.log(failures === 0 ? "\nPLAN RULES CHECK PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
