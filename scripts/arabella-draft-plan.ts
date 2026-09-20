// =============================================================================
// scripts/arabella-draft-plan.ts — Step 1 of the client garden (garden pilot G5):
// create "Arabella Garden — Draft for Review" and draw its plan on DERIVED
// reference dimensions, through the same authored-plan routes the editor uses.
//
// Everything is flagged: the plot, every zone, run and context footprint carries
// dims_derived with the type-plan source note; every existing feature from the
// client photos is site_reference with no disposition (the designer decides).
// The client photos land in the project's asset library, unassigned — assigning
// one to a zone would route that zone's renders down the photo path, which is a
// design decision, not a seeding one.
//
// Refuses to run if the project already exists: after Step 1 the plan belongs to
// the design session, and a re-seed would erase it. Pass --reseed to delete the
// project and start over (it prints what it deletes first).
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true OVERLAYS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/arabella-draft-plan.ts [port] [--reseed] [--name "<scratch name>"]
// Writes screenshots/garden-pilot/g5-step1.json.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  arabellaReferenceRecords,
  CONTEXT,
  photoAssetFiles,
  PLOT,
  PROJECT_NAME,
  referenceCoverage,
  SOURCE_NOTE,
  ZONES,
} from "../lib/client-garden/arabella-reference.ts";

const ROOT = "C:/dev/rennovaite";
const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "3098";
const RESEED = args.includes("--reseed");
// A scratch rehearsal copy under another name (never the client project).
const NAME = args.includes("--name") ? args[args.indexOf("--name") + 1]! : PROJECT_NAME;
const RESULT_FILE = NAME === PROJECT_NAME ? "g5-step1.json" : "g5-rehearsal-step1.json";
const BASE = `http://localhost:${PORT}`;
const PHOTOS = `${ROOT}/data/garden pilot/Client Garden Photos`;

const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`;
  results.push(line);
  console.log(line);
};

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const e = t.indexOf("=");
    if (e !== -1) env[t.slice(0, e).trim()] = t.slice(e + 1).trim().replace(/^"|"$/g, "");
  }
  return env;
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json as Record<string, unknown>;
}

async function main() {
  const env = loadEnv();
  const db: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
  const t0 = Date.now();

  const { data: existing } = await db.from("projects").select("id, created_at").eq("name", NAME);
  if ((existing ?? []).length > 0) {
    if (!RESEED) {
      console.log(`"${NAME}" already exists (${existing!.map((p) => p.id).join(", ")}). Step 1 has run; the plan now belongs to the design session.`);
      console.log("Pass --reseed to delete it and draw the reference layout again.");
      process.exit(2);
    }
    for (const p of existing!) {
      const counts: Record<string, number> = {};
      for (const t of ["plans", "renders", "boqs", "plan_fixtures", "project_assets", "pilot_events"]) {
        const { count } = await db.from(t).select("*", { count: "exact", head: true }).eq("project_id", p.id);
        counts[t] = count ?? 0;
      }
      console.log(`--reseed: deleting project ${p.id} (cascade) — ${JSON.stringify(counts)}`);
      await db.from("projects").delete().eq("id", p.id);
    }
  }

  const rec = arabellaReferenceRecords();

  // --- plot -------------------------------------------------------------------------------
  const created = await call("POST", "/api/draw-plan", { name: NAME, plot_width_m: PLOT.width_m, plot_depth_m: PLOT.depth_m, dims_derived: true, dims_note: SOURCE_NOTE });
  const projectId = String(created.project_id);
  const planId = String(created.plan_id);
  check("project created through /api/draw-plan", !!projectId && !!planId, projectId);

  // --- zones ------------------------------------------------------------------------------
  const zoneIds = new Map(rec.zones.map((z) => [z.key, crypto.randomUUID()]));
  const saved = await call("POST", "/api/update-plan", {
    plan_id: planId,
    rooms: rec.zones.map((z) => ({
      id: zoneIds.get(z.key),
      name_en: z.name,
      name_ar: null,
      room_type: z.kind,
      area_m2: z.area_m2,
      polygon: z.polygon,
      unroofed: true,
      dims_derived: true,
      derived_note: z.derived_note,
      ...(z.site_reference ? { site_reference: true, disposition: null } : {}),
    })),
    deleted_ids: [],
  });
  check("zones save with no overlaps", saved.success === true && saved.has_overlaps === false, JSON.stringify(saved.overlap_pairs ?? []));
  for (const z of rec.zones.filter((x) => x.height_mm || x.spec)) {
    await call("PATCH", "/api/plan-zones", { id: zoneIds.get(z.key), height_mm: z.height_mm ?? null, spec: z.spec ?? null });
  }

  // --- context ----------------------------------------------------------------------------
  for (const c of rec.context) {
    await call("POST", "/api/plan-context", { plan_id: planId, kind: c.kind, name: c.name, polygon: c.polygon, height_mm: c.height_mm, derived: true, note: c.note, dims_derived: true, ...(c.site_reference ? { site_reference: true, disposition: null } : {}) });
  }

  // --- runs -------------------------------------------------------------------------------
  const roomAt = (p: [number, number]) => {
    const m: [number, number] = [p[0] * PLOT.width_m, p[1] * PLOT.width_m];
    const z = ZONES.find((zz) => {
      const xs = zz.polygon.map((q) => q[0]), ys = zz.polygon.map((q) => q[1]);
      return m[0] >= Math.min(...xs) && m[0] <= Math.max(...xs) && m[1] >= Math.min(...ys) && m[1] <= Math.max(...ys);
    });
    return z ? zoneIds.get(z.key)! : null;
  };
  for (const r of rec.runs) {
    await call("POST", "/api/plan-elements", {
      plan_id: planId, room_id: roomAt(r.polyline[0]!), kind: r.kind, polyline: r.polyline, height_mm: r.height_mm, width_mm: r.width_mm,
      derived: true, spec: r.spec, dims_derived: true, derived_note: SOURCE_NOTE, site_reference: true, disposition: null,
    });
  }

  // --- trees ------------------------------------------------------------------------------
  for (const t of rec.trees) {
    await call("POST", "/api/plan-fixtures", {
      project_id: projectId, type: "tree", room_id: roomAt(t.position), position: t.position, spec: t.spec,
      dims_derived: true, derived_note: "placed approximately from client site photos", site_reference: true, disposition: null,
    });
  }

  const drawnMs = Date.now() - t0;

  // --- client photos → asset library (unassigned) --------------------------------------------
  let uploaded = 0;
  for (const file of photoAssetFiles()) {
    const fd = new FormData();
    fd.append("file", new Blob([readFileSync(`${PHOTOS}/${file}`)], { type: "image/jpeg" }), file);
    fd.append("project_id", projectId);
    fd.append("kind", "photo");
    fd.append("source", "intake");
    const res = await fetch(`${BASE}/api/project-asset`, { method: "POST", body: fd });
    if (res.ok) uploaded++;
    else console.log(`  upload ${file} → ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  check("all 14 client photos are in the project's asset library", uploaded === 14, `${uploaded}/14`);

  // Step 1 is scripted: tag its events so the design-session metrics start after it.
  const { data: evs } = await db.from("pilot_events").select("id, detail").eq("project_id", projectId);
  for (const e of evs ?? []) {
    await db.from("pilot_events").update({ detail: { ...(e.detail as Record<string, unknown> | null ?? {}), stage: "reference_layout" } }).eq("id", e.id);
  }

  // --- verify what the platform now reads ---------------------------------------------------
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const { derivePlanGraph } = await import("../lib/plan/derive.ts");
  const { graphDraftStatus } = await import("../lib/plan/geometry.ts");
  const graph = await derivePlanGraph(projectId);
  const byName = new Map(graph.rooms.map((r) => [r.name_en, r]));
  check("4 zones, 6 context volumes, 6 runs on the graph", graph.rooms.length === 4 && graph.context.length === 6 && graph.elements.length === 6, `${graph.rooms.length}/${graph.context.length}/${graph.elements.length}`);
  check("every zone area round-trips", ZONES.every((z) => byName.get(z.name)?.area_m2 === z.area_m2), ZONES.map((z) => `${z.name} ${byName.get(z.name)?.area_m2}`).join("; "));
  check("plot is derived, with its source note", graph.meta.plot?.dims_derived === true && graph.meta.plot?.dims_note === SOURCE_NOTE);
  check("every zone, run and context footprint is derived", graph.rooms.every((r) => r.dims_derived) && graph.elements.every((e) => e.dims_derived) && graph.context.every((c) => c.dims_derived));
  const siteRefs = [...graph.rooms.filter((r) => r.site_reference), ...graph.elements.filter((e) => e.site_reference), ...graph.context.filter((c) => c.site_reference)];
  check("site reference: gazebo, 6 runs, 4 boundary walls — none decided", siteRefs.length === 11 && siteRefs.every((s) => s.disposition === null), String(siteRefs.length));
  const { data: trees } = await db.from("plan_fixtures").select("id, site_reference, disposition, dims_derived").eq("project_id", projectId).eq("type", "tree");
  check("6 existing trees placed as site reference", (trees ?? []).length === 6 && (trees ?? []).every((t) => t.site_reference && t.disposition === null && t.dims_derived));
  const draft = graphDraftStatus(graph);
  check("the plan is a DRAFT", draft.draft && draft.derived.includes("plot boundary"), `${draft.derived.length} derived boundary-critical items`);
  const cov = referenceCoverage();
  check("zones + buildings account for the plot to within the stated 0.1 m residual", Math.abs(cov.plot_m2 - cov.zones_m2 - cov.buildings_m2) < 0.1 * 21.1 + 0.01, JSON.stringify(cov));

  const out = {
    project_id: projectId,
    plan_id: planId,
    project_name: NAME,
    step1_draw_seconds: Math.round(drawnMs / 100) / 10,
    zones: ZONES.map((z) => ({ name: z.name, kind: z.kind, area_m2: z.area_m2, site_reference: !!z.site_reference })),
    context: CONTEXT.map((c) => c.name),
    coverage: cov,
    draft,
    results,
  };
  mkdirSync(`${ROOT}/screenshots/garden-pilot`, { recursive: true });
  writeFileSync(`${ROOT}/screenshots/garden-pilot/${RESULT_FILE}`, JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed · project ${projectId}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
