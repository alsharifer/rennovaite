#!/usr/bin/env node
// =============================================================================
// scripts/project-isolation-sweep.mjs — can a second account touch a first
// account's project, by ANY route? (H5)
//
//   node scripts/project-isolation-sweep.mjs [port]      (a `pack` dev server)
//
// Two fresh dev accounts (scripts/lib/dev-auth.mjs): OWNER and INTRUDER. Each
// creates a project through the real routes (draw-plan — which also proves
// that creating a project makes you its member), the owner's is given one of
// everything a request can reference (plan, room, fixture, element, opening,
// context footprint, moodboard item, asset, render, BoQ, pack job). Then:
//
//   1. every project-scoped handler — derived from the filesystem; a handler
//      with no template here FAILS the sweep — called by the INTRUDER with the
//      owner's ids → 403 not_a_project_member. A 400 means the request never
//      reached the check (a broken template), and fails too;
//   2. mixed references: the intruder names THEIR OWN project beside the
//      owner's room / render / asset / BoQ → 403;
//   3. every project page as the intruder → 404; the intruder's dashboard does
//      not list the owner's project;
//   4. nothing the owner has changed: every owner row is byte-identical after;
//   5. control: the owner reads the same routes (200).
//
// Scratch only: both projects, their storage objects and events are removed.
// Refuses production (scripts/_target-guard.mjs).
// =============================================================================

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const ROOT = process.cwd();
const { url, key } = resolveTarget({ script: "project-isolation-sweep", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

// Mirrors lib/auth/access.ts — literal, so the sweep does not trust the list it checks.
const PUBLIC = new Set(["app/api/health/route.ts"]);
const NON_PROJECT = (f) => f.startsWith("app/api/firms/") || f === "app/api/rate-vocabulary/route.ts";
const CREATES = new Set(["app/api/upload/route.ts|POST", "app/api/draw-plan/route.ts|POST"]);

let failures = 0;
const out = [];
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  out.push(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

async function call(who, { method, path: p, body, form }) {
  const headers = { ...who.headers };
  let payload;
  if (form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.append(k, v);
    payload = fd;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + p, { method, headers, body: payload, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, body: json, text };
}

const PNG = new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")], { type: "image/png" });
const sq = (x, y, s = 0.3) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

// --- templates: one per project-scoped handler ------------------------------------
// `o` = the target project's ids (the owner's, for the intruder), `m` = the
// intruder's own (for mixed-reference attacks).
const T = {
  "app/api/accessories/route.ts|GET": (o) => ({ method: "GET", path: `/api/accessories?project_id=${o.P}` }),
  "app/api/accessories/route.ts|POST": (o) => ({ method: "POST", path: "/api/accessories", body: { project_id: o.P, item_key: "san.towel_rail", catalog_item_id: randomUUID() } }),
  "app/api/accessories/route.ts|DELETE": (o) => ({ method: "DELETE", path: `/api/accessories?project_id=${o.P}&item_key=san.towel_rail` }),
  "app/api/approve-design/route.ts|POST": (o) => ({ method: "POST", path: "/api/approve-design", body: { project_id: o.P, room_id: o.R, render_id: o.RD } }),
  "app/api/boq-corrections/route.ts|POST": (o) => ({ method: "POST", path: "/api/boq-corrections", body: { project_id: o.P, boq_id: o.BQ, line_description: "iso", correction_type: "rate", new_value: 1 } }),
  "app/api/boq-corrections/route.ts|GET": (o) => ({ method: "GET", path: `/api/boq-corrections?project_id=${o.P}` }),
  "app/api/correct-plan/route.ts|POST": (o) => ({ method: "POST", path: "/api/correct-plan", body: { plan_id: o.PL, notes: "iso" } }),
  "app/api/debug/feedback-summary/route.ts|GET": (o) => ({ method: "GET", path: `/api/debug/feedback-summary?project_id=${o.P}` }),
  "app/api/draw-plan/route.ts|PATCH": (o) => ({ method: "PATCH", path: "/api/draw-plan", body: { plan_id: o.PL, plot_width_m: 12, plot_depth_m: 9 } }),
  "app/api/feedback/route.ts|POST": (o) => ({ method: "POST", path: "/api/feedback", body: { project_id: o.P, entity_type: "plan", entity_id: o.PL, action: "edited" } }),
  "app/api/furniture-opt-in/route.ts|POST": (o) => ({ method: "POST", path: "/api/furniture-opt-in", body: { project_id: o.P, room_id: o.R } }),
  "app/api/generate-boq/route.ts|POST": (o) => ({ method: "POST", path: "/api/generate-boq", body: { project_id: o.P, dry_run: true } }),
  "app/api/moodboard/route.ts|GET": (o) => ({ method: "GET", path: `/api/moodboard?project_id=${o.P}` }),
  "app/api/moodboard/route.ts|POST": (o) => ({ method: "POST", path: "/api/moodboard", body: { kind: "style", project_id: o.P, style_key: "scandi-arabic", style_room: "living" } }),
  "app/api/moodboard/route.ts|PATCH": (o) => ({ method: "PATCH", path: "/api/moodboard", body: { project_id: o.P, id: o.MB, to_index: 0 } }),
  "app/api/moodboard/route.ts|DELETE": (o) => ({ method: "DELETE", path: `/api/moodboard?id=${o.MB}` }),
  "app/api/parse-metrics/route.ts|POST": (o) => ({ method: "POST", path: "/api/parse-metrics", body: { plan_id: o.PL } }),
  "app/api/parse-plan/route.ts|POST": (o) => ({ method: "POST", path: "/api/parse-plan", body: { plan_id: o.PL } }),
  "app/api/pilot-events/route.ts|POST": (o) => ({ method: "POST", path: "/api/pilot-events", body: { kind: "friction", project_id: o.P, note: "isolation sweep" } }),
  "app/api/pilot-events/route.ts|GET": (o) => ({ method: "GET", path: `/api/pilot-events?project_id=${o.P}` }),
  "app/api/plan-context/route.ts|GET": (o) => ({ method: "GET", path: `/api/plan-context?plan_id=${o.PL}` }),
  "app/api/plan-context/route.ts|POST": (o) => ({ method: "POST", path: "/api/plan-context", body: { plan_id: o.PL, kind: "boundary_wall", polygon: sq(0, 0.9, 0.05) } }),
  "app/api/plan-context/route.ts|PATCH": (o) => ({ method: "PATCH", path: "/api/plan-context", body: { id: o.CX, name: "iso" } }),
  "app/api/plan-context/route.ts|DELETE": (o) => ({ method: "DELETE", path: `/api/plan-context?id=${o.CX}` }),
  "app/api/plan-elements/route.ts|GET": (o) => ({ method: "GET", path: `/api/plan-elements?plan_id=${o.PL}` }),
  "app/api/plan-elements/route.ts|POST": (o) => ({ method: "POST", path: "/api/plan-elements", body: { plan_id: o.PL, kind: "boundary_wall", polyline: [[0, 0], [0.4, 0]] } }),
  "app/api/plan-elements/route.ts|PATCH": (o) => ({ method: "PATCH", path: "/api/plan-elements", body: { id: o.EL, height_mm: 1800 } }),
  "app/api/plan-elements/route.ts|DELETE": (o) => ({ method: "DELETE", path: `/api/plan-elements?id=${o.EL}` }),
  "app/api/plan-fixtures/route.ts|GET": (o) => ({ method: "GET", path: `/api/plan-fixtures?project_id=${o.P}` }),
  "app/api/plan-fixtures/route.ts|POST": (o) => ({ method: "POST", path: "/api/plan-fixtures", body: { project_id: o.P, type: "socket_13a", position: [0.1, 0.1], id: o.FX } }),
  "app/api/plan-fixtures/route.ts|DELETE": (o) => ({ method: "DELETE", path: `/api/plan-fixtures?id=${o.FX}` }),
  "app/api/plan-openings/route.ts|GET": (o) => ({ method: "GET", path: `/api/plan-openings?plan_id=${o.PL}` }),
  "app/api/plan-openings/route.ts|POST": (o) => ({ method: "POST", path: "/api/plan-openings", body: { plan_id: o.PL, kind: "door", position: [0.2, 0.2] } }),
  "app/api/plan-openings/route.ts|PATCH": (o) => ({ method: "PATCH", path: "/api/plan-openings", body: { id: o.OP, width_mm: 900 } }),
  "app/api/plan-openings/route.ts|DELETE": (o) => ({ method: "DELETE", path: `/api/plan-openings?id=${o.OP}` }),
  "app/api/plan-zones/route.ts|PATCH": (o) => ({ method: "PATCH", path: "/api/plan-zones", body: { id: o.R, level_mm: 150 } }),
  "app/api/project-asset/route.ts|POST": (o) => ({ method: "POST", path: "/api/project-asset", form: { project_id: o.P, kind: "photo", file: new File([PNG], "iso.png", { type: "image/png" }) } }),
  "app/api/project-asset/route.ts|PATCH": (o) => ({ method: "PATCH", path: "/api/project-asset", body: { asset_id: o.AS, room_id: o.R } }),
  "app/api/project-brief/route.ts|GET": (o) => ({ method: "GET", path: `/api/project-brief?project_id=${o.P}` }),
  "app/api/project-brief/route.ts|POST": (o) => ({ method: "POST", path: "/api/project-brief", body: { project_id: o.P, answers: {} } }),
  "app/api/projects/[id]/boq-approvals/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/boq-approvals` }),
  "app/api/projects/[id]/boq-approvals/route.ts|POST": (o) => ({ method: "POST", path: `/api/projects/${o.P}/boq-approvals`, body: { boq_id: o.BQ, kind: "firm" } }),
  "app/api/projects/[id]/boq-diff/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/boq-diff?from=${o.BQ}&to=${o.BQ}` }),
  "app/api/projects/[id]/boq-pdf/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/boq-pdf?format=json` }),
  "app/api/projects/[id]/boq-refs/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/boq-refs` }),
  "app/api/projects/[id]/boq-revisions/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/boq-revisions` }),
  "app/api/projects/[id]/drawings/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/drawings` }),
  "app/api/projects/[id]/pack-export/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/pack-export` }),
  "app/api/projects/[id]/pack-export/route.ts|POST": (o) => ({ method: "POST", path: `/api/projects/${o.P}/pack-export`, body: { renders: "cached" } }),
  "app/api/projects/[id]/pack-export/[jobId]/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/pack-export/${o.JOB}` }),
  "app/api/projects/[id]/parity/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/parity` }),
  "app/api/projects/[id]/proposal/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/proposal?format=json` }),
  "app/api/projects/[id]/reference-basis/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/reference-basis` }),
  "app/api/projects/[id]/reference-basis/route.ts|POST": (o) => ({ method: "POST", path: `/api/projects/${o.P}/reference-basis`, body: { boq_id: o.BQ } }),
  "app/api/projects/[id]/render-pack/route.ts|GET": (o) => ({ method: "GET", path: `/api/projects/${o.P}/render-pack?format=json` }),
  "app/api/projects/[id]/route.ts|PATCH": (o) => ({ method: "PATCH", path: `/api/projects/${o.P}`, body: { display_name: "hijacked" } }),
  "app/api/projects/[id]/route.ts|DELETE": (o) => ({ method: "DELETE", path: `/api/projects/${o.P}` }),
  "app/api/render-iterate/route.ts|POST": (o) => ({ method: "POST", path: "/api/render-iterate", body: { project_id: o.P, room_id: o.R, parent_render_id: o.RD, tweak: "iso" } }),
  "app/api/render/batch/route.ts|POST": (o) => ({ method: "POST", path: "/api/render/batch", body: { project_id: o.P } }),
  "app/api/render/consistency/route.ts|POST": (o) => ({ method: "POST", path: "/api/render/consistency", body: { project_id: o.P, anchor_render_id: o.RD } }),
  "app/api/render/evening/route.ts|POST": (o) => ({ method: "POST", path: "/api/render/evening", body: { project_id: o.P, room_id: o.R } }),
  "app/api/render/photo-pair/route.ts|POST": (o) => ({ method: "POST", path: "/api/render/photo-pair", body: { project_id: o.P, asset_id: o.AS, zone_id: o.R, cache_only: true } }),
  "app/api/render/photo-pair/route.ts|GET": (o) => ({ method: "GET", path: `/api/render/photo-pair?project_id=${o.P}` }),
  "app/api/render/route.ts|POST": (o) => ({ method: "POST", path: "/api/render", body: { project_id: o.P, room_id: o.R } }),
  "app/api/render/scene/route.ts|GET": (o) => ({ method: "GET", path: `/api/render/scene?project_id=${o.P}` }),
  "app/api/render/scene/route.ts|POST": (o) => ({ method: "POST", path: "/api/render/scene", body: { project_id: o.P, camera_id: "zone:iso", view: "day", cache_only: true } }),
  "app/api/render/status/route.ts|GET": (o) => ({ method: "GET", path: `/api/render/status?prediction_id=${o.PRED}` }),
  "app/api/room-photo/route.ts|POST": (o) => ({ method: "POST", path: "/api/room-photo", form: { room_id: o.R, file: new File([PNG], "iso.png", { type: "image/png" }) } }),
  "app/api/style-choice/route.ts|POST": (o) => ({ method: "POST", path: "/api/style-choice", body: { project_id: o.P, style_key: "desert-modern" } }),
  "app/api/update-plan/route.ts|POST": (o) => ({ method: "POST", path: "/api/update-plan", body: { plan_id: o.PL, rooms: [] } }),
  "app/api/vendor-options/route.ts|POST": (o) => ({ method: "POST", path: "/api/vendor-options", body: { boq_id: o.BQ } }),
  "app/api/vendor-selections/route.ts|POST": (o) => ({ method: "POST", path: "/api/vendor-selections", body: { project_id: o.P, boq_id: o.BQ, boq_line_id: "x", sku_id: randomUUID() } }),
  "app/api/vendor-selections/route.ts|GET": (o) => ({ method: "GET", path: `/api/vendor-selections?project_id=${o.P}&boq_id=${o.BQ}` }),
  "app/api/whatif-scenario/route.ts|POST": (o) => ({ method: "POST", path: "/api/whatif-scenario", body: { project_id: o.P, selections: {}, total: 1 } }),
};

// Mixed references: the intruder's OWN project beside the owner's objects.
const MIXED = [
  ["approve-design: own project + owner's room & render", (o, m) => ({ method: "POST", path: "/api/approve-design", body: { project_id: m.P, room_id: o.R, render_id: o.RD } })],
  ["render: own project + owner's room", (o, m) => ({ method: "POST", path: "/api/render", body: { project_id: m.P, room_id: o.R } })],
  ["render-iterate: own project + owner's render", (o, m) => ({ method: "POST", path: "/api/render-iterate", body: { project_id: m.P, room_id: m.R, parent_render_id: o.RD, tweak: "x" } })],
  ["moodboard: own project + owner's asset", (o, m) => ({ method: "POST", path: "/api/moodboard", body: { kind: "asset", project_id: m.P, asset_id: o.AS } })],
  ["project-asset: owner's asset → own room", (o, m) => ({ method: "PATCH", path: "/api/project-asset", body: { asset_id: o.AS, room_id: m.R } })],
  ["project-asset: own asset → owner's room", (o, m) => ({ method: "PATCH", path: "/api/project-asset", body: { asset_id: m.AS, room_id: o.R } })],
  ["vendor-selections: own project + owner's BoQ", (o, m) => ({ method: "POST", path: "/api/vendor-selections", body: { project_id: m.P, boq_id: o.BQ, boq_line_id: "x", sku_id: randomUUID() } })],
  ["boq-corrections: own project + owner's BoQ", (o, m) => ({ method: "POST", path: "/api/boq-corrections", body: { project_id: m.P, boq_id: o.BQ, line_description: "x", correction_type: "rate" } })],
  ["plan-elements: own plan + owner's room", (o, m) => ({ method: "POST", path: "/api/plan-elements", body: { plan_id: m.PL, room_id: o.R, kind: "boundary_wall", polyline: [[0, 0], [0.3, 0]] } })],
  ["plan-fixtures: own project + owner's fixture id", (o, m) => ({ method: "POST", path: "/api/plan-fixtures", body: { project_id: m.P, id: o.FX, type: "socket_13a", position: [0.1, 0.1] } })],
  ["photo-pair: own project + owner's asset & zone", (o, m) => ({ method: "POST", path: "/api/render/photo-pair", body: { project_id: m.P, asset_id: o.AS, zone_id: o.R, cache_only: true } })],
  ["consistency: own project + owner's render", (o, m) => ({ method: "POST", path: "/api/render/consistency", body: { project_id: m.P, anchor_render_id: o.RD } })],
  ["feedback: own project + owner's render", (o, m) => ({ method: "POST", path: "/api/feedback", body: { project_id: m.P, entity_type: "render", entity_id: o.RD, action: "accepted" } })],
];

const PAGES = ["", "/boq", "/boq/revisions", "/plan", "/render", "/drawings", "/viewer", "/vendors", "/moodboard", "/ideation", "/style", "/timeline", "/accessories"];

// --- setup --------------------------------------------------------------------------
async function makeProject(who, name) {
  const created = await call(who, { method: "POST", path: "/api/draw-plan", body: { name, plot_width_m: 12, plot_depth_m: 9 } });
  if (created.status !== 200 && created.status !== 201) throw new Error(`draw-plan: ${created.status} ${created.text.slice(0, 200)}`);
  const P = created.body.project_id, PL = created.body.plan_id;
  const R = randomUUID();
  const up = await call(who, { method: "POST", path: "/api/update-plan", body: { plan_id: PL, rooms: [{ id: R, name_en: "Lawn", name_ar: null, room_type: "artificial_grass", area_m2: 20, polygon: sq(0.1, 0.1, 0.4) }] } });
  if (up.status !== 200) throw new Error(`update-plan: ${up.status} ${up.text.slice(0, 200)}`);
  const fx = await call(who, { method: "POST", path: "/api/plan-fixtures", body: { project_id: P, type: "socket_13a", position: [0.2, 0.2] } });
  const el = await call(who, { method: "POST", path: "/api/plan-elements", body: { plan_id: PL, kind: "boundary_wall", polyline: [[0, 0], [1, 0]] } });
  const op = await call(who, { method: "POST", path: "/api/plan-openings", body: { plan_id: PL, kind: "door", position: [0.3, 0.1] } });
  const cx = await call(who, { method: "POST", path: "/api/plan-context", body: { plan_id: PL, kind: "boundary_wall", polygon: sq(0, 0.95, 0.04) } });
  const mb = await call(who, { method: "POST", path: "/api/moodboard", body: { kind: "style", project_id: P, style_key: "scandi-arabic", style_room: "living" } });
  const as = await call(who, { method: "POST", path: "/api/project-asset", form: { project_id: P, kind: "photo", file: new File([PNG], "seed.png", { type: "image/png" }) } });
  const pick = (r, ...keys) => { for (const k of keys) { const v = k.split(".").reduce((x, y) => x?.[y], r.body); if (v) return v; } throw new Error(`seed ${keys[0]}: ${r.status} ${r.text.slice(0, 160)}`); };
  const ids = {
    P, PL, R,
    FX: pick(fx, "fixture.id", "id"),
    EL: pick(el, "element.id", "id"),
    OP: pick(op, "opening.id", "id"),
    CX: pick(cx, "context.id", "id"),
    MB: pick(mb, "item.id", "items.0.id"),
    AS: pick(as, "asset_id", "asset.id", "id"),
  };
  // No route creates these cheaply — a render row, a BoQ revision and a pack job, as the service role.
  ids.PRED = `iso-${randomUUID()}`;
  const rd = await sb.from("renders").insert({ project_id: P, room_id: R, status: "succeeded", prompt: "isolation sweep", prediction_id: ids.PRED }).select("id").single();
  if (rd.error) throw new Error(`render seed: ${rd.error.message}`);
  ids.RD = rd.data.id;
  const bq = await sb.from("boqs").insert({ project_id: P, total_aed: 0, sections: { sections: [], subtotal_aed: 0, contingency_pct: 0, contingency_aed: 0, vat_pct: 0, vat_aed: 0, grand_total_aed: 0 } }).select("id").single();
  if (bq.error) throw new Error(`boq seed: ${bq.error.message}`);
  ids.BQ = bq.data.id;
  const job = await sb.from("pack_exports").insert({ project_id: P, source: "cli", status: "running", options: { stage: "verification", purpose: "project-isolation-sweep" }, started_at: new Date().toISOString() }).select("id").single();
  if (job.error) throw new Error(`job seed: ${job.error.message}`);
  ids.JOB = job.data.id;
  return ids;
}

const OWNED_TABLES = [
  ["projects", "id"], ["plans", "project_id"], ["plan_fixtures", "project_id"], ["moodboard_items", "project_id"], ["project_assets", "project_id"],
  ["renders", "project_id"], ["boqs", "project_id"], ["project_briefs", "project_id"], ["style_choices", "project_id"], ["accessory_selections", "project_id"],
  ["vendor_selections", "project_id"], ["furniture_opt_ins", "project_id"], ["approved_designs", "project_id"], ["boq_corrections", "project_id"],
  ["boq_approvals", "project_id"], ["reference_basis_acceptances", "project_id"], ["pack_exports", "project_id"], ["pilot_events", "project_id"], ["feedback_events", "project_id"], ["project_members", "project_id"],
];
async function snapshot(o) {
  const snap = {};
  for (const [t, col] of OWNED_TABLES) snap[t] = JSON.stringify((await sb.from(t).select("*").eq(col, o.P).order(col)).data ?? []);
  for (const [t, col, id] of [["rooms", "plan_id", o.PL], ["plan_elements", "plan_id", o.PL], ["plan_openings", "plan_id", o.PL], ["plan_context", "plan_id", o.PL]]) snap[t] = JSON.stringify((await sb.from(t).select("*").eq(col, id).order("id")).data ?? []);
  return snap;
}

function walk(dir, name, acc = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, name, acc);
    else if (n === name) acc.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return acc;
}

// --- run --------------------------------------------------------------------------------
const owner = await devSession("iso-owner", { script: "project-isolation-sweep" });
const intruder = await devSession("iso-intruder", { script: "project-isolation-sweep" });
const t0 = new Date().toISOString();
let o = null, m = null;
try {
  console.log("setup: each account creates a project through the routes");
  o = await makeProject(owner, "Isolation sweep — owner (scratch)");
  m = await makeProject(intruder, "Isolation sweep — intruder (scratch)");
  const memberOf = async (P, who) => !!(await sb.from("project_members").select("project_id").eq("project_id", P).eq("user_id", who.userId).maybeSingle()).data;
  check("creating a project made its creator a member — and nobody else", (await memberOf(o.P, owner)) && !(await memberOf(o.P, intruder)) && (await memberOf(m.P, intruder)) && !(await memberOf(m.P, owner)));

  const before = await snapshot(o);

  // 1. every project-scoped handler, as the intruder
  const handlers = [];
  for (const f of walk(path.join(ROOT, "app/api"), "route.ts").sort()) {
    if (PUBLIC.has(f) || NON_PROJECT(f)) continue;
    for (const mm of fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/^export async function (GET|POST|PUT|PATCH|DELETE)\(/gm)) handlers.push(`${f}|${mm[1]}`);
  }
  let refused = 0;
  for (const h of handlers) {
    if (CREATES.has(h)) continue;
    const tpl = T[h];
    if (!tpl) { check(`${h}: has a sweep template`, false, "add one — every project handler is swept"); continue; }
    const r = await call(intruder, tpl(o, m));
    const ok = r.status === 403 && r.body?.code === "not_a_project_member";
    if (ok) refused++;
    check(`intruder → ${h.replace("app/api", "").replace("/route.ts", "")}`, ok, ok ? "" : `${r.status} ${(r.body?.code ?? r.text).toString().slice(0, 120)}`);
  }
  const swept = handlers.filter((h) => !CREATES.has(h)).length;
  check(`every project-scoped handler refused the intruder (${refused}/${swept})`, refused === swept);

  // 2. mixed references
  for (const [label, mk] of MIXED) {
    const r = await call(intruder, mk(o, m));
    check(`mixed — ${label} → 403`, r.status === 403, `${r.status} ${(r.body?.code ?? "").toString()}`);
  }

  // 3. pages + dashboard
  const cookie = (who) => ({ ...who, headers: { cookie: who.cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
  let pages404 = 0;
  for (const p of PAGES) {
    const r = await call(cookie(intruder), { method: "GET", path: `/project/${o.P}${p}` });
    if (r.status === 404) pages404++;
    else check(`intruder → page /project/[owner]${p}`, false, `${r.status}`);
  }
  check(`every project page is not-found for the intruder (${pages404}/${PAGES.length})`, pages404 === PAGES.length);
  const dash = await call(cookie(intruder), { method: "GET", path: "/dashboard" });
  check("the intruder's dashboard lists their project and not the owner's", dash.status === 200 && dash.text.includes(m.P) && !dash.text.includes(o.P), `${dash.status}`);

  // 3b. attaching a firm needs membership of BOTH the firm and the project
  const firm = await call(intruder, { method: "POST", path: "/api/firms", body: { name: `Isolation sweep firm ${Date.now()} (scratch)` } });
  const firmId = firm.body?.firm?.id;
  if (firmId) {
    const a = await call(intruder, { method: "PATCH", path: `/api/projects/${o.P}`, body: { firm_id: firmId } });
    check("firm attach: a member of the FIRM who is not a member of the project → 403 not_a_project_member", a.status === 403 && a.body?.code === "not_a_project_member", `${a.status} ${a.body?.code}`);
    const b = await call(owner, { method: "PATCH", path: `/api/projects/${o.P}`, body: { firm_id: firmId } });
    check("firm attach: a member of the PROJECT who is not a member of the firm → 403 not_a_member", b.status === 403 && b.body?.code === "not_a_member", `${b.status} ${b.body?.code}`);
    const c = await call(intruder, { method: "PATCH", path: `/api/projects/${m.P}`, body: { firm_id: firmId } });
    check("firm attach: a member of both → 200", c.status === 200, `${c.status} ${c.body?.error ?? ""}`);
    await sb.from("projects").update({ firm_id: null }).eq("id", m.P);
    await sb.from("pilot_events").delete().eq("firm_id", firmId);
    await sb.from("firms").delete().eq("id", firmId);
  } else check("scratch firm created for the attach checks", false, `${firm.status}`);

  // 4. nothing moved
  const after = await snapshot(o);
  const moved = Object.keys(before).filter((t) => before[t] !== after[t]);
  check("every owner row is byte-identical after the intruder's attempts", moved.length === 0, moved.join(", "));

  // 5. control: the owner reaches the same routes
  const reads = ["app/api/plan-fixtures/route.ts|GET", "app/api/project-brief/route.ts|GET", "app/api/moodboard/route.ts|GET", "app/api/projects/[id]/boq-revisions/route.ts|GET", "app/api/plan-elements/route.ts|GET", "app/api/render/status/route.ts|GET"];
  const res = [];
  for (const h of reads) res.push([h, (await call(owner, T[h](o, m))).status]);
  // Past the gate is the point: render/status then asks Replicate about a made-up prediction and fails on its own.
  check("control: the owner gets past the gate on the same routes", res.every(([, s]) => s !== 401 && s !== 403), res.map(([h, s]) => `${h.split("/api/")[1].replace("/route.ts", "")} ${s}`).join(" · "));
  const page = await call(cookie(owner), { method: "GET", path: `/project/${o.P}/plan` });
  check("control: the owner opens the project's pages", page.status === 200, `${page.status}`);
} finally {
  console.log("cleanup");
  for (const ids of [o, m].filter(Boolean)) {
    const { data: objs } = await sb.storage.from("plan-uploads").list(`${ids.P}/assets`);
    if (objs?.length) await sb.storage.from("plan-uploads").remove(objs.map((x) => `${ids.P}/assets/${x.name}`));
    await sb.from("pilot_events").delete().eq("project_id", ids.P);
    await sb.from("pack_exports").delete().eq("project_id", ids.P);
    for (const t of ["renders", "boqs", "moodboard_items", "project_assets", "plan_fixtures", "feedback_events", "boq_corrections"]) await sb.from(t).delete().eq("project_id", ids.P);
    const del = await sb.from("projects").delete().eq("id", ids.P);
    if (del.error) console.log(`  project ${ids.P.slice(0, 8)}: ${del.error.message}`);
  }
  await sb.from("pilot_events").delete().in("actor", [owner.userId, intruder.userId]).gte("recorded_at", t0);
  const { data: left } = await sb.from("projects").select("id").like("name", "Isolation sweep%");
  check("scratch projects removed", (left ?? []).length === 0, `${(left ?? []).length} left`);
}

console.log(out.join("\n"));
console.log(failures === 0 ? "\nALL CHECKS PASSED — no route lets a second account touch the first account's project" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
