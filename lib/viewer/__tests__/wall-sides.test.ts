import { describe, expect, it } from "vitest";

import { assignWallSides } from "../scene";

// A party wall between a bathroom and a bedroom must be tiled on the bathroom
// face ONLY. Getting the side assignment backwards puts bathroom tile in the
// bedroom, which is a worse outcome than leaving the wall clay — so this is the
// test that earns the two-sided material array.

describe("assignWallSides", () => {
  const centroids = new Map<string, [number, number]>([
    ["north", [0, -3]],
    ["south", [0, 3]],
    ["east", [3, 0]],
  ]);

  it("puts the room on the +Z local face into roomPos", () => {
    // Wall along +X from (-2,0) to (2,0): u = (1,0), local +Z normal = (-uz, ux) = (0, 1).
    // So the room at z = +3 ("south") is on the +Z face.
    const { roomPos, roomNeg } = assignWallSides([-2, 0], [2, 0], ["north", "south"], centroids);
    expect(roomPos).toBe("south");
    expect(roomNeg).toBe("north");
  });

  it("swaps sides when the wall is drawn in the opposite direction", () => {
    // Same wall, reversed: the normal flips, so the assignment must flip too.
    const { roomPos, roomNeg } = assignWallSides([2, 0], [-2, 0], ["north", "south"], centroids);
    expect(roomPos).toBe("north");
    expect(roomNeg).toBe("south");
  });

  it("leaves the outward face null on an external wall", () => {
    const { roomPos, roomNeg } = assignWallSides([-2, 0], [2, 0], ["south"], centroids);
    expect(roomPos).toBe("south");
    expect(roomNeg).toBeNull();
  });

  it("handles a wall on the other axis", () => {
    // Wall along +Z from (0,-2) to (0,2): u = (0,1), local +Z normal = (-1, 0).
    // The room at x = +3 ("east") is therefore on the -Z face.
    const { roomPos, roomNeg } = assignWallSides([0, -2], [0, 2], ["east"], centroids);
    expect(roomPos).toBeNull();
    expect(roomNeg).toBe("east");
  });

  it("returns nulls for a degenerate zero-length wall instead of dividing by zero", () => {
    expect(assignWallSides([1, 1], [1, 1], ["north"], centroids)).toEqual({
      roomPos: null,
      roomNeg: null,
    });
  });

  it("skips a room whose centroid sits on the wall line rather than guessing a side", () => {
    const onLine = new Map<string, [number, number]>([["mid", [0, 0]]]);
    expect(assignWallSides([-2, 0], [2, 0], ["mid"], onLine)).toEqual({
      roomPos: null,
      roomNeg: null,
    });
  });

  it("ignores room ids with no centroid (unresolved rooms stay clay)", () => {
    const { roomPos, roomNeg } = assignWallSides([-2, 0], [2, 0], ["ghost"], centroids);
    expect(roomPos).toBeNull();
    expect(roomNeg).toBeNull();
  });
});
