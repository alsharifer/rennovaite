// =============================================================================
// scripts/arabella-unmap-front-border.ts — take the 5.3 m front-border measure
// back off the plan and hold it UNMAPPED, pending clarification (garden pilot G5d).
//
// Applied, the measure left the drive about 1.0 m wide: the measurement and the
// type plan disagree about which edge "the front border" is, and a wrong figure
// under the word "measured" is worse on a client drawing than an honest derived
// one. So the front garden goes back to its type-plan footprint (2.2 × 4.0 m),
// the garage/drive block back to its notch (drive 4.1 m), and the measure is
// recorded as captured-but-unmapped with the reason — on the zones' assumption
// note (which the pack's Design assumptions page prints), in the session record
// and in the pilot friction log.
//
// The other six measures stand, and nothing else on the plan is touched.
// Idempotent: it refuses once the front garden is already back on its footprint.
//
// Run (dev server with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true OVERLAYS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/arabella-unmap-front-border.ts [port]
// Writes screenshots/garden-pilot/g5d-unmapped.json and appends the stage to
// screenshots/garden-pilot/g5d-session.json.
// =============================================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { PROJECT_NAME, SOURCE_NOTE } from "../lib/client-garden/arabella-reference.ts";
import { DRIVE_WIDTH_M, GARAGE_POLY, SESSION_MEASURES, UNMAPPED_MEASURES, polyArea, reconciliation, sessionZones, siteNormPath } from "../lib/client-garden/arabella-session.ts";
import { changeReport, snapshotOf, type QtySnapshot } from "../lib/pilot/change-report.ts";

const ROOT = "C:/dev/rennovaite";
const PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? "3098";
const BASE = `http://localhost:${PORT}`;

for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}

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

type Pt = [number, number];
const FRONT_KEYS = ["front-lawn", "front-bed"] as const;

async function main() {
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const started = new Date().toISOString();
  const unmapped = UNMAPPED_MEASURES.find((u) => u.key === "front_border_width_m")!;

  const { data: project } = await db.from("projects").select("id").eq("name", PROJECT_NAME).single<{ id: string }>();
  const projectId = project!.id;
  const { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).single<{ id: string }>();
  const planId = plan!.id;
  type Room = { id: string; name_en: string; name_ar: string | null; room_type: string | null; area_m2: number; polygon: Pt[]; unroofed: boolean | null; dims_derived: boolean | null; derived_note: string | null; spec: Record<string, unknown> | null };
  const rooms = ((await db.from("rooms").select("id, name_en, name_ar, room_type, area_m2, polygon, unroofed, dims_derived, derived_note, spec").eq("plan_id", planId)).data ?? []) as Room[];

  const want = sessionZones("refit");
  const target = new Map(FRONT_KEYS.map((k) => [k, want.find((z) => z.key === k)!]));
  const byKey = (k: string) => rooms.find((r) => (r.spec as { ref_key?: string } | null)?.ref_key === k)!;
  const before = FRONT_KEYS.map((k) => ({ key: k, area: byKey(k).area_m2 }));
  const already = FRONT_KEYS.every((k) => Math.abs(byKey(k).area_m2 - Math.round(polyArea(target.get(k)!.poly) * 100) / 100) < 0.01);
  if (already) {
    console.log("The front garden is already on its type-plan footprint — nothing to revert.");
    process.exit(0);
  }

  const snapshot = async (): Promise<QtySnapshot> => {
    const { data: row } = await db.from("boqs").select("id, sections, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).single();
    const { data: takeoff } = await db.from("takeoff_items").select("work_item_key, element_id, qty, unit").eq("project_id", projectId).like("work_item_key", "garden.%");
    const boq = row!.sections as Parameters<typeof snapshotOf>[0]["boq"] & { garden?: { draft?: { draft: boolean; derived: string[] } } };
    return snapshotOf({ capturedAt: String(row!.created_at), boqId: row!.id, boq, takeoff: takeoff ?? [], draft: { draft: boq.garden?.draft?.draft ?? false, derived: boq.garden?.draft?.derived ?? [] } });
  };
  const was = await snapshot();

  // --- the two front zones, back on the type plan ------------------------------------------
  const saved = await call("POST", "/api/update-plan", {
    plan_id: planId,
    rooms: rooms.map((r) => {
      const key = (r.spec as { ref_key?: string } | null)?.ref_key;
      const z = key ? target.get(key as (typeof FRONT_KEYS)[number]) : undefined;
      return {
        id: r.id,
        name_en: r.name_en,
        name_ar: r.name_ar,
        room_type: r.room_type,
        area_m2: z ? Math.round(polyArea(z.poly) * 100) / 100 : r.area_m2,
        polygon: z ? siteNormPath(z.poly) : r.polygon,
        unroofed: r.unroofed ?? true,
        dims_derived: z ? true : r.dims_derived ?? true,
        derived_note: z ? z.note : r.derived_note,
      };
    }),
    deleted_ids: [],
  });
  check("the plan saves with the front garden back on its type-plan footprint", saved.success === true && saved.has_overlaps === false, JSON.stringify(saved.overlap_pairs ?? []));

  // The assumption the pack's Design assumptions page prints.
  const assumption = `front garden on its type-plan derived footprint (2.2 × 4.0 m assumed); the session's ${unmapped.value} front-border measure is captured but NOT mapped — ${unmapped.why}`;
  for (const k of FRONT_KEYS) await call("PATCH", "/api/plan-zones", { id: byKey(k).id, spec: { ref_key: k, assumption, unmapped_measure: { key: unmapped.key, value: unmapped.value, source: "Newspace design session Sep 2026", status: "pending clarification" } } });

  // --- the garage/drive block, back to its notch --------------------------------------------
  const { data: ctx } = await db.from("plan_context").select("id, name, note").eq("plan_id", planId);
  const garage = (ctx ?? []).find((c) => c.name === "Garage / drive block")!;
  await call("PATCH", "/api/plan-context", {
    id: garage.id,
    polygon: siteNormPath(GARAGE_POLY),
    note: `${String(garage.note ?? "").split("; reshaped around")[0]}; notched around the type plan's front garden — drive ${DRIVE_WIDTH_M} m clear. The session's ${unmapped.value} front-border measure is not mapped (it would leave ~1.0 m); ${SOURCE_NOTE}`,
    dims_derived: true,
  });

  // --- the measure, recorded where it can be seen ---------------------------------------------
  await call("POST", "/api/pilot-events", {
    project_id: projectId,
    area: "measurement",
    note: `A measured figure that cannot be mapped is held, not applied: the ${unmapped.value} front border ${unmapped.why} The front garden stays on the type plan's derived footprint and the measure is flagged for clarification with the firm.`,
  });

  const gen = await call("POST", "/api/generate-boq", { project_id: projectId });
  check("the BoQ regenerates", !gen.error, `AED ${gen.grand_total_aed}`);
  const now = await snapshot();
  const report = changeReport(was, now);

  // --- what moved -------------------------------------------------------------------------------
  console.log(`\nUNMAPPED  ${unmapped.value} front border — ${unmapped.why}`);
  console.log(`  front garden ${before.map((b) => `${b.key} ${b.area}`).join(", ")} → ${FRONT_KEYS.map((k) => `${k} ${Math.round(polyArea(target.get(k)!.poly) * 100) / 100}`).join(", ")} m²; drive ${DRIVE_WIDTH_M} m`);
  const rec = reconciliation();
  console.log(`  grass ${rec.totals.grass.new} m² = ${rec.totals.grass.in_aggregate} in the measured aggregate (≈ ${rec.totals.grass.target}) + ${rec.totals.grass.outside_aggregate} front garden — ${rec.totals.grass.outside_note}`);
  console.log(`  tiled ${rec.totals.tiled.new} m² (≈ ${rec.totals.tiled.target}, unchanged); planting ${rec.totals.planting.new} m²`);
  console.log("\nCHANGE REPORT — cause: dimension update (reverted — measurement unmapped)");
  for (const m of report.moved) console.log(`  ${`${m.section} — ${m.description}`.slice(0, 68).padEnd(68)} ${String(m.old_qty ?? "—").padStart(8)} → ${String(m.new_qty ?? "—").padEnd(8)} ${m.unit.padEnd(5)} ${`${m.delta_aed >= 0 ? "+" : ""}${m.delta_aed}`.padStart(9)} AED`);
  console.log(`  BoQ ${report.boq.old_total_aed} → ${report.boq.new_total_aed} (${report.boq.delta_aed >= 0 ? "+" : ""}${report.boq.delta_aed}, ${report.boq.delta_pct}%)`);
  check("only the front garden's quantities moved", report.moved.every((m) => /grass|planting bed/i.test(m.description)), report.moved.map((m) => m.description.slice(0, 40)).join("; "));

  const { derivePlanGraph } = await import("../lib/plan/derive.ts");
  const { graphDraftStatus } = await import("../lib/plan/geometry.ts");
  const graph = await derivePlanGraph(projectId);
  const front = graph.rooms.filter((r) => /^Front garden/.test(r.name_en));
  check("both front zones are derived and say the measure is unmapped", front.length === 2 && front.every((r) => r.dims_derived && /NOT mapped|not mapped/i.test(String(r.derived_note ?? "") + JSON.stringify(r.spec ?? {}))), front.map((r) => `${r.name_en} ${r.area_m2}`).join("; "));
  check("the plan is still a DRAFT", graphDraftStatus(graph).draft === true);

  // Events this script caused are script-applied, not designer time.
  const { data: evs } = await db.from("pilot_events").select("id, detail").eq("project_id", projectId).gte("recorded_at", started);
  for (const e of evs ?? []) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (!d.stage) await db.from("pilot_events").update({ detail: { ...d, stage: "session_apply", source: "scripts/arabella-unmap-front-border.ts" } }).eq("id", e.id);
  }

  const out = {
    project_id: projectId,
    applied_at: started,
    unmapped: UNMAPPED_MEASURES,
    still_mapped: Object.fromEntries(Object.entries(SESSION_MEASURES).filter(([k]) => !UNMAPPED_MEASURES.some((u) => u.key === k))),
    front_garden: { before, after: FRONT_KEYS.map((k) => ({ key: k, area: Math.round(polyArea(target.get(k)!.poly) * 100) / 100 })), drive_width_m: DRIVE_WIDTH_M },
    reconciliation: rec.totals,
    change_report: { cause: "dimension update (reverted — measurement unmapped)", boq: report.boq, moved: report.moved },
    results,
  };
  writeFileSync(`${ROOT}/screenshots/garden-pilot/g5d-unmapped.json`, JSON.stringify(out, null, 2));
  const sessionPath = `${ROOT}/screenshots/garden-pilot/g5d-session.json`;
  if (existsSync(sessionPath)) {
    const j = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<string, unknown> & { stages: unknown[]; change_report: unknown[]; unmapped?: unknown };
    j.unmapped = UNMAPPED_MEASURES;
    j.stages.push({ label: "dimension update (reverted — front border unmapped)", boq_id: now.boq_id, grand_total_aed: now.grand_total_aed });
    j.change_report.push({ cause: "dimension update", note: `the ${unmapped.value} front-border measure is captured but not mapped — ${unmapped.why}`, boq: report.boq, moved: report.moved });
    writeFileSync(sessionPath, JSON.stringify(j, null, 2));
  }
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
