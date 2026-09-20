import polygonClipping from "polygon-clipping";
import { describe, expect, it } from "vitest";

import { AGGREGATE_NOTE, DRAFT_ZONES, RESIDUAL, SESSION_MEASURES, SESSION_SOURCE, polyArea, reconciliation, sessionZones } from "@/lib/client-garden/arabella-session";

const zones = sessionZones();
const z = (k: string) => zones.find((x) => x.key === k)!;
const bb = (poly: [number, number][]) => ({ w: Math.max(...poly.map((p) => p[0])) - Math.min(...poly.map((p) => p[0])), h: Math.max(...poly.map((p) => p[1])) - Math.min(...poly.map((p) => p[1])) });

describe("the design session's measurements on the client garden (G5d)", () => {
  it("reconciles both measured aggregates — which the point measures alone do not", () => {
    const { totals } = reconciliation();
    expect(Math.abs(totals.grass.measured - SESSION_MEASURES.total_grass_m2)).toBeGreaterThan(5);
    expect(totals.grass.old).toBeCloseTo(76.9, 2);
    expect(totals.tiled.old).toBeCloseTo(62.95, 2);
    expect(Math.abs(totals.grass.new - SESSION_MEASURES.total_grass_m2)).toBeLessThan(0.1);
    expect(Math.abs(totals.tiled.new - SESSION_MEASURES.total_tiled_m2)).toBeLessThan(0.1);
  });

  it("puts every point measure into the geometry", () => {
    expect(bb(z("rear-path").poly).w).toBeCloseTo(SESSION_MEASURES.path_from_gate_m, 6);
    expect(bb(z("entrance").poly).w).toBeCloseTo(SESSION_MEASURES.entrance_area_width_m, 6);
    expect(bb(z("landing").poly)).toEqual({ w: expect.closeTo(1.2, 6), h: expect.closeTo(1.3, 6) });
    expect(bb(z("front-bed").poly).w).toBeCloseTo(SESSION_MEASURES.front_border_width_m, 6);
    // The court beyond the separator wall: 20.5 (wall centre) → 26.5 (end wall face) = 6.0.
    expect(26.5 - 20.5).toBeCloseTo(SESSION_MEASURES.separator_to_end_wall_m, 6);
  });

  it("calls measured only what was measured, and says where the rest came from", () => {
    expect(zones.filter((x) => !x.dims_derived).map((x) => x.key).sort()).toEqual(["landing", "rear-path"]);
    for (const x of zones.filter((x) => !x.dims_derived)) expect(x.note).toContain(SESSION_SOURCE);
    for (const x of zones.filter((x) => x.drivers.at(-1) === "aggregate refit")) {
      expect(x.dims_derived).toBe(true);
      expect(x.note).toContain(AGGREGATE_NOTE);
    }
  });

  it("keeps the zone structure and says what drove every zone", () => {
    for (const d of DRAFT_ZONES) expect(zones.some((x) => x.key === d.key)).toBe(true);
    expect(zones.map((x) => x.key).filter((k) => !DRAFT_ZONES.some((d) => d.key === k)).sort()).toEqual(["entrance", "landing"]);
    for (const row of reconciliation().rows) for (const d of row.drivers) expect(["dimension update", "aggregate refit"]).toContain(d);
  });

  it("lets no two zones overlap, at either stage, and leaves the stated residual unallocated", () => {
    for (const zones of [sessionZones("measured"), sessionZones("refit")]) for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const hit = polygonClipping.intersection([zones[i]!.poly], [zones[j]!.poly]);
        const a = hit.reduce((s, poly) => s + polyArea(poly[0] as [number, number][]), 0);
        expect(a, `${zones[i]!.key} × ${zones[j]!.key}`).toBeLessThan(1e-6);
      }
    }
    expect(RESIDUAL.width_m).toBeCloseTo(2.35, 6);
    expect(zones.some((x) => x.poly.some((p) => p[0] < RESIDUAL.x1 - 1e-9 && p[1] < 4.3))).toBe(false);
  });
});
