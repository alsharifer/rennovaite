import { describe, expect, it } from "vitest";

import {
  chainCloses,
  dimensionChain,
  envelopeDimensionMm,
} from "@/lib/drawings/dimensions";
import { buildPlanGraph } from "@/lib/plan/geometry";

import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";

describe("dimension chains close on the envelope (verification gate b)", () => {
  const graph = buildPlanGraph(MUDON_FIXTURE);

  for (const axis of ["x", "y"] as const) {
    it(`sum of internal ${axis}-axis dimensions === envelope ${axis} dimension`, () => {
      // Closure is exact in raw metres (telescoping grid lines). The mm-rounded
      // label sum may drift ≤1 mm per bay, which is cosmetic.
      expect(chainCloses(graph, axis)).toBe(true);
      const chain = dimensionChain(graph, axis);
      const sum = chain.reduce((s, d) => s + d.length_mm, 0);
      expect(Math.abs(sum - envelopeDimensionMm(graph, axis))).toBeLessThanOrEqual(
        chain.length,
      );
    });
  }

  it("chains are non-trivial (more than one bay)", () => {
    expect(dimensionChain(graph, "x").length).toBeGreaterThan(1);
    expect(dimensionChain(graph, "y").length).toBeGreaterThan(1);
  });

  // Synthetic two-room row: 3.0 m + 4.0 m rooms sharing a wall → 7.0 m envelope.
  it("closes on a hand-checked synthetic plan", () => {
    const g = buildPlanGraph({
      projectId: "t",
      planId: "t",
      scale: "1:100",
      total_area_m2: 7 * 3, // two 3 m-deep rooms, widths 3 + 4
      rooms: [
        { id: "a", name_en: "A", name_ar: null, room_type: "living", area_m2: 9, polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] },
        { id: "b", name_en: "B", name_ar: null, room_type: "living", area_m2: 12, polygon: [[3, 0], [7, 0], [7, 3], [3, 3]] },
      ],
    });
    // total_area 21 over normalised area 21 → unit_to_m = 1, so metres are 1:1.
    expect(envelopeDimensionMm(g, "x")).toBe(7000);
    const chain = dimensionChain(g, "x");
    expect(chain.map((d) => d.length_mm)).toEqual([3000, 4000]);
    expect(chainCloses(g, "x")).toBe(true);
  });
});
