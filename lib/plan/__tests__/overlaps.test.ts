import { describe, expect, it } from "vitest";

import { boxesOverlap, describeOverlaps, findOverlaps } from "@/lib/plan/overlaps";

const rect = (x: number, y: number, w: number, h: number) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

describe("findOverlaps", () => {
  it("finds nothing on a clean plan", () => {
    const r = findOverlaps([
      { id: "a", name: "A", polygon: rect(0, 0, 10, 10) },
      { id: "b", name: "B", polygon: rect(20, 0, 10, 10) },
    ]);
    expect(r.has_overlaps).toBe(false);
    expect(r.pairs).toEqual([]);
    expect(describeOverlaps(r)).toBe("No overlapping rooms.");
  });

  it("does NOT flag rooms that merely share a wall", () => {
    // Adjacency is how plans are built — flagging it would make every plan
    // permanently uncostable.
    const r = findOverlaps([
      { id: "a", name: "A", polygon: rect(0, 0, 10, 10) },
      { id: "b", name: "B", polygon: rect(10, 0, 10, 10) },
    ]);
    expect(r.has_overlaps).toBe(false);
  });

  it("flags a genuine overlap and names both rooms", () => {
    const r = findOverlaps([
      { id: "a", name: "Bedroom 3", polygon: rect(0, 0, 10, 10) },
      { id: "b", name: "Passage", polygon: rect(5, 5, 10, 10) },
    ]);
    expect(r.has_overlaps).toBe(true);
    expect(r.pairs).toHaveLength(1);
    expect(r.room_names.sort()).toEqual(["Bedroom 3", "Passage"]);
    expect(describeOverlaps(r)).toContain("Bedroom 3");
  });

  it("reports every offending pair, and each room once", () => {
    const r = findOverlaps([
      { id: "a", name: "A", polygon: rect(0, 0, 10, 10) },
      { id: "b", name: "B", polygon: rect(2, 2, 10, 10) },
      { id: "c", name: "C", polygon: rect(4, 4, 10, 10) },
    ]);
    expect(r.pairs).toHaveLength(3); // a∩b, a∩c, b∩c
    expect(r.room_ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("skips rooms with an unusable polygon rather than guessing", () => {
    const r = findOverlaps([
      { id: "a", name: "A", polygon: rect(0, 0, 10, 10) },
      { id: "bad", name: "Bad", polygon: null },
      { id: "short", name: "Short", polygon: [[0, 0], [1, 1]] },
      { id: "nan", name: "NaN", polygon: [[0, 0], [NaN, 1], [2, 2]] },
    ]);
    expect(r.has_overlaps).toBe(false);
  });

  it("is scale-invariant — normalised and pixel space agree", () => {
    const norm = findOverlaps([
      { id: "a", name: "A", polygon: rect(0, 0, 0.5, 0.5) },
      { id: "b", name: "B", polygon: rect(0.25, 0.25, 0.5, 0.5) },
    ]);
    const px = findOverlaps([
      { id: "a", name: "A", polygon: rect(0, 0, 500, 500) },
      { id: "b", name: "B", polygon: rect(250, 250, 500, 500) },
    ]);
    expect(norm.has_overlaps).toBe(px.has_overlaps);
    expect(norm.has_overlaps).toBe(true);
  });

  it("handles an empty plan", () => {
    expect(findOverlaps([]).has_overlaps).toBe(false);
  });
});

describe("boxesOverlap", () => {
  it("requires shared interior, not a shared edge", () => {
    expect(boxesOverlap([0, 0, 10, 10], [10, 0, 20, 10])).toBe(false);
    expect(boxesOverlap([0, 0, 10, 10], [9, 0, 20, 10])).toBe(true);
  });

  it("treats containment as overlap", () => {
    expect(boxesOverlap([0, 0, 10, 10], [2, 2, 4, 4])).toBe(true);
  });
});
