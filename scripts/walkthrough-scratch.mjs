#!/usr/bin/env node
// =============================================================================
// scripts/walkthrough-scratch.mjs — the onboarding walkthrough's scratch state (UV).
//
//   node --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/walkthrough-scratch.mjs seed
//     a FRESH dev account (dev-scripts+walkthrough@rennovaite.local — created if
//     absent; a real Supabase user, signed in through the magic-link flow, not a
//     bypass) and a FRESH interior villa seeded from the plan fixture under a new
//     id ("Walkthrough villa (scratch)"). Prints the villa id and writes the
//     session cookie to <TEMP>/walkthrough/cookie.txt for the browser pane.
//   … teardown
//     removes everything the walkthrough made: the firm the account created (by
//     name prefix "Walkthrough"), its logo object, memberships, entries, quotes,
//     the villa (rooms, plan, BoQs, take-off, approvals, acceptances, corrections,
//     pack exports + their stored outputs, pilot events), the account's other
//     events, and the ACCOUNT itself. Then `verify` runs.
//   … verify
//     asserts nothing remains: no firm, no villa, no user, no orphan rows.
// Refuses production (scripts/_target-guard.mjs).
// =============================================================================

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { MUDON_FIXTURE } from "../lib/plan/__tests__/mudon.fixture.ts";
import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const [mode] = process.argv.slice(2);
const OUT = path.join(process.env.TEMP ?? process.env.TMP ?? ".", "walkthrough");
fs.mkdirSync(OUT, { recursive: true });
const STATE = path.join(OUT, "state.json");
const EMAIL = "dev-scripts+walkthrough@rennovaite.local";
const VILLA = "Walkthrough villa (scratch)";
const FIRM_PREFIX = "Walkthrough";

const { url, key } = resolveTarget({ script: "walkthrough-scratch", writes: true });
const sb = createClient(url, key);
let failures = 0;
const check = (l, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${detail ? `  — ${detail}` : ""}`);
};

async function findUser() {
  const { data } = await sb.auth.admin.listUsers({ perPage: 1000 });
  return (data?.users ?? []).find((u) => u.email === EMAIL) ?? null;
}

if (mode === "seed") {
  const me = await devSession("walkthrough", { script: "walkthrough-scratch" });
  fs.writeFileSync(path.join(OUT, "cookie.txt"), me.cookies.map((c) => `${c.name}=${c.value}`).join("; "));
  fs.writeFileSync(path.join(OUT, "bearer.txt"), me.token);
  const projectId = randomUUID();
  const planId = randomUUID();
  let r = await sb.from("projects").insert({ id: projectId, name: VILLA, city: "Dubai", currency: "AED", budget_aed: 850000, status: "draft" });
  // H5: the account the walkthrough drives owns its villa (removed with it on teardown).
  if (!r.error) r = await sb.from("project_members").insert({ project_id: projectId, user_id: me.userId });
  if (r.error) throw new Error(`villa: ${r.error.message}`);
  r = await sb.from("plans").insert({ id: planId, project_id: projectId, scale: MUDON_FIXTURE.scale, total_area_m2: MUDON_FIXTURE.total_area_m2 });
  if (r.error) throw new Error(`plan: ${r.error.message}`);
  r = await sb.from("rooms").insert(MUDON_FIXTURE.rooms.map((room) => ({ id: randomUUID(), plan_id: planId, name_en: room.name_en, name_ar: room.name_ar, room_type: room.room_type, area_m2: room.area_m2, polygon: room.polygon })));
  if (r.error) throw new Error(`rooms: ${r.error.message}`);
  fs.writeFileSync(STATE, JSON.stringify({ projectId, planId, userId: me.userId, email: me.email, seededAt: new Date().toISOString() }));
  console.log(JSON.stringify({ user: me.email, user_id: me.userId, project_id: projectId, plan_id: planId, cookie_file: path.join(OUT, "cookie.txt") }, null, 2));
} else if (mode === "teardown" || mode === "verify") {
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
  const user = await findUser();
  if (mode === "teardown") {
    console.log("\nteardown");
    // Firms the walkthrough account created (name prefix), with everything hanging off them.
    const { data: firms } = await sb.from("firms").select("id, name, logo_path").like("name", `${FIRM_PREFIX}%`);
    for (const f of firms ?? []) {
      if (f.logo_path) await sb.storage.from("plan-uploads").remove([f.logo_path]);
      await sb.from("pilot_events").delete().eq("firm_id", f.id);
      await sb.from("firms").delete().eq("id", f.id); // cascades book, entries, members, quotes, acceptances
      console.log(`  firm removed: ${f.name}`);
    }
    // The villa and everything that references it.
    const { data: villas } = await sb.from("projects").select("id").eq("name", VILLA);
    for (const v of villas ?? []) {
      const { data: jobs } = await sb.from("pack_exports").select("id").eq("project_id", v.id);
      for (const j of jobs ?? []) {
        const { data: objs } = await sb.storage.from("packs").list(`projects/${v.id}/${j.id}`);
        if (objs?.length) await sb.storage.from("packs").remove(objs.map((o) => `projects/${v.id}/${j.id}/${o.name}`));
      }
      for (const t of ["pack_exports", "reference_basis_acceptances", "boq_approvals", "boq_corrections", "takeoff_items", "boqs", "pilot_events", "project_assets", "renders"]) await sb.from(t).delete().eq("project_id", v.id);
      const { data: plans } = await sb.from("plans").select("id").eq("project_id", v.id);
      for (const p of plans ?? []) await sb.from("rooms").delete().eq("plan_id", p.id);
      await sb.from("plans").delete().eq("project_id", v.id);
      await sb.from("projects").delete().eq("id", v.id);
      console.log(`  villa removed: ${v.id.slice(0, 8)}`);
    }
    if (user) {
      await sb.from("pilot_events").delete().eq("actor", user.id);
      await sb.from("firm_members").delete().eq("user_id", user.id);
      const { error } = await sb.auth.admin.deleteUser(user.id);
      console.log(`  account removed: ${EMAIL}${error ? ` (${error.message})` : ""}`);
    }
    if (fs.existsSync(STATE)) fs.unlinkSync(STATE);
    for (const f of ["cookie.txt", "bearer.txt"]) if (fs.existsSync(path.join(OUT, f))) fs.unlinkSync(path.join(OUT, f));
  }
  console.log("\nverify — nothing remains");
  const again = await findUser();
  check("account gone", !again);
  check("no firm with the walkthrough prefix", ((await sb.from("firms").select("id").like("name", `${FIRM_PREFIX}%`)).data ?? []).length === 0);
  check("no walkthrough villa", ((await sb.from("projects").select("id").eq("name", VILLA)).data ?? []).length === 0);
  if (state?.projectId) {
    for (const t of ["boqs", "pack_exports", "pilot_events", "takeoff_items", "boq_corrections"]) {
      check(`no ${t} rows for the villa`, ((await sb.from(t).select("id").eq("project_id", state.projectId)).data ?? []).length === 0);
    }
  }
  if (state?.userId) {
    check("no events by the account", ((await sb.from("pilot_events").select("id").eq("actor", state.userId)).data ?? []).length === 0);
    check("no memberships for the account", ((await sb.from("firm_members").select("firm_id").eq("user_id", state.userId)).data ?? []).length === 0);
  }
  console.log(failures === 0 ? "\nREVERSIBLE — nothing of the walkthrough remains" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
} else {
  throw new Error("usage: seed | teardown | verify");
}
