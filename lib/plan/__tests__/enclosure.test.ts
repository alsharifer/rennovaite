import { describe, expect, it } from "vitest";

import { buildPlanGraph, type BuildPlanGraphInput } from "@/lib/plan/geometry";
import { quantifyPlan } from "@/lib/boq/quantify";
import { buildScene } from "@/lib/viewer/scene";

/**
 * A two-zone garden on a measured 20 × 10 m plot.
 *
 * Normalised space runs x ∈ [0, 1] across the plot width, so unit_to_m is
 * exactly 20. Paving occupies the left 8 m × 6 m = 48 m²; lawn the right
 * 8 m × 6 m = 48 m². They share one edge, and neither reaches the plot boundary
 * — a garden's zones do not tile the site, which is precisely why the area-
 * derived scale is wrong for them.
 */
const PLOT_W = 20;
const zone = (
  id: string,
  room_type: string,
  x0: number,
  x1: number,
  area_m2: number,
) => ({
  id,
  name_en: id,
  name_ar: null,
  room_type,
  area_m2,
  polygon: [
    [x0, 0.05],
    [x1, 0.05],
    [x1, 0.35],
    [x0, 0.35],
  ],
});

const GARDEN: BuildPlanGraphInput = {
  projectId: "p1",
  planId: "pl1",
  scale: null,
  total_area_m2: 96,
  unit_to_m: PLOT_W,
  source: "user_drawn",
  // 0.10 → 0.50 is 0.4 units = 8 m wide; 0.05 → 0.35 is 0.3 units = 6 m deep.
  rooms: [
    zone("paving", "paving", 0.1, 0.5, 48),
    zone("lawn", "artificial_grass", 0.5, 0.9, 48),
  ],
};

describe("authored plan — a measured scale is a measurement", () => {
  const graph = buildPlanGraph(GARDEN);

  it("uses the plot width verbatim instead of inferring one from area", () => {
    expect(graph.meta.unit_to_m).toBe(PLOT_W);
    expect(graph.meta.source).toBe("user_drawn");
    expect(graph.derived.metric_scale).toBe(false);
  });

  it("does not inflate zones to fill the plot", () => {
    // The old area-derived factor is sqrt(total_area / normalised_area). Here
    // that is sqrt(96 / 0.24) = 20, which happens to coincide — so check the
    // geometry instead: each zone must measure 8 × 6 m, not stretch to the plot.
    const paving = graph.rooms.find((r) => r.id === "paving")!;
    const xs = paving.polygon.map((p) => p[0]);
    const ys = paving.polygon.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(8, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6, 6);
  });

  it("stops calling the polygon derived once the scale is measured", () => {
    for (const r of graph.rooms) {
      expect(r.derived_fields).not.toContain("polygon");
    }
  });
});

describe("open-edge enclosure", () => {
  it("emits no wall anywhere on a garden of unroofed zones", () => {
    const graph = buildPlanGraph(GARDEN);
    // Both zones are unroofed, including the edge they share: a lawn meeting a
    // paved area is a change of surface, not a wall.
    expect(graph.walls).toHaveLength(0);
    expect(graph.rooms.every((r) => r.unroofed)).toBe(true);
    expect(graph.rooms.every((r) => r.ceiling_h_m === 0)).toBe(true);
  });

  it("keeps the wall where an unroofed zone abuts a roofed room", () => {
    const graph = buildPlanGraph({
      ...GARDEN,
      rooms: [
        // A living room where the paving was: the shared edge is now a real
        // house wall that the terrace/lawn abuts, and it must survive.
        { ...zone("living", "living", 0.1, 0.5, 48), room_type: "living" },
        zone("lawn", "artificial_grass", 0.5, 0.9, 48),
      ],
    });
    expect(graph.walls.length).toBeGreaterThan(0);
    // Every emitted wall touches the roofed room; none is a lawn-only edge.
    expect(graph.walls.every((w) => w.room_ids.includes("living"))).toBe(true);
    expect(graph.walls.some((w) => w.room_ids.length === 2)).toBe(true);
  });

  it("respects an explicit unroofed flag over the type default", () => {
    const covered = buildPlanGraph({
      ...GARDEN,
      rooms: GARDEN.rooms.map((r) => ({ ...r, unroofed: false })),
    });
    expect(covered.walls.length).toBeGreaterThan(0);
    expect(covered.rooms.every((r) => r.ceiling_h_m > 0)).toBe(true);

    const opened = buildPlanGraph({
      ...GARDEN,
      rooms: [{ ...zone("hall", "living", 0.1, 0.5, 48), unroofed: true }],
    });
    expect(opened.walls).toHaveLength(0);
  });

  it("gives a drawn boundary wall exactly one wall per segment", () => {
    const graph = buildPlanGraph({
      ...GARDEN,
      elements: [
        {
          id: "bw1",
          kind: "boundary_wall",
          // Two segments along the site's north edge: 0.4 + 0.4 units = 16 m.
          polyline: [
            [0.05, 0.02],
            [0.45, 0.02],
            [0.85, 0.02],
          ],
        },
      ],
    });
    expect(graph.walls).toHaveLength(2);
    expect(graph.walls.every((w) => w.source === "drawn")).toBe(true);
    // A drawn wall is a measured line, not an inference from polygon edges.
    expect(graph.walls.every((w) => w.derived === false)).toBe(true);
    expect(graph.elements[0]!.length_m).toBe(16);
  });

  it("still derives interior walls exactly as before the pilot", () => {
    const interior = buildPlanGraph({
      projectId: "p2",
      planId: "pl2",
      scale: "1:100",
      total_area_m2: 96,
      rooms: [
        zone("living", "living", 0.1, 0.5, 48),
        zone("bed", "bedroom", 0.5, 0.9, 48),
      ],
    });
    expect(interior.meta.source).toBe("parsed");
    expect(interior.derived.metric_scale).toBe(true);
    expect(interior.walls.length).toBeGreaterThan(0);
    expect(interior.walls.every((w) => w.source === "derived")).toBe(true);
    expect(interior.rooms.every((r) => r.unroofed === false)).toBe(true);
    expect(interior.rooms.every((r) => r.ceiling_h_m === 2.9)).toBe(true);
  });
});

describe("open zones downstream", () => {
  it("leaves an outdoor zone entirely to the landscape take-off", () => {
    const items = quantifyPlan(buildPlanGraph(GARDEN));
    // G3: the interior quantifier emits nothing at all for an outdoor zone —
    // not a ceiling (there is none) and not a floor either, because the zone's
    // surface is priced as PCC + paving + tile or as grass. An interior
    // floor_finish line here charged for the same ground twice.
    expect(items.some((i) => i.work_item_key === "ceiling_finish")).toBe(false);
    expect(items.some((i) => i.work_item_key === "floor_finish")).toBe(false);
    // No walls means no plaster or paint, without anyone filtering for it.
    expect(items.some((i) => i.work_item_key === "wall_plaster")).toBe(false);
    expect(items).toEqual([]);
  });

  it("still quantifies a terrace as the interior room it is", () => {
    // `terrace` and `balcony` are enclosed rooms the parser already emits and
    // EXTERNAL_TYPES already prices. They must not follow outdoor zones out of
    // the interior quantifier, or every villa parsed before the garden pilot
    // would lose its terrace floor.
    const t = buildPlanGraph({
      ...GARDEN,
      rooms: [{ ...zone("terr", "terrace", 0.1, 0.5, 48), unroofed: false }],
    });
    const items = quantifyPlan(t);
    expect(items.some((i) => i.work_item_key === "floor_finish")).toBe(true);
  });

  it("renders open zones as ground and a structure with a canopy", () => {
    const scene = buildScene(
      buildPlanGraph({
        ...GARDEN,
        rooms: [...GARDEN.rooms, zone("pergola", "structure", 0.55, 0.75, 12)],
      }),
    );
    expect(scene.walls).toHaveLength(0);
    // A garden is not an empty scene just because it has no walls.
    expect(scene.isEmpty).toBe(false);
    expect(scene.floors.filter((f) => f.elevation === 0)).toHaveLength(3);
    const canopy = scene.floors.find((f) => f.elevation > 0);
    expect(canopy?.roomId).toBe("pergola");
    expect(canopy?.elevation).toBeGreaterThan(2);
  });

  it("extrudes a drawn boundary wall to its own height, not a room ceiling", () => {
    const scene = buildScene(
      buildPlanGraph({
        ...GARDEN,
        elements: [
          {
            id: "bw1",
            kind: "boundary_wall",
            polyline: [[0.05, 0.02], [0.85, 0.02]],
            height_mm: 2400,
            width_mm: 200,
          },
        ],
      }),
    );
    expect(scene.walls).toHaveLength(1);
    // size is [length, height, thickness].
    expect(scene.walls[0]!.size[1]).toBeCloseTo(2.4, 6);
    expect(scene.walls[0]!.size[0]).toBeCloseTo(16, 6);
  });
});
