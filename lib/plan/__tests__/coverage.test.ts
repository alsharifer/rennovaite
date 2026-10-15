// "Rooms cover X of ~Y m² — a room may be missing" (plan check, 15 Oct).

import { describe, expect, it } from "vitest";

import { COVERAGE_MIN, floorCoverage, readingFloorEstimate } from "../coverage";

describe("floor coverage against the reading's whole-floor estimate", () => {
  it("Jumeirah Parks (prod, 15 Oct): 153.6 of ~185 m² warns", () => {
    const rooms = [38.5, 30, 22, 18.2, 18, 9, 7, 5.5, 5.4].map((a) => ({ area_m2: a, room_type: "living" }));
    const c = floorCoverage([...rooms, { area_m2: 60, room_type: "artificial_grass" }], readingFloorEstimate({ parse: { provider_total_area_m2: 185 } }))!;
    expect(c.covered_m2).toBeCloseTo(153.6, 9); // garden zones are not floor
    expect(c.ratio).toBeLessThan(COVERAGE_MIN);
    expect(c.sentence).toBe("Rooms cover 154 of ~185 m² — a room may be missing.");
  });

  it("at 90% or above it is quiet; with no estimate there is no check", () => {
    expect(floorCoverage([{ area_m2: 167, room_type: "living" }], 185)!.warn).toBe(false);
    expect(floorCoverage([{ area_m2: 100, room_type: "living" }], readingFloorEstimate({ parse: {} }))).toBeNull();
    expect(readingFloorEstimate(null)).toBeNull();
    // Balconies and terraces are interior rooms here, as everywhere else.
    expect(floorCoverage([{ area_m2: 100, room_type: "terrace" }], 100)!.covered_m2).toBe(100);
  });
});
