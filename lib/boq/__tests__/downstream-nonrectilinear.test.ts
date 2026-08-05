import { describe, expect, it } from "vitest";

import { buildPlanGraph, type RawRoom } from "@/lib/plan/geometry";
import {
  DIAGONAL_SPLIT,
  L_SHAPE_WITH_NOTCH,
} from "@/lib/plan/__tests__/synthetic.fixtures";
import { repairOverlaps } from "@/lib/parse/repair";
import { buildScene } from "@/lib/viewer/scene";

import { computeTakeoff } from "../takeoff";
import { quantifyPlan } from "../quantify";
import type { EngineRoom } from "../schema";

const isDiagonal = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) > 1e-6 && Math.abs(a[1] - b[1]) > 1e-6;

describe("takeoff perimeter — true polygon, not fitted rectangle", () => {
  // Two bathrooms of equal area (16 m²): a square and an L. The L has a larger
  // true perimeter, so its perimeter-driven wet-wall tiling must be larger.
  const square: EngineRoom = {
    id: "b-sq", name: "Square Bath", room_type: "bathroom", area_m2: 16,
    polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
  const ell: EngineRoom = {
    id: "b-l", name: "L Bath", room_type: "bathroom", area_m2: 16,
    polygon: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]],
  };

  const tileQ = (r: EngineRoom) =>
    computeTakeoff([r], "porcelain").items.find(
      (i) => i.item_key === "wall.bath_tiling_labour",
    )?.quantity ?? 0;

  it("gives an L-shaped bath more wet-wall tiling than an equal-area square", () => {
    const qSquare = tileQ(square);
    const qL = tileQ(ell);
    expect(qSquare).toBeGreaterThan(0);
    expect(qL).toBeGreaterThan(qSquare);
  });
});

describe("downstream walk — non-rectilinear L-shape → BoQ + 3D", () => {
  // Real pipeline: repair (recomputes areas) → buildPlanGraph.
  const repaired = repairOverlaps(
    L_SHAPE_WITH_NOTCH.rooms.map((r) => ({
      id: r.id, polygon: r.polygon, area_m2: r.area_m2, confidence: r.confidence,
      name_en: r.name_en, name_ar: r.name_ar, room_type: r.room_type,
    })),
    { totalAreaM2: L_SHAPE_WITH_NOTCH.total_area_m2 },
  );
  const graph = buildPlanGraph({
    projectId: L_SHAPE_WITH_NOTCH.projectId,
    planId: L_SHAPE_WITH_NOTCH.planId,
    scale: "1:100",
    total_area_m2: L_SHAPE_WITH_NOTCH.total_area_m2,
    rooms: repaired.rooms as unknown as RawRoom[],
  });

  it("quantifyPlan consumes it without error and yields finite quantities", () => {
    const items = quantifyPlan(graph);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(Number.isFinite(it.qty)).toBe(true);
      expect(it.qty).toBeGreaterThanOrEqual(0);
    }
  });

  it("buildScene renders both rooms + walls without error", () => {
    const scene = buildScene(graph);
    expect(scene.isEmpty).toBe(false);
    expect(scene.floors).toHaveLength(2);
    expect(scene.wallCount).toBeGreaterThan(0);
  });
});

describe("downstream walk — diagonal plan renders a diagonal wall in 3D", () => {
  it("buildScene emits a diagonal wall segment for the split plan", () => {
    const graph = buildPlanGraph(DIAGONAL_SPLIT);
    const scene = buildScene(graph);
    expect(scene.wallSegments.some((s) => isDiagonal(s.a, s.b))).toBe(true);
  });
});
