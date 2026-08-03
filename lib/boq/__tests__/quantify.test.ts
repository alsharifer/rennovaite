import { describe, expect, it } from "vitest";

import {
  assembleMappedSections,
  elementMappedPct,
  roomRollup,
  WORK_ITEM_DEF,
} from "@/lib/boq/elements";
import { quantifyPlan, type WorkItemKey } from "@/lib/boq/quantify";
import { buildPlanGraph } from "@/lib/plan/geometry";

import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";

describe("quantify + assemble — Mudon", () => {
  const graph = buildPlanGraph(MUDON_FIXTURE);
  const items = quantifyPlan(graph);
  const sections = assembleMappedSections(items);
  const rollups = roomRollup(items);

  const lineFor = (key: WorkItemKey) => {
    const sec = sections.find((s) => s.work_section === WORK_ITEM_DEF[key].section)!;
    return sec.lines.find((l) => l.work_item_key === key)!;
  };

  it("emits floor + ceiling per room and plaster + paint per wall", () => {
    // floor_finish for every room EXCEPT stairs (priced as a developed stair
    // tile surface in the engine, not flat floor); ceiling still per room.
    const stairRooms = graph.rooms.filter((r) => r.type === "stairs").length;
    expect(items.filter((i) => i.work_item_key === "floor_finish")).toHaveLength(13 - stairRooms);
    expect(items.filter((i) => i.work_item_key === "ceiling_finish")).toHaveLength(13);
    expect(items.filter((i) => i.work_item_key === "wall_plaster")).toHaveLength(graph.walls.length);
    expect(items.filter((i) => i.work_item_key === "wall_paint")).toHaveLength(graph.walls.length);
  });

  it("VERIFICATION GATE: each aggregated line quantity = Σ its take-off items", () => {
    for (const key of Object.keys(WORK_ITEM_DEF) as WorkItemKey[]) {
      const its = items.filter((i) => i.work_item_key === key);
      if (its.length === 0) continue;
      const line = lineFor(key);
      const sum = Math.round(its.reduce((s, i) => s + i.qty, 0) * 100) / 100;
      expect(line.quantity, `line ${key}`).toBeCloseTo(sum, 2);
      expect(line.element_refs).toHaveLength(its.length);
    }
  });

  it("VERIFICATION GATE: By-room rollup sums exactly to each aggregated line", () => {
    for (const key of Object.keys(WORK_ITEM_DEF) as WorkItemKey[]) {
      const its = items.filter((i) => i.work_item_key === key);
      if (its.length === 0) continue;
      // Σ over rooms of the per-room qty for this work item.
      let roomSum = 0;
      for (const r of rollups) {
        const w = r.items.find((x) => x.work_item_key === key);
        if (w) roomSum += w.qty;
      }
      expect(roomSum, `room sum for ${key}`).toBeCloseTo(lineFor(key).quantity, 1);
    }
  });

  it("living-room floor maps to the Floor Finishes line with its exact area", () => {
    const living = graph.rooms.find((r) => r.name_en === "Family Area")!;
    const floorItem = items.find((i) => i.work_item_key === "floor_finish" && i.element_id === living.id)!;
    expect(floorItem.qty).toBe(24); // Mudon Family Area area
    const floorLine = lineFor("floor_finish");
    expect(floorLine.element_refs).toContain(living.id);
    // total floor area = sum of room areas EXCLUDING stairs (developed surface)
    const expected = graph.rooms
      .filter((r) => r.type !== "stairs")
      .reduce((s, r) => s + r.area_m2, 0);
    expect(floorLine.quantity).toBeCloseTo(expected, 2);
  });

  it("tiles only wet rooms (bath/ensuite/powder), not dry", () => {
    const tiling = items.filter((i) => i.work_item_key === "wet_tiling");
    expect(tiling).toHaveLength(3); // Bath, Master Bath, Toilet
    expect(tiling.every((i) => i.wet_area)).toBe(true);
  });

  it("demolition appears only for walls removed in the proposed graph", () => {
    expect(items.some((i) => i.work_item_key === "demolition")).toBe(false); // no proposed
    // synthetic proposed with the first wall removed
    const proposed = { ...graph, walls: graph.walls.slice(1) };
    const withDemo = quantifyPlan(graph, { proposed });
    const demo = withDemo.filter((i) => i.work_item_key === "demolition");
    expect(demo).toHaveLength(1);
    expect(demo[0]!.element_id).toBe(graph.walls[0]!.id);
  });

  it("reports an element-mapped % (transparency metric)", () => {
    const m = elementMappedPct(sections);
    expect(m.pct).toBe(100); // the mapped sections are 100% element-mapped
    expect(m.mapped_aed).toBeGreaterThan(0);
  });
});
