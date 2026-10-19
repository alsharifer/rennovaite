import { describe, expect, it } from "vitest";

import { pointOnWall, setupOf, wallOfPoint, writesFor } from "@/lib/plan/wet-room-setup";

// The pilot bathroom in normalised space (x across 2.66 m): the room, its shower
// (NE), its heater (N wall over the shower), as the pilot set them by script.
const L = 2.66;
const n = (xCm: number, yCm: number): [number, number] => [xCm / 100 / L, yCm / 100 / L];
const POLY: [number, number][] = [n(0, 0), n(266, 0), n(266, 263), n(0, 263)];
const FX = [
  { id: "sh", type: "shower_mixer", position: n(195.5, 45.5), spec: { column_wall: "E", niche_wall: "N" } },
  { id: "wh", type: "water_heater", position: n(170, 5), spec: { height_mm: 2100, note: "~2.3 m over the shower" } },
];
const ROOM = { bulkhead: { over: "shower" } };

describe("B7 4 — the wet-room panel reads what the pilot set by script", () => {
  it("bulkhead over the shower, heater on the N wall at 2.1 m (box in), niche N 600 × 300, valve E, extractor on", () => {
    expect(setupOf(ROOM, FX, POLY)).toEqual({
      bulkhead: { over: "shower" },
      heater: { wall: "N", height_mm: 2100, action: "box_in" },
      niche: { wall: "N", width_mm: 600, height_mm: 300 },
      valve_wall: "E",
      extractor: true,
    });
  });
  it("walls from points, and a point on a wall", () => {
    expect(wallOfPoint(n(2, 152), POLY)).toBe("W");
    expect(wallOfPoint(pointOnWall("S", POLY), POLY)).toBe("S");
  });
});

describe("B7 4 — and writes it back where the package and the drawings read it", () => {
  const base = setupOf(ROOM, FX, POLY);
  it("no bulkhead, no extractor, no niche → spec says so; the shower keeps its other fields", () => {
    const w = writesFor({ ...base, bulkhead: null, extractor: false, niche: null }, ROOM, FX, POLY);
    expect(w.roomSpec).toMatchObject({ bulkhead: false, extractor: false });
    expect(w.showerSpec!.spec).toMatchObject({ niche: "none", column_wall: "E" });
  });
  it("the heater moved to the W wall and relocated → its fixture moves to that wall's middle", () => {
    const w = writesFor({ ...base, heater: { wall: "W", height_mm: 1800, action: "relocate" } }, ROOM, FX, POLY);
    expect(w.heater.op).toBe("upsert");
    if (w.heater.op === "upsert") {
      expect(wallOfPoint(w.heater.position, POLY)).toBe("W");
      expect(w.heater.spec).toMatchObject({ height_mm: 1800, action: "relocate", note: "~2.3 m over the shower" });
    }
  });
  it("staying on its wall keeps the heater where it was drawn; none → its fixture is removed", () => {
    const same = writesFor({ ...base, heater: { ...base.heater!, height_mm: 2000 } }, ROOM, FX, POLY);
    expect(same.heater.op === "upsert" && same.heater.position).toEqual(FX[1]!.position);
    expect(writesFor({ ...base, heater: null }, ROOM, FX, POLY).heater).toEqual({ op: "delete", id: "wh" });
  });
  it("reading back what it wrote gives the same setup", () => {
    const next = { ...base, niche: { wall: "E" as const, width_mm: 900, height_mm: 400 }, extractor: false };
    const w = writesFor(next, ROOM, FX, POLY);
    const fx = FX.map((f) => (f.id === "sh" ? { ...f, spec: w.showerSpec!.spec } : f));
    expect(setupOf(w.roomSpec, fx, POLY)).toEqual(next);
  });
});
