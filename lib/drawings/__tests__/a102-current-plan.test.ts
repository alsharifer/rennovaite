// Sprint C2 #2 + #3 — A-102 is never built from a stale snapshot, and a sheet
// that cannot be drawn names itself and the field.
//
// Mudon's export failed for a month with a bare "Cannot read properties of
// undefined (reading 'map')": A-102 was drawn from its 29 Jul design-lock
// snapshot, which predates PR #57's `elements`. Ruled 21 Oct: the proposed
// layout is the CURRENT plan at export, and demolition is never inferred from a
// snapshot diff (the snapshots predate the parse corrections — Jumeirah rev 2
// priced 342.75 m² of walls nobody is removing).

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import mudon from "@/lib/boq/__fixtures__/c1-mudon-latest.json";
import { ROOT } from "@/lib/__tests__/helpers/import-graph";
import { buildPlanGraph, normaliseGraph, type PlanGraph } from "@/lib/plan/geometry";
import { metresPerUnit, openingsOnWalls } from "@/lib/plan/plan-rules";

import snapshot from "../__fixtures__/mudon-proposed-snapshot-29jul.json";
import { renderDemoSheet } from "../demo-sheet";
import { buildInteriorSheets } from "../export";
import { proposedBasis, type SheetMeta } from "../sheet";
import { drawSheet, SheetBuildError } from "../sheet-errors";

/** Mudon's current plan, as derivePlanGraph builds it from the prod rows. */
function mudonPlan(): PlanGraph {
  const fx = mudon as unknown as { project: { id: string }; plan: { id: string; total_area_m2: number }; rooms: { id: string; name_en: string; room_type: string; area_m2: number; polygon: unknown; unroofed: boolean }[]; openings: { id: string; kind: string; width_mm: number; height_mm: number; sill_mm: number; position: unknown; room_id: string; source: string; derived: boolean; confirmed_at: string | null }[] };
  const rooms = fx.rooms.map((r) => ({ id: r.id, name_en: r.name_en, name_ar: null, room_type: r.room_type, area_m2: r.area_m2, polygon: r.polygon, unroofed: r.unroofed }));
  const mPerU = metresPerUnit(rooms, fx.plan.total_area_m2);
  const on = new Set(openingsOnWalls(fx.openings.map((o) => ({ id: o.id, kind: o.kind, width_mm: o.width_mm, position: o.position, room_id: o.room_id })), rooms, mPerU).map((o) => o.id));
  return buildPlanGraph({ projectId: fx.project.id, planId: fx.plan.id, scale: null, total_area_m2: fx.plan.total_area_m2, rooms, openings: fx.openings.filter((o) => on.has(o.id)).map((o) => ({ id: o.id, type: o.kind, width_mm: o.width_mm, height_mm: o.height_mm, sill_mm: o.sill_mm, position: o.position, source: o.source, derived: o.derived, room_id: o.room_id })) } as never);
}

const META: SheetMeta = { projectNameEn: "Mudon pilot villa", community: "Dubai", level: "first floor", scale: "1:100", dateISO: "2026-10-21", rev: "23" };

describe("A-102 is drawn from the current plan at export", () => {
  const sheets = buildInteriorSheets(mudonPlan(), META, null);

  it("Mudon's interior set builds — the sheet that failed for a month included", () => {
    expect(sheets.map((s) => s.sheetNumber)).toEqual(expect.arrayContaining(["A-101", "A-102", "A-201"]));
  });

  it("its title block reads 'Proposed as of rev N · date', and no demolition is inferred", () => {
    const a102 = sheets.find((s) => s.sheetNumber === "A-102")!.svg;
    expect(proposedBasis("23", "2026-10-21")).toBe("Proposed as of rev 23 · 21 Oct 2026");
    expect(a102).toContain('data-basis="Proposed as of rev 23 · 21 Oct 2026"');
    expect(a102).toContain('data-no-demolition="true"');
    // Only A-102 says what it was drawn from.
    for (const s of sheets.filter((x) => x.sheetNumber !== "A-102")) expect(s.svg).not.toContain("data-basis=");
  });

  it("never from a snapshot: the drawing set and the BoQ read no plan_snapshots graph", () => {
    const exportSrc = readFileSync(path.join(ROOT, "lib/drawings/export.ts"), "utf8");
    expect(exportSrc).not.toMatch(/plan_snapshots|getProposedGraph|loadProposedGraph/);
    const assembleSrc = readFileSync(path.join(ROOT, "lib/boq/assemble.ts"), "utf8");
    expect(assembleSrc).not.toMatch(/getProposedGraph|lib\/plan\/snapshots/);
    expect(assembleSrc).toMatch(/takeoffItems = quantifyPlan\(graph\);/);
  });
});

describe("old snapshots and named failures", () => {
  const stale = (snapshot as unknown as { graph: PlanGraph }).graph;

  it("the 29 Jul snapshot lacks `elements` and `context` — drawn raw it fails, named, never a bare TypeError", () => {
    expect(() => renderDemoSheet(stale, stale, META, { sheetNumber: "A-102", title: "Proposed / Demolition Plan" })).toThrow(/reading 'map'/);
    let err: unknown;
    try {
      drawSheet("A-102", "Proposed / Demolition Plan", [stale], () => renderDemoSheet(stale, stale, META, { sheetNumber: "A-102", title: "Proposed / Demolition Plan" }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SheetBuildError);
    expect((err as SheetBuildError).message).toBe('Sheet A-102 "Proposed / Demolition Plan" could not be drawn: the plan graph has no `elements`');
    expect((err as SheetBuildError).field).toBe("elements");
  });

  it("read through normaliseGraph, the same snapshot draws (Mudon's historical sheet can still be printed)", () => {
    const { graph, filled } = normaliseGraph(stale);
    expect(filled).toEqual(["elements", "context"]);
    expect(() => renderDemoSheet(graph, graph, { ...META, basis: "Proposed as of 29 Jul 2026 (design-lock snapshot)" }, { sheetNumber: "A-102", title: "Proposed / Demolition Plan" })).not.toThrow();
  });

  it("any other failure inside a sheet names the sheet and the value it read", () => {
    const broken = { ...mudonPlan(), walls: [{ id: "w", polyline: null }] } as unknown as PlanGraph;
    expect(() => buildInteriorSheets(broken, META, null)).toThrow(/^Sheet A-101 "As-Built Plan" could not be drawn: /);
  });
});
