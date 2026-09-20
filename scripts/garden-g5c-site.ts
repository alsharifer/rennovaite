// =============================================================================
// scripts/garden-g5c-site.ts — what the review found missing from the client
// garden's plan (garden pilot G5c, defects A2, B5, E): the separator wall, the
// garden gate in it, the existing shed, and two outdoor water taps.
//
// Existing items (wall, gate, shed) come from the client photos (see
// OPENINGS / UNITS / CONTEXT in lib/client-garden/arabella-reference.ts) and are
// placed flagged site_reference, derived, with the default decision KEEP — kept
// items add no demolition and no new work, so the BoQ does not move for them.
// The taps are DESIGN (as designed, not surveyed): two hose bibs on the villa
// wall, one on the rear strip and one in the side garden, and they add one
// QS-to-price line.
//
// Idempotent: an item already on the plan (by name) is left alone.
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true OVERLAYS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-g5c-site.ts [port]
// Pilot events: stage "geometry_fix".
// =============================================================================

import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { CONTEXT, OPENINGS, PLOT, PROJECT_NAME, SOURCE_NOTE, UNITS, toSite, toSitePath } from "../lib/client-garden/arabella-reference.ts";

const ROOT = "C:/dev/rennovaite";
const PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? "3098";
const BASE = `http://localhost:${PORT}`;

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

type Pt = [number, number];
const norm = (p: Pt): Pt => [Math.round((p[0] / PLOT.width_m) * 1e6) / 1e6, Math.round((p[1] / PLOT.width_m) * 1e6) / 1e6];

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

/** Design taps, type-plan frame: on the villa's rear face (path) and side face (terrace). */
const TAPS: { name: string; at: Pt; zone: string }[] = [
  { name: "Outdoor water tap — rear strip", at: [13.0, 4.2], zone: "Porcelain path — garden gate to side garden" },
  { name: "Outdoor water tap — side garden", at: [21.2, 7.0], zone: "Side garden — porcelain paving terrace" },
];

async function main() {
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const started = new Date().toISOString();
  const { data: project } = await db.from("projects").select("id").eq("name", PROJECT_NAME).single<{ id: string }>();
  const projectId = project!.id;
  const { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).single<{ id: string }>();
  const planId = plan!.id;
  const { data: rooms } = await db.from("rooms").select("id, name_en, polygon").eq("plan_id", planId);
  const log: string[] = [];

  // --- separator wall -----------------------------------------------------------------
  const wallRef = CONTEXT.find((c) => c.key === "wall-separator")!;
  const { data: ctx } = await db.from("plan_context").select("id, name").eq("plan_id", planId);
  let wallId = (ctx ?? []).find((c) => c.name === wallRef.name)?.id as string | undefined;
  if (!wallId) {
    const r = await call("POST", "/api/plan-context", {
      plan_id: planId, kind: "boundary_wall", name: wallRef.name, polygon: toSitePath(wallRef.polygon).map(norm),
      base_mm: 0, height_mm: wallRef.height_mm, derived: true, note: wallRef.note,
      dims_derived: true, site_reference: true, disposition: "keep",
    });
    wallId = ((r.context ?? r) as { id: string }).id;
    log.push(`separator wall added (${wallId})`);
  } else log.push("separator wall already on the plan");

  // --- gate ---------------------------------------------------------------------------
  const gateRef = OPENINGS.find((o) => o.key === "gate")!;
  const { data: ops } = await db.from("plan_openings").select("id, spec").eq("plan_id", planId);
  if (!(ops ?? []).some((o) => (o.spec as { name?: string } | null)?.name === gateRef.name)) {
    await call("POST", "/api/plan-openings", {
      plan_id: planId, kind: "gate", width_mm: gateRef.width_mm, height_mm: gateRef.height_mm, sill_mm: 0,
      position: norm(toSite(gateRef.position)), context_id: wallId, spec: gateRef.spec,
      site_reference: true, disposition: "keep", dims_derived: true, derived_note: SOURCE_NOTE,
    });
    log.push("garden gate added in the separator wall");
  } else log.push("gate already on the plan");

  // --- shed + taps ----------------------------------------------------------------------
  const { data: fx } = await db.from("plan_fixtures").select("id, type, spec").eq("project_id", projectId);
  const has = (name: string) => (fx ?? []).some((f) => (f.spec as { name?: string } | null)?.name === name);
  const inside = (p: Pt, poly: Pt[]) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const zoneAtNorm = (n: Pt) => (rooms ?? []).find((r) => inside(n, r.polygon as Pt[]))?.id ?? null;
  for (const u of UNITS) {
    if (has(u.name)) { log.push(`${u.name} already on the plan`); continue; }
    const pos = norm(toSite(u.position));
    await call("POST", "/api/plan-fixtures", { project_id: projectId, type: u.type, position: pos, room_id: zoneAtNorm(pos), spec: u.spec, site_reference: true, disposition: "keep", dims_derived: true, derived_note: SOURCE_NOTE });
    log.push(`${u.name} added (keep)`);
  }
  for (const t of TAPS) {
    if (has(t.name)) { log.push(`${t.name} already on the plan`); continue; }
    const pos = norm(toSite(t.at));
    const zoneId = (rooms ?? []).find((r) => r.name_en === t.zone)?.id ?? zoneAtNorm(pos);
    await call("POST", "/api/plan-fixtures", { project_id: projectId, type: "water_tap", position: pos, room_id: zoneId, spec: { name: t.name, source: "as_designed", mounting: "villa wall", height_mm: 600 } });
    log.push(`${t.name} placed (as designed)`);
  }

  await call("POST", "/api/pilot-events", { project_id: projectId, area: "plan", note: "The garden gate and the wall it sits in had no place in the plan vocabulary: an opening could only snap to a wall derived from room edges, and garden walls are context footprints. Added gates as openings that name their context wall (migration 039)." });
  await call("POST", "/api/pilot-events", { project_id: projectId, area: "boq", note: "A garden BoQ had no line for outdoor water taps or for planting-bed soil preparation: both are real work a client expects priced; added as QS-to-price lines (GL-25, GL-26)." });

  const { data: evs } = await db.from("pilot_events").select("id, detail").eq("project_id", projectId).gte("recorded_at", started);
  for (const e of evs ?? []) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (!d.stage) await db.from("pilot_events").update({ detail: { ...d, stage: "geometry_fix", source: "scripts/garden-g5c-site.ts" } }).eq("id", e.id);
  }
  for (const l of log) console.log(l);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
