import { describe, expect, it } from "vitest";

import { hingeLabel, resolveHinge, rightOf } from "@/lib/plan/door-hinge";

// The pilot door: south wall (y 2.63 m), jambs at x 1.18 and 2.05; the room is north of it.
const J0: [number, number] = [1.18, 2.63], J1: [number, number] = [2.05, 2.63];
const IN: [number, number] = [0, -1];
const WA: [number, number] = [0, 2.63], WB: [number, number] = [2.66, 2.63];

describe("B7 2 — the door's hinge side, as seen from the room", () => {
  it("facing the south wall from inside, your right is west", () => {
    expect(rightOf(IN)).toEqual([-1, -0]);
  });
  it("'right' as seen from the room = the west jamb — the room sheet's hinge W", () => {
    const h = resolveHinge(J0, J1, IN, WA, WB, { hinge_side: "right" });
    expect(h).toMatchObject({ hinge: J0, free: J1, side: "right", source: "entered" });
    expect(resolveHinge(J0, J1, IN, WA, WB, { hinge_side: "left" }).hinge).toEqual(J1);
  });
  it("the legacy compass hinge (B6 'W') resolves the same, and says it was entered", () => {
    expect(resolveHinge(J0, J1, IN, WA, WB, { hinge: "W" })).toMatchObject({ hinge: J0, side: "right", source: "entered", compass: "W" });
  });
  it("nothing entered: the jamb nearer a corner (east, 0.61 m) — labelled an estimate", () => {
    const h = resolveHinge(J0, J1, IN, WA, WB, null);
    expect(h).toMatchObject({ hinge: J1, side: "left", source: "estimate" });
    expect(hingeLabel(h)).toBe("Hinge left — estimated (the side nearer the corner); confirm on site");
  });
});
