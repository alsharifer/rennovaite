import { describe, expect, it } from "vitest";

import { roomFacts, wallsLine } from "../room-facts";

const derived = { walls: true, elements_empty: true, wall_thickness: true, is_structural: true, openings_empty: false, ceiling_h: true, north: true, level: true, metric_scale: false };

const room = (id: string, polygon: [number, number][], extra: Record<string, unknown> = {}) => ({
  id,
  name_en: id,
  name_ar: null,
  type: "bedroom",
  polygon,
  area_m2: 12,
  ceiling_h_m: 2.9,
  unroofed: false,
  area_derived_m2: null,
  derived_note: null,
  ...extra,
});
const wall = (id: string, room_ids: string[]) => ({ id, polyline: [[0, 0], [1, 0]], thickness_mm: 200, is_structural: null, room_ids, derived: true, source: "derived" });
const opening = (id: string, type: string, wall_id: string | null, room_id: string | null = null) => ({ id, wall_id, room_id, type, width_mm: 900, height_mm: 2100, sill_mm: 0, position: null, along_offset: null, source: "parsed", derived: false });

describe("roomFacts", () => {
  const graph = {
    rooms: [room("a", [[0, 0], [4, 0], [4, 3], [0, 3]]), room("garden", [[0, 0], [2, 0], [2, 2], [0, 2]], { unroofed: true, area_derived_m2: 3.9 })],
    walls: [wall("w1", ["a"]), wall("w2", ["a"]), wall("w3", ["a"]), wall("w4", ["a", "garden"])],
    openings: [opening("o1", "window", "w1"), opening("o2", "door", "w4"), opening("o3", "window", null, "garden")],
    derived,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [a, g] = roomFacts(graph as any);

  it("counts the room's walls and the openings in them", () => {
    expect(a).toMatchObject({ walls: 4, windows: 1, doors: 1, perimeter_m: 14, ceiling_h_m: 2.9, ceiling_derived: true, perimeter_derived: false });
    expect(wallsLine(a!)).toBe("4 · 1 window · 1 door");
  });

  it("an open zone has no ceiling and keeps its derived area flag", () => {
    expect(g).toMatchObject({ ceiling_h_m: null, area_derived: true, walls: 1, windows: 1, doors: 1 });
  });

  it("no openings on the plan is not zero windows", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [x] = roomFacts({ ...graph, openings: [] } as any);
    expect(x!.windows).toBeNull();
    expect(wallsLine(x!)).toBe("4 · no openings on the plan");
  });
});
