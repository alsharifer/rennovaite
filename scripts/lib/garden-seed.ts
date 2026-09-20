// =============================================================================
// scripts/lib/garden-seed.ts — seed the traced Villa 94 garden into a project
// through the real routes (garden pilot G3/G4/G4b).
//
// Shared by the live dry-run (the ground-truth project) and the isolation check
// (a stand-in project seeded from the same records, so every zone name, id
// pattern, camera and scene is identical and only the project differs).
//
// Writes only to the given project. Destructive within it: the plan's zones,
// elements, fixtures and context are replaced.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { villa94PlanRecords } from "../../lib/ground-truth/villa94-garden-geometry.ts";
import { PLOT, VILLA94_GARDEN } from "../../lib/ground-truth/villa94-garden-plan.ts";

export type Check = (label: string, ok: boolean, detail?: string) => void;

export async function seedVilla94Garden(db: SupabaseClient, base: string, projectId: string, check: Check, opts: { styleKey?: string } = {}) {
  const post = async (p: string, b: unknown) =>
    (await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();

  // --- 1. an authored plan at the traced plot size -------------------------------
  let { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).maybeSingle<{ id: string }>();
  if (!plan) {
    const { data } = await db
      .from("plans")
      .insert({ project_id: projectId, pdf_url: null, source: "user_drawn", plot_width_m: PLOT.width_m, plot_depth_m: PLOT.depth_m, total_area_m2: 0 })
      .select("id")
      .single<{ id: string }>();
    plan = data!;
  } else {
    await db.from("plans").update({ source: "user_drawn", plot_width_m: PLOT.width_m, plot_depth_m: PLOT.depth_m }).eq("id", plan.id);
  }
  const planId = plan!.id;

  // --- 2. zones at their traced polygons --------------------------------------------
  // Renders hang off rooms; a re-seed starts the zone renders over.
  await db.from("renders").delete().eq("project_id", projectId);
  await db.from("rooms").delete().eq("plan_id", planId);
  const records = villa94PlanRecords();
  const roomUuid = new Map(records.rooms.map((r) => [r.id, crypto.randomUUID()]));
  const saved = await post("/api/update-plan", {
    plan_id: planId,
    rooms: records.rooms.map((r) => ({ id: roomUuid.get(r.id), name_en: r.name_en, name_ar: r.name_ar, room_type: r.room_type, area_m2: r.area_m2, polygon: r.polygon, unroofed: r.unroofed })),
    deleted_ids: [],
  });
  check("zones save through /api/update-plan", saved.success === true, JSON.stringify(saved).slice(0, 160));
  check("the true traced geometry has no overlaps", saved.has_overlaps === false, JSON.stringify(saved.overlap_pairs ?? []));

  // Derived areas, levels, structure heights and specs live on the zone (035/036).
  // The editor does not author them, so they are written beside the save.
  let zoneFieldsOk = true;
  for (const r of records.rooms) {
    const { error } = await db
      .from("rooms")
      .update({ area_derived_m2: r.area_derived_m2, derived_note: r.derived_note, level_mm: r.level_mm, height_mm: r.height_mm, spec: r.spec })
      .eq("id", roomUuid.get(r.id)!);
    if (error) {
      zoneFieldsOk = false;
      check(`zone fields persist on ${r.name_en}`, false, error.message);
    }
  }
  check("derived areas, levels, heights and specs persist on every zone", zoneFieldsOk);

  const { data: storedRooms } = await db.from("rooms").select("id, name_en, area_m2, polygon").eq("plan_id", planId);
  const areaByName = new Map((storedRooms ?? []).map((r) => [r.name_en as string, Number(r.area_m2)]));
  check("every traced area round-trips exactly", VILLA94_GARDEN.zones.every((z) => areaByName.get(z.name) === z.area_m2));
  const polyById = new Map((storedRooms ?? []).map((r) => [r.id as string, JSON.stringify(r.polygon)]));
  check("every polygon round-trips unchanged (no overlap repair moved a vertex)", records.rooms.every((r) => polyById.get(roomUuid.get(r.id)!) === JSON.stringify(r.polygon)));

  // --- 3. runs with their cross-sections and build-up ------------------------------------
  await db.from("plan_elements").delete().eq("plan_id", planId);
  for (const run of records.elements) {
    const res = await post("/api/plan-elements", {
      plan_id: planId,
      kind: run.kind,
      polyline: run.polyline,
      height_mm: run.height_mm,
      width_mm: run.width_mm,
      ...(run.variant ? { variant: run.variant } : {}),
    });
    if (res.error) check(`run ${run.id} persists`, false, res.error);
    const elementId = res.element?.id ?? res.id;
    if (elementId) {
      const { error } = await db.from("plan_elements").update({ spec: run.spec, derived: false }).eq("id", elementId);
      if (error) check(`run ${run.id} spec persists`, false, error.message);
    }
  }
  const { data: storedRuns } = await db.from("plan_elements").select("kind, variant, height_mm, width_mm, spec").eq("plan_id", planId);
  check("all four runs persist", (storedRuns ?? []).length === 4, String((storedRuns ?? []).length));
  check(
    "counter variants persist",
    (storedRuns ?? []).filter((r) => r.variant === "bbq").length === 1 && (storedRuns ?? []).filter((r) => r.variant === "bar").length === 1,
    JSON.stringify((storedRuns ?? []).map((r) => r.variant)),
  );
  check("run heights and build-up persist", (storedRuns ?? []).every((r) => r.height_mm != null && r.spec != null), JSON.stringify((storedRuns ?? []).map((r) => r.height_mm)));

  // --- 4. units + lighting points at their placed positions -----------------------------
  await db.from("plan_fixtures").delete().eq("project_id", projectId);
  const fixtures = records.fixtures.map((f) => ({
    project_id: projectId,
    layer: f.layer,
    type: f.type,
    room_id: f.room_id ? (roomUuid.get(f.room_id) ?? null) : null,
    position: f.position,
    spec: f.spec,
    source: "user",
  }));
  check("every lighting point is marked as designed", fixtures.filter((f) => f.layer === "electrical").every((f) => (f.spec as { source?: string } | null)?.source === "as_designed"));
  const ins = await db.from("plan_fixtures").insert(fixtures);
  check("units + points persist", !ins.error, ins.error?.message ?? `${fixtures.length} rows`);

  // --- 5. existing context: villa, garage, pergola, steps, boundary walls -----------------
  await db.from("plan_context").delete().eq("plan_id", planId);
  const ctx = await db.from("plan_context").insert(records.context.map((c) => ({ plan_id: planId, kind: c.kind, name: c.name, polygon: c.polygon, base_mm: c.base_mm, height_mm: c.height_mm, derived: c.derived, note: c.note, source: "traced" })));
  check("existing context persists (villa, garage, pergola, steps, walls)", !ctx.error, ctx.error?.message ?? `${records.context.length} volumes`);

  // --- 6. a direction to render in ----------------------------------------------------------
  const { data: styleRows } = await db.from("style_choices").select("style_key").eq("project_id", projectId).is("room_id", null).limit(1);
  if (!styleRows || styleRows.length === 0) {
    const sc = await post("/api/style-choice", { project_id: projectId, style_key: opts.styleKey ?? "desert-modern" });
    check("a garden direction is locked", !sc.error, sc.error ?? opts.styleKey ?? "desert-modern");
  }

  return { planId, records, roomUuid };
}
