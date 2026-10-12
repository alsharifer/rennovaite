// =============================================================================
// scripts/k5-bad-parse.mjs — the J0 06-bad-parse fixture as a scratch project
// on DEV, for the K5 plan-check states (R7 §3.8).
//
//   node scripts/k5-bad-parse.mjs seed       → prints the project id
//   node scripts/k5-bad-parse.mjs teardown
//
// The fixture (lib/plan/__fixtures__/j0-bad-parse.json) is the worst
// pre-repair production parse — 13 rooms, 12 overlapping pairs, 23.6% of the
// room area counted twice — polygons only. The project belongs to the
// "pipeline" dev account (a real session's user, made a member with the
// service role — the operator act; no route bypass). Refuses production.
// =============================================================================

import { randomUUID } from "node:crypto";
import fs from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const NAME = "K5 bad parse (scratch)";
const mode = process.argv[2] ?? "seed";
const { url, key } = resolveTarget({ script: "k5-bad-parse", writes: true });
const sb = createClient(url, key);
const fixture = JSON.parse(fs.readFileSync("lib/plan/__fixtures__/j0-bad-parse.json", "utf8"));

async function teardown() {
  const { data: projects } = await sb.from("projects").select("id").eq("name", NAME);
  for (const p of projects ?? []) {
    for (const t of ["boqs", "pilot_events", "project_members"]) await sb.from(t).delete().eq("project_id", p.id);
    const { data: plans } = await sb.from("plans").select("id").eq("project_id", p.id);
    for (const pl of plans ?? []) await sb.from("rooms").delete().eq("plan_id", pl.id);
    await sb.from("plans").delete().eq("project_id", p.id);
    await sb.from("projects").delete().eq("id", p.id);
    console.log(`removed ${p.id}`);
  }
}

if (mode === "teardown") {
  await teardown();
  const left = ((await sb.from("projects").select("id").eq("name", NAME)).data ?? []).length;
  console.log(left === 0 ? "REVERSIBLE — no scratch bad-parse project remains" : `${left} left`);
  process.exit(left === 0 ? 0 : 1);
}

await teardown();
const me = await devSession("pipeline", { script: "k5-bad-parse" });
const projectId = randomUUID();
const planId = randomUUID();
const parsed = { rooms: fixture.rooms, total_area_m2: fixture.total_area_m2, units: "normalized" };
let r = await sb.from("projects").insert({ id: projectId, name: NAME, city: "Dubai", currency: "AED", status: "draft" });
if (!r.error) r = await sb.from("project_members").insert({ project_id: projectId, user_id: me.userId });
if (!r.error) r = await sb.from("plans").insert({ id: planId, project_id: projectId, total_area_m2: fixture.total_area_m2, parsed_json: parsed });
if (!r.error) r = await sb.from("rooms").insert(fixture.rooms.map((room) => ({ id: randomUUID(), plan_id: planId, name_en: room.name_en, name_ar: room.name_ar, room_type: room.room_type, area_m2: room.area_m2, polygon: room.polygon })));
if (r.error) throw new Error(r.error.message);
console.log(JSON.stringify({ project_id: projectId, plan_id: planId, rooms: fixture.rooms.length, member: me.email }));
