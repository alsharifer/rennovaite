#!/usr/bin/env node
// =============================================================================
// scripts/element-sections-flag-check.mjs — U7 live check: the six element
// sections resolve the same whether VIEWER_3D_ENABLED is on or off.
//
// Two dev servers cannot share one .next directory, so the two flag states run
// in turn, each capture against the server of the moment:
//
//   node --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/element-sections-flag-check.mjs capture on 3098
//        (server started WITH VIEWER_3D_ENABLED=true — launch config `pack`)
//   … capture off 3097   (server started WITHOUT it — launch config `pack-off`; stop the first server first)
//   … compare            (the verdict; removes the scratch state)
//
// Each capture dry-runs (writes nothing) the canonical Mudon villa (READ-ONLY —
// 6b5fda9d is never written, on any database) and a SCRATCH interior villa
// seeded from the same plan fixture under a fresh id, owned by a scratch firm
// holding a rate on each of the six element keys; it saves the six sections.
// `compare` asserts: Mudon's six sections byte-identical ON vs OFF with the
// take-off lines in both; the scratch villa's six firm rates at tier 1 with the
// same figures on both. Scratch state (villa, firm, entries) persists between
// the captures and is removed by `compare`. Refuses production.
// =============================================================================

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { MUDON_FIXTURE } from "../lib/plan/__tests__/mudon.fixture.ts";
import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const [mode, label, port] = process.argv.slice(2);
const OUT = path.join(process.env.TEMP ?? process.env.TMP ?? ".", "u7-flag-check");
fs.mkdirSync(OUT, { recursive: true });
const STATE = path.join(OUT, "state.json");
const SIX = [
  { key: "demolition", section: "Demolition", rate: 77 },
  { key: "wall_plaster", section: "Plaster", rate: 41.5 },
  { key: "floor_finish", section: "Floor Finishes", rate: 150 },
  { key: "wet_tiling", section: "Wall Finishes", rate: 210 },
  { key: "ceiling_finish", section: "Ceilings", rate: 99 },
  { key: "wall_paint", section: "Decoration & Painting", rate: 28 },
];
const SECTIONS = SIX.map((s) => s.section);
const FIRM_NAME = "U7 check — firm (scratch)";
const VILLA_NAME = "U7 check villa (scratch)";
const MUDON_PREFIX = "6b5fda9d";

const { url, key } = resolveTarget({ script: "element-sections-flag-check", writes: true });
const sb = createClient(url, key);
let failures = 0;
const check = (l, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${detail ? `  — ${detail}` : ""}`);
};
const sixOf = (boq) => boq.sections.filter((s) => SECTIONS.includes(s.work_section));
const p4Lines = (sections) => sections.flatMap((s) => s.lines).filter((l) => /^P4\/quantify\//.test(l.rule_id ?? ""));
const lineOf = (sections, s) => sections.find((x) => x.work_section === s.section)?.lines.find((l) => l.rule_id === `P4/quantify/${s.key}`);

async function findMudon() {
  const { data } = await sb.from("projects").select("id, name");
  return (data ?? []).find((p) => p.id.startsWith(MUDON_PREFIX)) ?? null;
}
/** A scratch interior villa from the plan fixture, under fresh ids. Never 6b5fda9d. */
async function seedScratchVilla() {
  const projectId = randomUUID();
  const planId = randomUUID();
  let r = await sb.from("projects").insert({ id: projectId, name: VILLA_NAME, city: "Dubai", currency: "AED", budget_aed: 850000, status: "draft" });
  if (r.error) throw new Error(`scratch project: ${r.error.message}`);
  r = await sb.from("plans").insert({ id: planId, project_id: projectId, scale: MUDON_FIXTURE.scale, total_area_m2: MUDON_FIXTURE.total_area_m2 });
  if (r.error) throw new Error(`scratch plan: ${r.error.message}`);
  r = await sb.from("rooms").insert(MUDON_FIXTURE.rooms.map((room) => ({ id: randomUUID(), plan_id: planId, name_en: room.name_en, name_ar: room.name_ar, room_type: room.room_type, area_m2: room.area_m2, polygon: room.polygon })));
  if (r.error) throw new Error(`scratch rooms: ${r.error.message}`);
  return { projectId, planId };
}
async function removeScratchVilla(projectId, planId) {
  await sb.from("takeoff_items").delete().eq("project_id", projectId);
  await sb.from("boqs").delete().eq("project_id", projectId);
  await sb.from("pilot_events").delete().eq("project_id", projectId);
  await sb.from("rooms").delete().eq("plan_id", planId);
  await sb.from("plans").delete().eq("id", planId);
  await sb.from("projects").delete().eq("id", projectId);
}

if (mode === "capture") {
  if (!["on", "off"].includes(label) || !port) throw new Error("usage: capture on|off <port>");
  const BASE = `http://localhost:${port}`;
  const me = await devSession("a", { script: "element-sections-flag-check" });
  const api = async (method, p, body, auth) => {
    const res = await fetch(`${BASE}${p}`, { method, headers: { "content-type": "application/json", ...(auth?.headers ?? {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const dryRun = async (projectId) => {
    const r = await api("POST", "/api/generate-boq", { project_id: projectId, dry_run: true }, me);
    if (r.status !== 200 || !r.body.boq) throw new Error(`dry run: ${r.status} ${r.body.error ?? ""}`);
    return r.body.boq;
  };
  console.log(`\ncapture ${label.toUpperCase()} on ${BASE}`);
  const snapshot = { label, port, mudon: null, demo: null };

  const mudon = await findMudon();
  if (mudon) {
    const boq = await dryRun(mudon.id);
    snapshot.mudon = { sections: sixOf(boq), grand_total_aed: boq.grand_total_aed };
    check("Mudon dry run (read-only) captured", true, `${p4Lines(snapshot.mudon.sections).length} take-off lines · AED ${boq.grand_total_aed}`);
  } else check("Mudon villa found on this database", false, "not found — that leg skipped");

  {
    // The scratch villa + firm persist between the two captures; compare removes them.
    let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
    if (!state) {
      const villa = await seedScratchVilla();
      const fa = await api("POST", "/api/firms", { name: FIRM_NAME }, me);
      check("scratch villa seeded from the plan fixture + scratch firm created", fa.status === 201, `${fa.status} ${fa.body.error ?? ""}`);
      for (const s of SIX) {
        const r = await api("POST", `/api/firms/${fa.body.firm.id}/rates`, { item_key: s.key, unit: "m2", rate_aed: s.rate, kind: "supply_and_install" }, me);
        if (r.status !== 201) check(`entry ${s.key}`, false, `${r.status} ${r.body.error ?? ""}`);
      }
      const asg = await api("PATCH", `/api/projects/${villa.projectId}`, { firm_id: fa.body.firm.id }, me);
      check("scratch villa assigned to the scratch firm", asg.status === 200, `${asg.status}`);
      state = { ...villa, firmId: fa.body.firm.id };
      fs.writeFileSync(STATE, JSON.stringify(state));
    } else check("scratch villa + firm reused from the earlier capture", true, state.projectId.slice(0, 8));
    const boq = await dryRun(state.projectId);
    snapshot.demo = { sections: sixOf(boq), grand_total_aed: boq.grand_total_aed, firm_id: state.firmId };
    for (const s of SIX) {
      const l = lineOf(snapshot.demo.sections, s);
      if (!l) {
        // The fixture plan proposes no demolition, so no element of that kind exists to price; compare asserts it is absent on BOTH sides.
        check(`${s.section}: ${s.key} — no element of this kind in the fixture plan (unit test covers the key)`, true);
        continue;
      }
      check(`${s.section}: ${s.key} at the firm's rate, tier 1`, l.rate_aed === s.rate && l.rate_tier === "firm_private", `${l.rate_aed} · ${l.rate_tier}`);
    }
  }

  fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(snapshot));
  console.log(`  saved ${path.join(OUT, `${label}.json`)}`);
} else if (mode === "compare") {
  const read = (l) => {
    const f = path.join(OUT, `${l}.json`);
    if (!fs.existsSync(f)) throw new Error(`missing capture ${l} — run: capture ${l} <port>`);
    return JSON.parse(fs.readFileSync(f, "utf8"));
  };
  const on = read("on");
  const off = read("off");
  console.log("\ncompare ON vs OFF");
  try {
    if (on.mudon && off.mudon) {
      check("Mudon: the six element sections are byte-identical ON vs OFF", JSON.stringify(on.mudon.sections) === JSON.stringify(off.mudon.sections));
      check("Mudon: both carry the element take-off lines (the mapping ran on both)", p4Lines(on.mudon.sections).length >= 4 && p4Lines(on.mudon.sections).length === p4Lines(off.mudon.sections).length, `${p4Lines(on.mudon.sections).length} / ${p4Lines(off.mudon.sections).length}`);
      check("Mudon: grand totals equal", on.mudon.grand_total_aed === off.mudon.grand_total_aed, `${on.mudon.grand_total_aed} / ${off.mudon.grand_total_aed}`);
    } else check("Mudon captured on both sides", false, "skipped on at least one side");
    if (on.demo && off.demo) {
      for (const s of SIX) {
        const a = lineOf(on.demo.sections, s);
        const b = lineOf(off.demo.sections, s);
        if (!a && !b) {
          check(`${s.section}: ${s.key} — no element of this kind in the fixture on either side (unit test covers the key)`, true);
          continue;
        }
        check(`${s.section}: ${s.key} identical ON vs OFF (rate ${s.rate}, tier 1, same total)`, !!a && !!b && a.rate_aed === b.rate_aed && a.rate_tier === "firm_private" && b.rate_tier === "firm_private" && a.total_aed === b.total_aed && a.quantity === b.quantity, `${a?.rate_aed}/${a?.rate_tier}/${a?.total_aed} vs ${b?.rate_aed}/${b?.rate_tier}/${b?.total_aed}`);
      }
      check("scratch villa: the six sections are byte-identical ON vs OFF with the firm's rates", JSON.stringify(on.demo.sections) === JSON.stringify(off.demo.sections));
    } else check("scratch villa captured on both sides", false, "skipped on at least one side");
  } finally {
    console.log("\ncleanup");
    if (fs.existsSync(STATE)) {
      const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
      await removeScratchVilla(state.projectId, state.planId);
      fs.unlinkSync(STATE);
    }
    const { data: firm } = await sb.from("firms").select("id").eq("name", FIRM_NAME).maybeSingle();
    if (firm) {
      await sb.from("pilot_events").delete().eq("firm_id", firm.id);
      await sb.from("firms").delete().eq("id", firm.id);
    }
    for (const l of ["on", "off"]) if (fs.existsSync(path.join(OUT, `${l}.json`))) fs.unlinkSync(path.join(OUT, `${l}.json`));
    const { data: leftVilla } = await sb.from("projects").select("id").eq("name", VILLA_NAME);
    check("scratch villa and firm removed, captures deleted", !(await sb.from("firms").select("id").eq("name", FIRM_NAME).maybeSingle()).data && (leftVilla ?? []).length === 0);
  }
} else {
  throw new Error("usage: capture on|off <port> | compare");
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
