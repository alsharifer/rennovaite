// "Fix overlaps" never moves a room (ruled 15 Oct): it trims the shared floor
// from one room of each pair, and every room stays inside its own outline.

import { describe, expect, it } from "vitest";

import j0 from "../__fixtures__/j0-bad-parse.json";
import { findOverlaps, sharedArea } from "../overlaps";
import { polygonArea, type Pt } from "../polygon";
import { staysWithin, trimOverlappingRooms } from "../trim-overlaps";

const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const bbox = (p: Pt[]) => ({ minX: Math.min(...p.map((q) => q[0])), maxX: Math.max(...p.map((q) => q[0])), minY: Math.min(...p.map((q) => q[1])), maxY: Math.max(...p.map((q) => q[1])) });
const inside = (outer: Pt[], inner: Pt[], tol = 1e-9) => {
  const a = bbox(outer), b = bbox(inner);
  return b.minX >= a.minX - tol && b.maxX <= a.maxX + tol && b.minY >= a.minY - tol && b.maxY <= a.maxY + tol;
};

describe("trimOverlappingRooms", () => {
  it("trims the shared floor from one room and moves nothing", () => {
    const bedroom = { id: "bed", name: "Bedroom", polygon: rect(0, 0, 4, 5) };
    const bath = { id: "bath", name: "Bath", polygon: rect(3.5, 1, 2, 2) }; // overlaps 0.5 × 2
    const hall = { id: "hall", name: "Hall", polygon: rect(10, 0, 2, 2) };
    const { rooms, trimmed, unresolved } = trimOverlappingRooms([bedroom, bath, hall]);
    expect(unresolved).toEqual([]);
    // The smaller, more specific room keeps its floor; the bedroom loses exactly the overlap.
    expect(trimmed).toEqual([{ id: "bed", kept_by: "bath", removed: 1 }]);
    expect(polygonArea(rooms[0]!.polygon)).toBeCloseTo(19, 9);
    expect(rooms[1]).toBe(bath);
    expect(rooms[2]).toBe(hall); // untouched rooms are the same objects
    expect(sharedArea(rooms[0]!.polygon, rooms[1]!.polygon)).toBeCloseTo(0, 9);
    // Nothing moved: every room stays inside its own outline.
    for (const [i, r] of rooms.entries()) expect(staysWithin([bedroom, bath, hall][i]!.polygon, r.polygon, 1e-9)).toBe(true);
    // The bedroom is now an L (a notch where the bath is) — shape trimmed, not translated.
    expect(rooms[0]!.polygon.length).toBe(8);
  });

  it("the surer room keeps the floor", () => {
    const a = { id: "a", polygon: rect(0, 0, 4, 4), confidence: 0.9 };
    const b = { id: "b", polygon: rect(3, 0, 2, 4), confidence: 0.5 };
    const { trimmed } = trimOverlappingRooms([a, b]);
    expect(trimmed.map((t) => [t.id, t.kept_by])).toEqual([["b", "a"]]);
  });

  it("never removes a room or cuts a hole — it says so instead", () => {
    const covered = trimOverlappingRooms([
      { id: "big", polygon: rect(0, 0, 4, 4), confidence: 0.9 },
      { id: "dup", polygon: rect(0, 0, 4, 4), confidence: 0.5 },
    ]);
    expect(covered.unresolved).toEqual([{ a_id: "dup", b_id: "big", reason: "would_remove_room" }]);
    expect(covered.trimmed).toEqual([]);
    const ensuite = trimOverlappingRooms([
      { id: "bed", polygon: rect(0, 0, 6, 6) },
      { id: "ens", polygon: rect(2, 2, 1.5, 1.5) },
    ]);
    expect(ensuite.unresolved).toEqual([{ a_id: "bed", b_id: "ens", reason: "would_cut_hole" }]);
    expect(ensuite.rooms[0]!.polygon).toEqual(rect(0, 0, 6, 6));
  });

  it("keeps a concave room concave", () => {
    const l: Pt[] = [[0, 0], [2, 0], [2, 2], [4, 2], [4, 4], [0, 4]];
    const other = rect(3.5, 2, 2, 2); // overlaps the L's lower arm
    const { rooms, trimmed } = trimOverlappingRooms([{ id: "l", polygon: l }, { id: "o", polygon: other }]);
    // The smaller room (4 m² against the L's 12) keeps its floor; the L loses 1 m² and stays an L.
    expect(trimmed).toEqual([{ id: "l", kept_by: "o", removed: 1 }]);
    expect(rooms[1]!.polygon).toEqual(other);
    expect(staysWithin(l, rooms[0]!.polygon, 1e-9)).toBe(true);
    expect(rooms[0]!.polygon.length).toBe(6);
    expect(sharedArea(rooms[0]!.polygon, rooms[1]!.polygon)).toBeCloseTo(0, 9);
  });

  it("the J0 worst parse: every overlap trimmed, every room inside its own outline", () => {
    const before = (j0 as unknown as { rooms: { id: string; name_en?: string; polygon: Pt[]; confidence?: number }[] }).rooms.map((r) => ({ id: r.id, name: r.name_en ?? r.id, polygon: r.polygon, confidence: r.confidence }));
    expect(findOverlaps(before).pairs.length).toBe(12);
    const { rooms, unresolved } = trimOverlappingRooms(before);
    const left = findOverlaps(rooms).pairs;
    // Whatever is left is exactly what it reported it could not resolve.
    expect(left.length).toBe(unresolved.length);
    for (const [i, r] of rooms.entries()) {
      expect(staysWithin(before[i]!.polygon, r.polygon, 1e-9)).toBe(true);
      expect(inside(before[i]!.polygon, r.polygon)).toBe(true);
      expect(polygonArea(r.polygon)).toBeLessThanOrEqual(polygonArea(before[i]!.polygon) + 1e-12);
    }
  });
});
