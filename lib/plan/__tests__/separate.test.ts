import { describe, expect, it } from "vitest";

import { polygonArea } from "@/lib/plan/polygon";
import {
  clampToViewBox,
  overlappingCount,
  polygonToRect,
  rectsOverlap,
  separateOverlappingRooms,
  type Point,
} from "@/lib/plan/separate";

const VW = 1000;
const VH = 600;

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** An L: a square with its top-right quarter removed. Non-rectilinear. */
const lShape = (x: number, y: number, s: number): Point[] => [
  [x, y],
  [x + s / 2, y],
  [x + s / 2, y + s / 2],
  [x + s, y + s / 2],
  [x + s, y + s],
  [x, y + s],
];

const countOverlaps = (rooms: { polygon: Point[] }[]) => {
  let n = 0;
  for (let i = 0; i < rooms.length - 1; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (rectsOverlap(polygonToRect(rooms[i]!.polygon), polygonToRect(rooms[j]!.polygon))) n++;
    }
  }
  return n;
};

describe("separateOverlappingRooms — the editor's Fix overlaps", () => {
  it("leaves zero overlaps on a known-overlapping fixture", () => {
    const rooms = [
      { name: "A", polygon: rect(100, 100, 200, 150) },
      { name: "B", polygon: rect(200, 150, 200, 150) },
      { name: "C", polygon: rect(260, 190, 180, 140) },
    ];
    expect(countOverlaps(rooms)).toBeGreaterThan(0);
    const out = separateOverlappingRooms(rooms, VW, VH);
    expect(countOverlaps(out)).toBe(0);
  });

  it("preserves every room's AREA exactly", () => {
    const rooms = [
      { polygon: rect(100, 100, 200, 150) },
      { polygon: rect(200, 150, 200, 150) },
      { polygon: rect(260, 190, 180, 140) },
    ];
    const before = rooms.map((r) => polygonArea(r.polygon));
    const out = separateOverlappingRooms(rooms, VW, VH);
    out.forEach((r, i) => {
      expect(polygonArea(r.polygon)).toBeCloseTo(before[i]!, 6);
    });
  });

  it("preserves every room's SHAPE — translation only, no reshaping", () => {
    const rooms = [
      { polygon: lShape(100, 100, 200) },
      { polygon: lShape(200, 150, 200) },
    ];
    const out = separateOverlappingRooms(rooms, VW, VH);
    out.forEach((r, i) => {
      // Same vertex count, and every edge vector unchanged: a pure translation.
      expect(r.polygon).toHaveLength(rooms[i]!.polygon.length);
      for (let k = 1; k < r.polygon.length; k++) {
        const before: Point = [
          rooms[i]!.polygon[k]![0] - rooms[i]!.polygon[0]![0],
          rooms[i]!.polygon[k]![1] - rooms[i]!.polygon[0]![1],
        ];
        const after: Point = [
          r.polygon[k]![0] - r.polygon[0]![0],
          r.polygon[k]![1] - r.polygon[0]![1],
        ];
        expect(after[0]).toBeCloseTo(before[0], 6);
        expect(after[1]).toBeCloseTo(before[1], 6);
      }
    });
    expect(countOverlaps(out)).toBe(0);
  });

  it("is deterministic", () => {
    const rooms = [
      { polygon: rect(100, 100, 200, 150) },
      { polygon: rect(200, 150, 200, 150) },
    ];
    expect(separateOverlappingRooms(rooms, VW, VH)).toEqual(
      separateOverlappingRooms(rooms, VW, VH),
    );
  });

  it("is a no-op on an already-clean plan", () => {
    const rooms = [
      { polygon: rect(0, 0, 100, 100) },
      { polygon: rect(200, 0, 100, 100) },
    ];
    expect(separateOverlappingRooms(rooms, VW, VH)).toEqual(rooms);
  });

  it("does not treat a shared wall as an overlap", () => {
    const rooms = [
      { polygon: rect(0, 0, 100, 100) },
      { polygon: rect(100, 0, 100, 100) },
    ];
    expect(overlappingCount(rooms)).toBe(0);
    expect(separateOverlappingRooms(rooms, VW, VH)).toEqual(rooms);
  });
});

describe("clampToViewBox — the one place shape is NOT preserved", () => {
  it("leaves an in-bounds room untouched", () => {
    const room = { polygon: lShape(100, 100, 200) };
    expect(clampToViewBox(room, VW, VH)).toEqual(room);
  });

  it("FLATTENS an N-vertex room to its bounding rectangle when it clamps", () => {
    // Documented, not desired: a room pushed off-canvas comes back rectangular.
    // Rectilinear plans are unaffected, which is why it has gone unnoticed —
    // but an L-shaped room loses its notch.
    const room = { polygon: lShape(-50, 100, 200) };
    const out = clampToViewBox(room, VW, VH);
    expect(out.polygon).toHaveLength(4);
    expect(polygonArea(out.polygon)).toBeGreaterThan(polygonArea(room.polygon));
  });

  it("leaves a rectangular room's shape and area intact when it clamps", () => {
    const room = { polygon: rect(-50, 100, 200, 150) };
    const out = clampToViewBox(room, VW, VH);
    expect(out.polygon).toHaveLength(4);
    expect(polygonArea(out.polygon)).toBeCloseTo(polygonArea(room.polygon), 6);
  });
});

describe("overlappingCount — what the editor badge shows", () => {
  it("counts distinct rooms, not pairs", () => {
    const rooms = [
      { polygon: rect(0, 0, 100, 100) },
      { polygon: rect(50, 50, 100, 100) },
      { polygon: rect(60, 60, 100, 100) },
    ];
    expect(overlappingCount(rooms)).toBe(3);
  });

  it("is zero on a clean plan", () => {
    expect(
      overlappingCount([{ polygon: rect(0, 0, 10, 10) }, { polygon: rect(50, 0, 10, 10) }]),
    ).toBe(0);
  });
});
