import { describe, expect, it } from "vitest";

import { buildScene } from "@/lib/viewer/scene";
import { buildPlanGraph } from "@/lib/plan/geometry";

import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";

describe("buildScene — Mudon", () => {
  const graph = buildPlanGraph(MUDON_FIXTURE);
  const scene = buildScene(graph);

  it("reports the source wall count and one box per wall (no openings)", () => {
    expect(scene.wallCount).toBe(graph.walls.length);
    expect(scene.wallCount).toBe(59);
    // Mudon has no openings → exactly one box per wall.
    expect(scene.walls).toHaveLength(graph.walls.length);
    expect(scene.isEmpty).toBe(false);
  });

  it("has one floor slab + one label per room", () => {
    expect(scene.floors).toHaveLength(13);
    expect(scene.labels).toHaveLength(13);
  });

  it("box lengths equal the 2D wall dimensions (measure matches within 1 cm)", () => {
    const byId = new Map(scene.walls.map((w) => [w.id, w]));
    for (const w of graph.walls) {
      const [a, b] = w.polyline;
      const planLen = Math.hypot(b![0] - a![0], b![1] - a![1]);
      const box = byId.get(w.id)!;
      // 3D box length must match the 2D wall length far under 1 cm.
      expect(Math.abs(box.size[0] - planLen)).toBeLessThan(0.001);
    }
  });

  it("carries true wall thickness + derived flags, centred bounds", () => {
    expect(scene.walls.every((w) => Math.abs(w.size[2] - 0.2) < 1e-9)).toBe(true);
    expect(scene.walls.every((w) => w.derived === true)).toBe(true);
    expect(scene.bounds.center).toEqual([0, 0]);
    expect(scene.bounds.size[0]).toBeCloseTo(graph.meta.envelope_m.width, 6);
    expect(scene.bounds.size[1]).toBeCloseTo(graph.meta.envelope_m.depth, 6);
  });

  it("tints floors from the finishes map when provided", () => {
    const first = graph.rooms[0]!.id;
    const tinted = buildScene(graph, { floorColorByRoom: { [first]: "#123456" } });
    expect(tinted.floors.find((f) => f.roomId === first)!.color).toBe("#123456");
  });

  it("empty graph → isEmpty, no walls (viewer shows its empty state)", () => {
    const empty = buildScene(
      buildPlanGraph({ projectId: "x", planId: null, scale: null, total_area_m2: null, rooms: [] }),
    );
    expect(empty.isEmpty).toBe(true);
    expect(empty.walls).toHaveLength(0);
  });
});
