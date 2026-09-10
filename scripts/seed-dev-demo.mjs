#!/usr/bin/env node
// =============================================================================
// scripts/seed-dev-demo.mjs — a usable demo project for a DEV database (I8).
//
// Run: node scripts/seed-dev-demo.mjs
//
// WHAT THIS DELIBERATELY DOES NOT COPY
//
// The I8 proposal recommended exporting the Mudon rows and re-importing them
// into dev under the same id. That is not what this does, and the deviation is
// the point: those rows carry real commercial data — Atrium, Global Creation,
// Laspinas and RAK quotations, contract totals, discount percentages — held
// under a client relationship. A development database is the one people point
// throwaway branches at, hand to a contractor to debug, and forget to lock
// down. Ground-truth commercial data stays in production.
//
// So the geometry is real (it is the plan fixture already committed for tests,
// which carries no prices) and everything commercial is absent. Dev gets a
// project it can parse, render and cost; it does not get anybody's quotation.
//
// The project id matches the canonical fixture id so that scripts and tests
// with the id hard-coded keep working. An id is not commercial data. The NAME
// says "dev" so nobody mistakes this row for the real record.
// =============================================================================

import { MUDON_FIXTURE } from "../lib/plan/__tests__/mudon.fixture.ts";
import { resolveTarget } from "./_target-guard.mjs";

const { url, key } = resolveTarget({ script: "seed-dev-demo", writes: true });
const H = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const api = async (p, init = {}) => {
  const r = await fetch(`${url}/rest/v1/${p}`, { headers: H, ...init });
  const t = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${p} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

const PROJECT_ID = MUDON_FIXTURE.projectId;
const PLAN_ID = MUDON_FIXTURE.planId;

async function main() {
  console.log(`\nseeding demo project ${PROJECT_ID.slice(0, 8)}…`);

  // --- project ---------------------------------------------------------------
  await api("projects?on_conflict=id", {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      {
        id: PROJECT_ID,
        name: "Demo villa (dev)",
        city: "Dubai",
        currency: "AED",
        budget_aed: 850000,
        status: "draft",
      },
    ]),
  });
  console.log("  projects        1");

  // --- plan ------------------------------------------------------------------
  await api("plans?on_conflict=id", {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      // NB: `plans` has no status column — id, project_id, pdf_url,
      // parsed_json, total_area_m2, scale, created_at, plus notes (002) and the
      // overlap columns (029). Writing one that does not exist fails the whole
      // insert with PGRST204.
      {
        id: PLAN_ID,
        project_id: PROJECT_ID,
        scale: MUDON_FIXTURE.scale,
        total_area_m2: MUDON_FIXTURE.total_area_m2,
      },
    ]),
  });
  console.log("  plans           1");

  // --- rooms -----------------------------------------------------------------
  // Deterministic uuids from the fixture's slug ids, so re-running is idempotent
  // and the same room keeps the same id across seeds.
  const uuidFor = (slug) => {
    const h = [...slug].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(16);
    const pad = (h + h + h + h + h + h + h + h).slice(0, 32);
    return `${pad.slice(0, 8)}-${pad.slice(8, 12)}-4${pad.slice(13, 16)}-a${pad.slice(17, 20)}-${pad.slice(20, 32)}`;
  };

  const rooms = MUDON_FIXTURE.rooms.map((r) => ({
    id: uuidFor(r.id),
    plan_id: PLAN_ID,
    name_en: r.name_en,
    name_ar: r.name_ar,
    room_type: r.room_type,
    area_m2: r.area_m2,
    polygon: r.polygon,
  }));

  await api("rooms?on_conflict=id", {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rooms),
  });
  console.log(`  rooms          ${String(rooms.length).padStart(2)}`);

  console.log(
    `\ndone. NOT seeded, by design: renders, room photos, BoQs, takeoff items,\n` +
      `rate_book actual_transaction rates, boq_outcomes, moodboard items —\n` +
      `everything carrying a real quotation or a client's commercial terms.\n` +
      `Run the catalogue seeds for prices:\n` +
      `  node --import ./scripts/_alias-hook.mjs scripts/seed-labour-rates.ts\n` +
      `  node --import ./scripts/_alias-hook.mjs scripts/seed-pricing.ts\n` +
      `  node --import ./scripts/_alias-hook.mjs scripts/seed-rate-book.ts\n` +
      `  node --import ./scripts/_alias-hook.mjs scripts/seed-accessory-catalog.ts\n\n` +
      `Do NOT run seed-rate-book-actuals.ts against dev — that is the Mudon\n` +
      `contract data this script exists to keep out.\n`,
  );
}

main().catch((e) => {
  console.error(`\nseed-dev-demo failed: ${e.message}`);
  process.exit(1);
});
