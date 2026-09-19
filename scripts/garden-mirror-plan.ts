// =============================================================================
// scripts/garden-mirror-plan.ts — correct the client garden's handedness
// (garden pilot G5c, defect A1).
//
// The authored plan was drawn in the developer type plan's frame, and that type
// plan depicts the unit's handed twin (see HANDEDNESS in
// lib/client-garden/arabella-reference.ts for the photo evidence). The fix is ONE
// reflection across the plot's width, applied to everything with a position —
// zones, runs, fixtures, context footprints, openings — through the same routes
// the editor uses. Polygons and polylines are reversed with it so winding and a
// run's band side keep their orientation.
//
// A reflection preserves every area and length, so the BoQ must not move. This
// script proves it: it regenerates the BoQ before and after and asserts the
// priced lines (quantity, rate, total, element_refs) and every take-off row are
// byte-identical. It refuses to run twice (the villa footprint's side of the
// plot says which frame the plan is in).
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true OVERLAYS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-mirror-plan.ts <project-id> [port]
// Writes screenshots/garden-pilot/g5c-mirror.json. Pilot events: stage "geometry_fix".
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ROOT = "C:/dev/rennovaite";
const args = process.argv.slice(2);
const PROJECT = args.find((a) => /^[0-9a-f-]{36}$/.test(a));
const PORT = args.find((a) => /^\d{2,5}$/.test(a)) ?? "3098";
const BASE = `http://localhost:${PORT}`;
if (!PROJECT) {
  console.error("usage: garden-mirror-plan.ts <project-id> [port]");
  process.exit(1);
}

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

type Pt = [number, number];
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

interface Line { description: string; quantity: number; unit: string; rate_aed: number; total_aed: number; element_refs?: string[]; rule_id?: string; notes?: string }
type Boq = { grand_total_aed: number; sections: { work_section: string; lines: Line[] }[] };

async function snapshot(db: SupabaseClient) {
  const gen = await call("POST", "/api/generate-boq", { project_id: PROJECT });
  const { data: boq } = await db.from("boqs").select("id, sections").eq("id", gen.boq_id as string).single<{ id: string; sections: Boq }>();
  const { data: takeoff } = await db.from("takeoff_items").select("work_item_key, element_id, qty, unit").eq("project_id", PROJECT!).like("work_item_key", "garden.%");
  const lines = boq!.sections.sections.flatMap((s) =>
    s.lines.map((l) => ({ section: s.work_section, description: l.description, quantity: l.quantity, unit: l.unit, rate_aed: l.rate_aed, total_aed: l.total_aed, element_refs: [...(l.element_refs ?? [])].sort(), notes: l.notes ?? null })),
  );
  const rows = (takeoff ?? []).map((t) => `${t.work_item_key}|${t.element_id}|${Number(t.qty).toFixed(4)}|${t.unit}`).sort();
  return { boq_id: boq!.id, grand_total_aed: boq!.sections.grand_total_aed, lines, rows };
}

async function main() {
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const started = new Date().toISOString();
  const { data: plan } = await db.from("plans").select("id, plot_width_m").eq("project_id", PROJECT!).order("created_at", { ascending: false }).limit(1).single<{ id: string; plot_width_m: number }>();
  const planId = plan!.id;

  // Normalised x runs 0..1 across the plot width (norm_origin 0), so the reflection is x → 1 − x.
  const mx = (p: Pt): Pt => [Math.round((1 - p[0]) * 1e6) / 1e6, p[1]];
  const mpath = (path: Pt[]): Pt[] => path.map(mx).reverse();

  const { data: ctx } = await db.from("plan_context").select("id, name, kind, polygon").eq("plan_id", planId);
  const villa = (ctx ?? []).find((c) => c.kind === "existing_building" && /villa/i.test(c.name));
  const cx = villa ? (villa.polygon as Pt[]).reduce((s, p) => s + p[0], 0) / (villa.polygon as Pt[]).length : null;
  // Type-plan frame: villa 6.3–21.1 m of 26.7 (centroid 0.51); site frame: 5.6–20.4 m (0.49).
  if (cx === null || cx < 0.5) {
    console.log(`Refusing: the plan is already in the site frame (villa centroid x = ${cx?.toFixed(3)}).`);
    process.exit(2);
  }

  const before = await snapshot(db);

  const { data: rooms } = await db.from("rooms").select("id, name_en, name_ar, room_type, area_m2, polygon, unroofed, dims_derived, derived_note, site_reference, disposition").eq("plan_id", planId);
  const { data: els } = await db.from("plan_elements").select("id, polyline").eq("plan_id", planId);
  const { data: fx } = await db.from("plan_fixtures").select("id, type, position, room_id").eq("project_id", PROJECT!);
  const { data: ops } = await db.from("plan_openings").select("id, position").eq("plan_id", planId);

  await call("POST", "/api/update-plan", {
    plan_id: planId,
    rooms: (rooms ?? []).map((r) => ({ ...r, polygon: mpath(r.polygon as Pt[]) })),
    deleted_ids: [],
  });
  for (const e of els ?? []) await call("PATCH", "/api/plan-elements", { id: e.id, polyline: mpath(e.polyline as Pt[]) });
  for (const f of fx ?? []) await call("POST", "/api/plan-fixtures", { id: f.id, project_id: PROJECT, type: f.type, position: mx(f.position as Pt), room_id: f.room_id });
  for (const c of ctx ?? []) await call("PATCH", "/api/plan-context", { id: c.id, polygon: mpath(c.polygon as Pt[]) });
  // Openings have no editing route for position; they are mirrored in place (none on this plan today).
  for (const o of ops ?? []) if (o.position) await db.from("plan_openings").update({ position: mx(o.position as Pt) }).eq("id", o.id);

  const after = await snapshot(db);

  // --- the proof -------------------------------------------------------------------------
  const { data: roomsAfter } = await db.from("rooms").select("id, polygon").eq("plan_id", planId);
  const exact = (rooms ?? []).every((r) => JSON.stringify(mpath(r.polygon as Pt[])) === JSON.stringify(roomsAfter!.find((x) => x.id === r.id)!.polygon));
  check("every zone polygon was stored exactly as its reflection (no overlap repair reshaped anything)", exact);
  check("the BoQ grand total is identical", before.grand_total_aed === after.grand_total_aed, `AED ${before.grand_total_aed} → ${after.grand_total_aed}`);
  const lineDiff = before.lines.map((l, i) => [l, after.lines[i]] as const).filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b));
  check("every BoQ line (quantity, rate, total, element_refs, note) is byte-identical", lineDiff.length === 0 && before.lines.length === after.lines.length, lineDiff.length ? JSON.stringify(lineDiff[0]).slice(0, 300) : `${before.lines.length} lines`);
  const rowDiff = before.rows.filter((r, i) => r !== after.rows[i]);
  check("every take-off row (work item × element × qty) is byte-identical", rowDiff.length === 0 && before.rows.length === after.rows.length, rowDiff.slice(0, 2).join("; ") || `${before.rows.length} rows`);
  const { data: villaAfter } = await db.from("plan_context").select("polygon").eq("id", villa!.id).single<{ polygon: Pt[] }>();
  const cxAfter = villaAfter!.polygon.reduce((s, p) => s + p[0], 0) / villaAfter!.polygon.length;
  check("the villa now sits in the site frame (side garden on the left facing the villa)", cxAfter < 0.5, `centroid x ${cx.toFixed(3)} → ${cxAfter.toFixed(3)}`);

  const { data: evs } = await db.from("pilot_events").select("id, detail").eq("project_id", PROJECT!).gte("recorded_at", started);
  for (const e of evs ?? []) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (!d.stage) await db.from("pilot_events").update({ detail: { ...d, stage: "geometry_fix", source: "scripts/garden-mirror-plan.ts" } }).eq("id", e.id);
  }

  mkdirSync(`${ROOT}/screenshots/garden-pilot`, { recursive: true });
  writeFileSync(
    `${ROOT}/screenshots/garden-pilot/g5c-mirror.json`,
    JSON.stringify({ project_id: PROJECT, mirrored_at: started, counts: { zones: rooms?.length, runs: els?.length, fixtures: fx?.length, context: ctx?.length, openings: ops?.length }, boq_before: before.boq_id, boq_after: after.boq_id, grand_total_aed: after.grand_total_aed, lines: after.lines.length, takeoff_rows: after.rows.length, events_tagged: evs?.length ?? 0, results }, null, 2),
  );
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
