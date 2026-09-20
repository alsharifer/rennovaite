// =============================================================================
// scripts/arabella-design-seed.ts — seed the baseline design PROPOSAL on the
// client garden (garden pilot G5, draft stage), through the same authored routes
// the editor uses.
//
// Everything here is a proposal for the review session: existing-feature
// decisions are defaults the designer can override, every zone stays derived,
// every existing feature keeps its site_reference tag. Friction met while seeding
// is logged to the pilot friction log (it is pilot data), and every pilot event
// this script causes is tagged stage "design_seed" so the design-session metrics
// never mistake it for the designer.
//
// The export gate must pass legitimately: every counter typed, every existing
// item decided — this script does not touch the gate.
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true OVERLAYS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/arabella-design-seed.ts [port]
// Writes screenshots/garden-pilot/g5-design-seed.json.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { PLOT, PROJECT_NAME, SOURCE_NOTE, toSite, toSitePath } from "../lib/client-garden/arabella-reference.ts";

const ROOT = "C:/dev/rennovaite";
const PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? "3098";
const BASE = `http://localhost:${PORT}`;

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

type Pt = [number, number];
// Geometry below is written in the type-plan frame (the dimension set's); it is
// stored in the SITE frame — the handed twin, see HANDEDNESS in arabella-reference.
const norm = (p: Pt): Pt => [Math.round((p[0] / PLOT.width_m) * 1e6) / 1e6, Math.round((p[1] / PLOT.width_m) * 1e6) / 1e6];
const n = (p: Pt): Pt => norm(toSite(p));
const np = (path: Pt[]): Pt[] => toSitePath(path).map(norm);
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const area = (poly: Pt[]) => Math.round((Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * p[1], 0)) / 2) * 100) / 100;
const inside = (p: Pt, poly: Pt[]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`;
  results.push(line);
  console.log(line);
};

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

// --- The design (metres; x along the 26.7 m frontage, y from the rear boundary) --------

const FRONT_ASSUMPTION = "the type-plan dimension set carries no front-garden footprint — assumed a 2.2 × 4.0 m garden beside the drive at the street edge; verify on site";
const GATE_ASSUMPTION = "garden gate assumed at the west end of the rear strip (where the client photo shows the side gate); the path links it to the side garden";

const ZONES = [
  { key: "rear-bed", reuse: null, name: "Rear planting bed", type: "planting_bed", poly: rect(0, 0, 20.6, 0.6) },
  { key: "rear-lawn", reuse: "Rear garden strip — lawn", name: "Rear garden — lawn", type: "artificial_grass", poly: rect(0, 0.6, 20.6, 3.3) },
  { key: "rear-path", reuse: null, name: "Porcelain path — garden gate to side garden", type: "path", poly: rect(0, 3.3, 20.6, 4.3), assumption: GATE_ASSUMPTION },
  { key: "court", reuse: null, name: "Pergola court — porcelain paving", type: "paving", poly: [[20.6, 0], [23.2, 0], [23.2, 3.5], [26.7, 3.5], [26.7, 4.3], [20.6, 4.3]] as Pt[] },
  { key: "gazebo", reuse: "Gazebo (existing)", name: "Louvred pergola (replaces existing gazebo)", type: "structure", poly: rect(23.2, 0, 26.7, 3.5) },
  { key: "side-deck", reuse: "Side garden — deck strip", name: "Side garden — porcelain paving terrace", type: "paving", poly: rect(21.1, 4.3, 23.7, 10.5) },
  { key: "side-lawn", reuse: "Side garden — lawn", name: "Side garden — lawn", type: "artificial_grass", poly: rect(23.7, 4.3, 26.1, 10.5) },
  { key: "side-bed", reuse: null, name: "Side garden — planting bed", type: "planting_bed", poly: rect(26.1, 4.3, 26.7, 10.5) },
  { key: "front-lawn", reuse: null, name: "Front garden — lawn", type: "artificial_grass", poly: rect(0.6, 6.5, 2.2, 10.5), assumption: FRONT_ASSUMPTION },
  { key: "front-bed", reuse: null, name: "Front garden — planting bed", type: "planting_bed", poly: rect(0, 6.5, 0.6, 10.5), assumption: FRONT_ASSUMPTION },
];

const PERGOLA_SPEC = {
  ref_key: "gazebo",
  form: "louvred pergola",
  system: "Motorised louvred aluminium pergola",
  variant: "louvered",
  replaces_existing: "hardtop gazebo with dark glazed panels",
  member_mm: 150,
  beam_depth_mm: 150,
  height_source: "design brief: 2.8 m, same footprint as the existing gazebo (3.5 × 3.5 m)",
  decision_note: "a motorised louvred pergola in the gazebo's footprint — open or closed louvres for shade and rain",
};

async function main() {
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const started = new Date().toISOString();
  const friction: { area: string; note: string }[] = [];
  const logFriction = (area: string, note: string) => friction.push({ area, note });

  const { data: project } = await db.from("projects").select("id").eq("name", PROJECT_NAME).single<{ id: string }>();
  const projectId = project!.id;
  const { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).single<{ id: string }>();
  const planId = plan!.id;
  const { data: rooms } = await db.from("rooms").select("id, name_en").eq("plan_id", planId);
  const { data: els } = await db.from("plan_elements").select("id, kind, spec").eq("plan_id", planId);
  const { data: ctx } = await db.from("plan_context").select("id, name, kind, site_reference, polygon, note").eq("plan_id", planId);
  const { data: fx } = await db.from("plan_fixtures").select("id, type, spec, position").eq("project_id", projectId);
  const before = { rooms: rooms?.length, elements: els?.length, fixtures: fx?.length };

  // --- style direction -----------------------------------------------------------------
  const { data: styles } = await db.from("style_choices").select("style_key").eq("project_id", projectId).is("room_id", null);
  if ((styles ?? []).length === 0) {
    await call("POST", "/api/style-choice", { project_id: projectId, style_key: "desert-modern" });
    logFriction("renders", "No style direction was locked, and renders cannot run without one — Desert Modern set as the proposed default (it matches the photos' modern boundary walls); the client confirms or changes it at the review.");
  }

  // --- zones ---------------------------------------------------------------------------
  const idOf = new Map<string, string>();
  for (const z of ZONES) idOf.set(z.key, z.reuse ? rooms!.find((r) => r.name_en === z.reuse)!.id : crypto.randomUUID());
  const saved = await call("POST", "/api/update-plan", {
    plan_id: planId,
    rooms: ZONES.map((z) => ({
      id: idOf.get(z.key),
      name_en: z.name,
      name_ar: null,
      room_type: z.type,
      area_m2: area(z.poly),
      polygon: np(z.poly),
      unroofed: true,
      // Every zone of the proposal stands on the derived reference layout.
      dims_derived: true,
      derived_note: z.assumption ? `${SOURCE_NOTE}; ${z.assumption}` : SOURCE_NOTE,
    })),
    deleted_ids: [],
  });
  check("the proposal's 10 zones save with no overlaps", saved.success === true && saved.has_overlaps === false, JSON.stringify(saved.overlap_pairs ?? []));

  for (const z of ZONES) {
    if (z.key === "gazebo") {
      await call("PATCH", "/api/plan-zones", { id: idOf.get(z.key), height_mm: 2800, spec: PERGOLA_SPEC, disposition: "replace" });
    } else {
      await call("PATCH", "/api/plan-zones", { id: idOf.get(z.key), spec: { ref_key: z.key, ...(z.assumption ? { assumption: z.assumption } : {}) } });
    }
  }
  logFriction("plan", "The type-plan dimension set has no front-garden footprint; the front lawn + bed beside the drive are an assumed 2.2 × 4.0 m, and the garage/drive block had to be reshaped around them through /api/plan-context — context footprints have no editor in the UI.");
  logFriction("plan", "The garden gate is not on the plan (a boundary wall has no gate/opening element); the 1.0 m path assumes the gate at the rear strip's west end.");
  logFriction("plan", "A pergola's variant (louvred, fixed, timber) has no field: every structure zone prices at the one motorised louvred pergola rate, and the variant lives in spec only.");

  // --- context: garage/drive block around the front garden ------------------------------
  const garage = ctx!.find((c) => c.name === "Garage / drive block")!;
  await call("PATCH", "/api/plan-context", {
    id: garage.id,
    polygon: np([[0, 4.3], [6.3, 4.3], [6.3, 10.5], [2.2, 10.5], [2.2, 6.5], [0, 6.5]]),
    note: `${garage.note}; reshaped around the front garden (${FRONT_ASSUMPTION})`,
    dims_derived: true,
  });
  for (const c of ctx!.filter((c) => c.site_reference)) await call("PATCH", "/api/plan-context", { id: c.id, disposition: "keep" });

  // --- existing runs: decisions ----------------------------------------------------------
  const el = (name: string) => els!.find((e) => (e.spec as { name?: string } | null)?.name === name)!;
  const patchRun = async (name: string, disposition: string, extra: Record<string, unknown> = {}) => {
    const e = el(name);
    // PATCH replaces spec wholesale: re-send the stored spec with the additions.
    await call("PATCH", "/api/plan-elements", { id: e.id, disposition, ...(Object.keys(extra).length ? { spec: { ...(e.spec as object), ...extra } } : {}) });
  };
  // The slabs run along the house (side garden) and then along the rear strip: both
  // stretches become porcelain paving — the terrace and the 1.0 m path.
  await patchRun("Stepping-stone path (existing)", "replace", { replaced_by: "porcelain paving — the side-garden terrace along the house and the 1.0 m path along the rear strip", replaced_in_place: true, decision_note: "stepping slabs in lawn become continuous porcelain paving" });
  await patchRun("Outdoor sink counter (existing)", "replace", { replaced_by: "BBQ counter under the new pergola", replaced_in_place: false, decision_note: "sink counter unit becomes a 3.0 lm BBQ counter" });
  await patchRun("String lights (existing) — corner wall", "replace", { replaced_by: "designed garden lighting (spike, inground and boundary-wall lights)", replaced_in_place: false });
  await patchRun("String lights (existing) — across side garden", "replace", { replaced_by: "designed garden lighting (spike, inground and boundary-wall lights)", replaced_in_place: false });
  await patchRun("Planter border with stone edging (existing) — rear", "remove", { decision_note: "superseded by the new rear planting bed" });
  await patchRun("Planter border with stone edging (existing) — side", "remove", { decision_note: "superseded by the new side planting bed" });
  logFriction("elements", "Replace meant like-for-like; a replacement by a DIFFERENT element (stepping path → porcelain path zone, sink counter → BBQ counter elsewhere, string lights → designed lighting) had no representation and would have priced both. Added spec.replaced_by (old item = demolition only, the new element carries the work) — API only, no editor control yet.");
  logFriction("elements", "PATCH /api/plan-elements and /api/plan-zones replace spec wholesale: adding one key means re-sending the stored spec.");

  // --- new runs ----------------------------------------------------------------------------
  const zoneAt = (p: Pt) => ZONES.find((z) => inside(p, z.poly)) ?? null;
  const bbqLine: Pt[] = [[23.45, 0.7], [26.45, 0.7]];
  await call("POST", "/api/plan-elements", {
    plan_id: planId, room_id: idOf.get("gazebo"), kind: "counter_run", polyline: np(bbqLine), variant: "bbq",
    height_mm: 900, width_mm: 900, derived: true, dims_derived: true, derived_note: SOURCE_NOTE,
    spec: { name: "BBQ counter (under the pergola)", top_slab_mm: 100, source: "design brief 3.0 lm; section 900 × 900 as the reference project's BBQ counter" },
  });
  logFriction("elements", "The counter run's default section (600 wide) is not a BBQ counter's; the 900 × 900 section had to be entered explicitly.");
  const benchLine: Pt[] = [[20.9, 1.0], [20.9, 3.0], [22.9, 3.0]];
  await call("POST", "/api/plan-elements", {
    plan_id: planId, room_id: idOf.get("court"), kind: "bench_run", polyline: np(benchLine),
    height_mm: 450, width_mm: 500, derived: true, dims_derived: true, derived_note: SOURCE_NOTE,
    spec: { name: "L-seating bench (pergola court)", source: "design brief 4.0 lm L; section assumed 450 high × 500 deep" },
  });

  // --- trees: keep (re-zoned where the layout moved under them) -----------------------------
  for (const t of (fx ?? []).filter((f) => f.type === "tree")) {
    const p = t.position as Pt;
    const z = zoneAt(toSite([p[0] * PLOT.width_m, p[1] * PLOT.width_m]));
    await call("POST", "/api/plan-fixtures", { id: t.id, project_id: projectId, type: "tree", position: p, room_id: z ? idOf.get(z.key) : null, disposition: "keep" });
  }

  // --- lighting as designed + drainage ---------------------------------------------------------
  const place = async (type: string, m: Pt, spec: Record<string, unknown> | null) => {
    const z = zoneAt(m);
    await call("POST", "/api/plan-fixtures", { project_id: projectId, type, position: n(m), room_id: z ? idOf.get(z.key) : null, ...(spec ? { spec } : {}) });
  };
  const spikes: Pt[] = [[5.5, 0.3], [11, 0.3], [17, 0.3], [26.4, 6], [26.4, 9], [0.3, 8.5]];
  const inground: Pt[] = [[3, 3.8], [8, 3.8], [13, 3.8], [18, 3.8], [22.4, 6.5], [22.4, 9.5]];
  const wall: Pt[] = [[5, 0.1], [10, 0.1], [15, 0.1], [26.6, 5.5], [26.6, 8.5], [24.9, 10.4]];
  for (const p of spikes) await place("garden_light", p, { fitting: "spike", source: "as_designed" });
  for (const p of inground) await place("garden_light", p, { fitting: "inground", source: "as_designed" });
  for (const p of wall) await place("boundary_light", p, { fitting: "wall", source: "as_designed" });
  for (const p of [[21.9, 3.9], [22.4, 8.0]] as Pt[]) await place("drainage_point", p, null);
  logFriction("drainage", "Irrigation zones are not drawn: the allowance derives from the planting beds as built (rear, side and front beds).");

  // --- friction log (pilot data) ----------------------------------------------------------------
  for (const f of friction) await call("POST", "/api/pilot-events", { project_id: projectId, note: f.note, area: f.area });

  // --- BoQ + the export gate, legitimately ---------------------------------------------------
  const gen = await call("POST", "/api/generate-boq", { project_id: projectId });
  check("the BoQ generates on the proposal", !gen.error, `AED ${gen.grand_total_aed}`);
  const ready = (await (await fetch(`${BASE}/api/projects/${projectId}/boq-pdf?format=json`)).json()) as { readiness: { ready: boolean; untyped_counters: string[]; undecided: string[]; stale_boq_needs_selection: string[] } };
  check("the export gate passes: no untyped counter, nothing undecided, no needs_selection", ready.readiness.ready, JSON.stringify(ready.readiness));

  // --- every event this script caused is script-generated -------------------------------------
  const { data: evs } = await db.from("pilot_events").select("id, kind, detail").eq("project_id", projectId).gte("recorded_at", started);
  for (const e of evs ?? []) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (!d.stage) await db.from("pilot_events").update({ detail: { ...d, stage: "design_seed", source: "scripts/arabella-design-seed.ts" } }).eq("id", e.id);
  }
  check("every pilot event from the seeding is tagged script-generated", true, `${(evs ?? []).length} events tagged design_seed`);

  // --- flags intact --------------------------------------------------------------------------
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const { derivePlanGraph } = await import("../lib/plan/derive.ts");
  const { graphDraftStatus } = await import("../lib/plan/geometry.ts");
  const g = await derivePlanGraph(projectId);
  check("every zone, run and context footprint is still derived", g.rooms.every((r) => r.dims_derived) && g.elements.every((e) => e.dims_derived) && g.context.every((c) => c.dims_derived) && g.meta.plot?.dims_derived === true);
  const siteRefs = [...g.rooms.filter((r) => r.site_reference), ...g.elements.filter((e) => e.site_reference), ...g.context.filter((c) => c.site_reference)];
  check("all 11 existing zones/runs/walls keep their site_reference tag", siteRefs.length === 11, String(siteRefs.length));
  check("the plan is still a DRAFT", graphDraftStatus(g).draft);

  const { data: fxAfter } = await db.from("plan_fixtures").select("id").eq("project_id", projectId);
  const out = {
    project_id: projectId,
    seeded_at: started,
    before,
    after: { rooms: g.rooms.length, elements: g.elements.length, fixtures: fxAfter?.length },
    zones: ZONES.map((z) => ({ name: z.name, type: z.type, area_m2: area(z.poly) })),
    boq_total_aed: gen.grand_total_aed,
    friction,
    results,
  };
  mkdirSync(`${ROOT}/screenshots/garden-pilot`, { recursive: true });
  writeFileSync(`${ROOT}/screenshots/garden-pilot/g5-design-seed.json`, JSON.stringify(out, null, 2));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
