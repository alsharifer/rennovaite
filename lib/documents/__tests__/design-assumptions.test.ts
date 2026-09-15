import { describe, expect, it } from "vitest";

import { designDecisions, layoutAssumptions } from "@/lib/documents/design-assumptions";
import type { GardenFixture } from "@/lib/drawings/garden-sheets";
import type { PlanGraph } from "@/lib/plan/geometry";

const graph = {
  rooms: [
    { id: "z1", name_en: "Louvred pergola (replaces existing gazebo)", site_reference: true, disposition: "replace", spec: { replaces_existing: "hardtop gazebo", decision_note: "same footprint" } },
    { id: "z2", name_en: "Front garden — lawn", site_reference: false, disposition: null, spec: { assumption: "front footprint assumed 2.2 × 4.0 m" } },
  ],
  elements: [
    { id: "e1", kind: "stepping_path", site_reference: true, disposition: "replace", spec: { name: "Stepping-stone path (existing)", replaced_by: "1.0 m porcelain path" } },
    { id: "e2", kind: "planter_run", site_reference: true, disposition: "remove", spec: { name: "Planter border (existing) — rear" } },
    { id: "e3", kind: "bench_run", site_reference: false, disposition: null, spec: { name: "L-bench" } },
  ],
  context: [
    { id: "c1", name: "Rear boundary wall", site_reference: true, disposition: "keep", note: "placed from photos; height assumed 2000 mm" },
    { id: "c2", name: "Garage / drive block", site_reference: false, disposition: null, note: "height assumed, not dimensioned; reshaped around the front garden (assumed carve)" },
  ],
} as unknown as PlanGraph;
const fixtures = [
  { id: "t1", layer: "landscape", type: "tree", room_id: null, position: [0, 0], site_reference: true, disposition: "keep", spec: { name: "Palm (existing)" } },
  { id: "l1", layer: "garden", type: "garden_light", room_id: null, position: [0, 0], spec: { fitting: "spike" } },
] as GardenFixture[];

describe("design assumptions — the review meeting's list", () => {
  it("lists only existing items, replacements first, with what each becomes", () => {
    const rows = designDecisions(graph, fixtures);
    expect(rows.map((r) => [r.decision, r.item, r.becomes])).toEqual([
      ["REPLACE", "Existing hardtop gazebo", "Louvred pergola (replaces existing gazebo)"],
      ["REPLACE", "Stepping-stone path", "1.0 m porcelain path"],
      ["REMOVE", "Planter border — rear", null],
      ["KEEP", "Palm", null],
      ["KEEP", "Rear boundary wall", null],
    ]);
    expect(rows[0]!.note).toBe("same footprint");
  });

  it("collects layout assumptions from zones and context notes", () => {
    expect(layoutAssumptions(graph)).toEqual([
      "Front garden — lawn: front footprint assumed 2.2 × 4.0 m",
      "Garage / drive block: reshaped around the front garden (assumed carve)",
    ]);
  });
});
