import polygonClipping from "polygon-clipping";
import { describe, expect, it } from "vitest";

import { AGGREGATE_NOTE, DRAFT_ZONES, DRIVE_WIDTH_M, GARAGE_POLY, RESIDUAL, SESSION_MEASURES, SESSION_SOURCE, UNMAPPED_MEASURES, polyArea, reconciliation, sessionZones } from "@/lib/client-garden/arabella-session";

const zones = sessionZones();
const z = (k: string) => zones.find((x) => x.key === k)!;
const bb = (poly: [number, number][]) => ({ w: Math.max(...poly.map((p) => p[0])) - Math.min(...poly.map((p) => p[0])), h: Math.max(...poly.map((p) => p[1])) - Math.min(...poly.map((p) => p[1])) });

describe("the design session's measurements on the client garden (G5d)", () => {
  it("reconciles the tiled aggregate exactly and the grass aggregate over the zones it covers", () => {
    const { totals } = reconciliation();
    expect(Math.abs(totals.grass.measured - SESSION_MEASURES.total_grass_m2)).toBeGreaterThan(5);
    expect(totals.grass.old).toBeCloseTo(76.9, 2);
    expect(totals.tiled.old).toBeCloseTo(62.95, 2);
    expect(Math.abs(totals.tiled.new - SESSION_MEASURES.total_tiled_m2)).toBeLessThan(0.1);
    // The front garden's lawn is outside the aggregate while the border measure is
    // unmapped; the rest lands within 5% of the ≈ 50 m² the session gave.
    expect(totals.grass.outside_aggregate).toBeCloseTo(6.4, 2);
    expect(totals.grass.in_aggregate).toBeCloseTo(47.82, 2);
    expect(Math.abs(totals.grass.in_aggregate - SESSION_MEASURES.total_grass_m2) / SESSION_MEASURES.total_grass_m2).toBeLessThan(0.05);
    expect(totals.grass.new).toBeCloseTo(totals.grass.in_aggregate + totals.grass.outside_aggregate, 6);
  });

  it("puts every MAPPED point measure into the geometry", () => {
    expect(bb(z("rear-path").poly).w).toBeCloseTo(SESSION_MEASURES.path_from_gate_m, 6);
    expect(bb(z("entrance").poly).w).toBeCloseTo(SESSION_MEASURES.entrance_area_width_m, 6);
    expect(bb(z("landing").poly)).toEqual({ w: expect.closeTo(1.2, 6), h: expect.closeTo(1.3, 6) });
    // The court beyond the separator wall: 20.5 (wall centre) → 26.5 (end wall face) = 6.0.
    expect(26.5 - 20.5).toBeCloseTo(SESSION_MEASURES.separator_to_end_wall_m, 6);
  });

  it("holds the front-border measure UNMAPPED: the front garden keeps its type-plan footprint and the drive a plausible width", () => {
    const unmapped = UNMAPPED_MEASURES.find((u) => u.key === "front_border_width_m")!;
    expect(unmapped.value).toBe(`${SESSION_MEASURES.front_border_width_m} m`);
    expect(unmapped.why).toMatch(/drive/);
    // No zone is 5.3 m wide, and both front zones are exactly as the type plan drafts them.
    for (const x of zones) expect(bb(x.poly).w).not.toBeCloseTo(SESSION_MEASURES.front_border_width_m, 2);
    for (const key of ["front-lawn", "front-bed"]) {
      expect(z(key).poly).toEqual(DRAFT_ZONES.find((d) => d.key === key)!.poly);
      expect(z(key).drivers).toEqual([]);
      expect(z(key).dims_derived).toBe(true);
      expect(z(key).note).toMatch(/CAPTURED BUT NOT MAPPED/);
    }
    // The drive is the garage block less the front garden: 4.1 m, not the 1.0 m the measure gave.
    expect(DRIVE_WIDTH_M).toBeCloseTo(4.1, 6);
    expect(GARAGE_POLY).toContainEqual([2.2, 10.5]);
    expect(GARAGE_POLY.some((p) => p[0] === SESSION_MEASURES.front_border_width_m)).toBe(false);
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
