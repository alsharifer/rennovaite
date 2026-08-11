import { describe, expect, it } from "vitest";

import { quantifyPlan } from "@/lib/boq/quantify";
import { buildPlanGraph, type BuildPlanGraphInput } from "@/lib/plan/geometry";

// Two 50 m² rooms sharing a vertical party wall at x=0.5 → 10 m × 10 m metric.
const base: BuildPlanGraphInput = {
  projectId: "p",
  planId: "pl",
  scale: "1:100",
  total_area_m2: 100,
  rooms: [
    { id: "a", name_en: "A", name_ar: null, room_type: "living", area_m2: 50, polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] },
    { id: "b", name_en: "B", name_ar: null, room_type: "bedroom", area_m2: 50, polygon: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] },
  ],
};

describe("buildPlanGraph — openings ingestion (A3/A5)", () => {
  it("is empty (flagged) when no openings are supplied", () => {
    const g = buildPlanGraph(base);
    expect(g.openings).toEqual([]);
    expect(g.derived.openings_empty).toBe(true);
  });

  it("ingests an opening, defaults its dimensions (derived), and snaps it to the nearest wall", () => {
    const g = buildPlanGraph({
      ...base,
      openings: [{ id: "o1", type: "door", position: [0.5, 0.5] }],
    });
    expect(g.openings).toHaveLength(1);
    expect(g.derived.openings_empty).toBe(false);
    const o = g.openings[0]!;
    expect(o.type).toBe("door");
    expect(o.width_mm).toBe(900); // standard door default
    expect(o.height_mm).toBe(2100);
    expect(o.derived).toBe(true); // dimensions defaulted, not measured
    expect(o.wall_id).not.toBeNull();
    // Position converts to metric (plan is 10 m; midpoint ≈ [5,5]).
    expect(o.position![0]).toBeCloseTo(5, 1);
    expect(o.position![1]).toBeCloseTo(5, 1);
    // Snapped to a vertical wall at x≈5 → about halfway along it.
    expect(o.along_offset).toBeCloseTo(0.5, 1);
  });

  it("keeps measured dimensions non-derived", () => {
    const g = buildPlanGraph({
      ...base,
      openings: [{ id: "o1", type: "window", position: [0.5, 0.3], width_mm: 1500, height_mm: 1400, source: "parsed" }],
    });
    const o = g.openings[0]!;
    expect(o.width_mm).toBe(1500);
    expect(o.derived).toBe(false);
    expect(o.source).toBe("parsed");
  });
});

describe("quantify — net wall quantities deduct opening area", () => {
  it("reduces the opening's wall plaster/paint by the opening area", () => {
    const withOpening = buildPlanGraph({
      ...base,
      openings: [{ id: "o1", type: "door", position: [0.5, 0.5] }],
    });
    const o = withOpening.openings[0]!;
    const plasterFor = (graph: ReturnType<typeof buildPlanGraph>, wallId: string) =>
      quantifyPlan(graph).find((it) => it.work_item_key === "wall_plaster" && it.element_id === wallId)?.qty ?? null;

    const gross = plasterFor(buildPlanGraph(base), o.wall_id!); // same wall, no opening
    const net = plasterFor(withOpening, o.wall_id!);
    expect(gross).not.toBeNull();
    expect(net).not.toBeNull();
    // Door 0.9×2.1 = 1.89 m² deducted.
    expect(gross! - net!).toBeCloseTo(1.89, 1);
  });
});
