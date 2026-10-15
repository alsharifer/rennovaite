// "Fix overlaps" never moves a room (ruled 15 Oct): it trims the shared floor
// from one room of each pair, and every room stays inside its own outline.

import { describe, expect, it } from "vitest";

import j0 from "../__fixtures__/j0-bad-parse.json";
import { findOverlaps, sharedArea } from "../overlaps";
import { polygonArea, type Pt } from "../polygon";
import polygonClipping from "polygon-clipping";

import { overPrinted, staysWithin, trimOverlappingRooms } from "../trim-overlaps";

/** Area of the rooms combined (their union), in polygon units². */
const combined = (polys: Pt[][]) =>
  (polygonClipping.union(...(polys.map((p) => [[...p, p[0]!]]) as unknown as [never, ...never[]])) as unknown as Pt[][][]).reduce(
    (s, poly) => s + polygonArea(poly[0]!) - poly.slice(1).reduce((h, r) => h + polygonArea(r), 0),
    0,
  );

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

  it("removes EXACTLY the overlap: the total after is the rooms combined (±0.1 m²) — J0 at the plan's own scale", () => {
    const raw = (j0 as unknown as { total_area_m2: number; rooms: { id: string; polygon: Pt[] }[] });
    const k = raw.total_area_m2 / raw.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
    // Areas as a reading made today carries them: they add up to the plan total.
    const rooms = raw.rooms.map((r) => ({ id: r.id, polygon: r.polygon, area_m2: polygonArea(r.polygon) * k }));
    const out = trimOverlappingRooms(rooms, { m2PerUnit2: k });
    expect(out.unresolved).toEqual([]);
    expect(out.total_before_m2).toBeCloseTo(166.1, 1);
    const union = combined(raw.rooms.map((r) => r.polygon)) * k;
    expect(Math.abs(out.total_after_m2! - union)).toBeLessThanOrEqual(0.1);
    expect(union).toBeGreaterThan(127); // 23.6% counted twice → about 127 m² of real floor
    // And each room's area is its outline: nothing re-measured differently.
    for (const r of out.rooms) expect(Math.abs(r.area_m2! - polygonArea(r.polygon) * k)).toBeLessThanOrEqual(0.05);
  });

  it("the reading's own areas (J0 adds to 145.7 m², not its 166.1 total): the total falls by exactly the overlap", () => {
    const raw = (j0 as unknown as { rooms: { id: string; polygon: Pt[]; area_m2: number }[] });
    const k = raw.rooms.reduce((s, r) => s + r.area_m2, 0) / raw.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0); // the editor's scale
    const out = trimOverlappingRooms(raw.rooms.map((r) => ({ id: r.id, polygon: r.polygon, area_m2: r.area_m2 })), { m2PerUnit2: k });
    const union = combined(raw.rooms.map((r) => r.polygon)) * k;
    expect(out.total_before_m2).toBeCloseTo(145.7, 1);
    expect(Math.abs(out.total_after_m2! - union)).toBeLessThanOrEqual(0.1); // 112.8 at this scale — never the 108.8 the first version showed
  });

  it("three rooms over one corner: each square metre is removed once", () => {
    const rooms = [rect(0, 0, 4, 4), rect(3, 0, 4, 4), rect(1.5, 3, 4, 4)].map((p, i) => ({ id: String(i), polygon: p, area_m2: polygonArea(p) }));
    const out = trimOverlappingRooms(rooms, { m2PerUnit2: 1 });
    expect(out.unresolved).toEqual([]);
    expect(Math.abs(out.total_after_m2! - combined(rooms.map((r) => r.polygon)))).toBeLessThanOrEqual(0.1);
  });

  it("never splits a room in two — a crossing pair is reported, both left as they were", () => {
    const wide = { id: "wide", polygon: rect(0, 2, 10, 2), area_m2: 20 };
    const tall = { id: "tall", polygon: rect(4, 0, 2, 10), area_m2: 20 };
    const out = trimOverlappingRooms([wide, tall], { m2PerUnit2: 1 });
    expect(out.unresolved).toEqual([{ a_id: "wide", b_id: "tall", reason: "would_split_room" }]);
    expect(out.rooms).toEqual([wide, tall]);
    expect(out.total_after_m2).toBe(40);
  });

  it("a room cut through the middle is spared when trimming the other way works", () => {
    const corridor = { id: "corridor", polygon: rect(0, 2, 10, 1.5), area_m2: 15, confidence: 0.9 };
    const nook = { id: "nook", polygon: rect(4, 1, 2, 2), area_m2: 4, confidence: 0.5 };
    // Ranked: the corridor keeps (surer); trimming the nook by it would split the nook,
    // so the corridor is trimmed instead (a notch, one piece).
    const out = trimOverlappingRooms([corridor, nook], { m2PerUnit2: 1 });
    expect(out.trimmed).toEqual([{ id: "nook", kept_by: "corridor", removed: 2 }]);
    expect(out.unresolved).toEqual([]);
  });

  it("printed sizes: the room further over its printed area loses the shared floor", () => {
    // A: outline 20 m², printed 16 (+25%). B: outline 12 m², printed 11.5 (+4%). B is smaller and
    // less sure — the old order would trim B; the printed sizes say A is the one overreaching.
    const a = { id: "a", polygon: rect(0, 0, 5, 4), confidence: 0.9, area_m2: 16, printed_m2: 16 };
    const b = { id: "b", polygon: rect(4, 0, 3, 4), confidence: 0.5, area_m2: 11.5, printed_m2: 11.5 };
    expect(overPrinted(a, 1)).toBeCloseTo(0.25, 9);
    const out = trimOverlappingRooms([a, b], { m2PerUnit2: 1 });
    expect(out.trimmed.map((t) => [t.id, t.kept_by])).toEqual([["a", "b"]]);
    expect(out.rooms[0]!.area_m2).toBe(12); // 16 − the 4 m² overlap
    // One printed room only: it loses when its outline is over its printed size.
    const solo = trimOverlappingRooms([{ ...a }, { id: "c", polygon: rect(4, 0, 3, 4), confidence: 0.5, area_m2: 12 }], { m2PerUnit2: 1 });
    expect(solo.trimmed[0]!.id).toBe("a");
  });
});
