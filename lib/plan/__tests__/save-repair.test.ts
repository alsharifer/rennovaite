import { describe, expect, it } from "vitest";

import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import { repairForSave } from "@/lib/plan/save-repair";

describe("repairForSave", () => {
  it("stores an abutting, non-overlapping garden exactly as drawn", () => {
    const rooms = villa94PlanRecords().rooms.map((r) => ({
      id: r.id,
      name_en: r.name_en,
      polygon: r.polygon,
      area_m2: r.area_m2,
    }));
    const out = repairForSave(rooms);
    expect(out.repairedIds).toEqual([]);
    expect(JSON.stringify(out.rooms)).toBe(JSON.stringify(rooms));
  });

  it("reshapes only the rooms that overlap, never their neighbours", () => {
    const rooms = [
      { id: "a", name_en: "A", polygon: [[0, 0], [0.6, 0], [0.6, 0.6], [0, 0.6]], area_m2: 36 },
      { id: "b", name_en: "B", polygon: [[0.4, 0], [1, 0], [1, 0.6], [0.4, 0.6]], area_m2: 36 },
      // Abuts A along x = 0 … 0.6 at y = 0.6; overlaps nothing.
      { id: "c", name_en: "C", polygon: [[0, 0.6], [0.3, 0.6], [0.6, 0.6], [0.6, 1], [0, 1]], area_m2: 24 },
    ];
    const out = repairForSave(rooms);
    expect(out.repairedIds).toEqual(["b"]);
    expect(out.rooms[2]).toBe(rooms[2]);
    expect(out.rooms[0]).toBe(rooms[0]);
  });
});
