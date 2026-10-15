// R10c camera guards (ruled 14–15 Oct): cameras stand inside their room; an arm
// counts only when both sides are ≥ 1.5 m; at most 3 default cameras a room.

import { describe, expect, it } from "vitest";

import type { Pt } from "@/lib/plan/polygon";

import fixture from "../__fixtures__/jumeirah-parks-rooms.json";
import { ARM_MIN_M, assertInside, CLEARANCE_M, countingArms, defaultCameras, distanceToOutline, MAX_CAMERAS, roomArms } from "../cameras";

const M = 1; // these synthetic rooms are drawn in metres
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const everyCameraInside = (poly: Pt[], u: number) =>
  defaultCameras(poly, u).every((c) => assertInside(c.position, poly, u) && distanceToOutline(c.position, poly) * u >= CLEARANCE_M - 1e-9);

describe("default cameras", () => {
  it("a rectangle: two views from its two ends, both inside", () => {
    const r = rect(0, 0, 5, 4);
    const cams = defaultCameras(r, M);
    expect(cams).toHaveLength(2);
    expect(everyCameraInside(r, M)).toBe(true);
    expect(cams[0]!.position[0]).toBeCloseTo(0.6, 9);
    expect(cams[1]!.position[0]).toBeCloseTo(4.4, 9);
    expect(cams.every((c) => c.position[1] === 2)).toBe(true);
  });

  it("an L with two real arms: one camera per arm, each inside its arm", () => {
    const l: Pt[] = [[0, 0], [6, 0], [6, 2.5], [2.5, 2.5], [2.5, 7], [0, 7]];
    expect(countingArms(l, M)).toHaveLength(2);
    const cams = defaultCameras(l, M);
    expect(cams).toHaveLength(2);
    expect(everyCameraInside(l, M)).toBe(true);
  });

  it("an arm under 1.5 m on either side does not count — the room keeps 2 views", () => {
    const narrow: Pt[] = [[0, 0], [5, 0], [5, 4], [3, 4], [3, 5.2], [0, 5.2]]; // a 1.2 m deep bay
    expect(roomArms(narrow).length).toBe(2);
    expect(countingArms(narrow, M)).toHaveLength(1);
    expect(defaultCameras(narrow, M)).toHaveLength(2);
    expect(everyCameraInside(narrow, M)).toBe(true);
  });

  it("a plus-shaped room with four arms gets at most three cameras", () => {
    const plus: Pt[] = [[2, 0], [4, 0], [4, 2], [6, 2], [6, 4], [4, 4], [4, 6], [2, 6], [2, 4], [0, 4], [0, 2], [2, 2]];
    expect(countingArms(plus, M).length).toBeGreaterThanOrEqual(2);
    const cams = defaultCameras(plus, M);
    expect(cams.length).toBeLessThanOrEqual(MAX_CAMERAS);
    expect(everyCameraInside(plus, M)).toBe(true);
  });

  it("a camera that cannot stand clear of the walls is dropped, never placed outside", () => {
    const corridor = rect(0, 0, 6, 0.7); // nowhere is 0.4 m from both long walls
    expect(defaultCameras(corridor, M)).toEqual([]);
  });

  it(`Jumeirah Parks' 8-vertex Kitchen: 2 cameras at most, not 4 (its notch is 3 cm, not an arm ≥ ${ARM_MIN_M} m)`, () => {
    const { metres_per_unit: u, rooms } = fixture as unknown as { metres_per_unit: number; rooms: { name: string; polygon: Pt[] }[] };
    const kitchen = rooms.find((r) => r.name === "Kitchen")!.polygon;
    expect(kitchen).toHaveLength(8);
    const cams = defaultCameras(kitchen, u);
    expect(cams.length).toBeGreaterThan(0);
    expect(cams.length).toBeLessThanOrEqual(2);
    expect(everyCameraInside(kitchen, u)).toBe(true);
    // Every room on the plan: inside, and never more than three.
    for (const r of rooms) {
      const c = defaultCameras(r.polygon, u);
      expect(c.length).toBeLessThanOrEqual(MAX_CAMERAS);
      expect(everyCameraInside(r.polygon, u)).toBe(true);
    }
  });

  // R10c acceptance (ruled 15 Oct): the Hall's two DEFAULT cameras are the placement test. The east-facing
  // camera is held until the owner confirms where the dining area is (as drawn the Hall has no window and no
  // kitchen opening, so that view cannot come from it).
  it("Jumeirah Parks' Hall (the R10c acceptance room): two default views along its long axis, inside, facing each other", () => {
    const { metres_per_unit: u, rooms } = fixture as unknown as { metres_per_unit: number; rooms: { name: string; polygon: Pt[] }[] };
    const hall = rooms.find((r) => r.name === "Hall")!.polygon;
    expect(hall).toHaveLength(9); // 2.66 × 5.84 m with a shallow notch on its north wall
    expect(countingArms(hall, u)).toHaveLength(1); // the notch is not an arm
    const cams = defaultCameras(hall, u);
    expect(cams).toHaveLength(2);
    expect(everyCameraInside(hall, u)).toBe(true);
    const m = (p: Pt) => [Math.round(p[0] * u * 100) / 100, Math.round(p[1] * u * 100) / 100];
    expect(cams.map((c) => m(c.position))).toEqual([[16.75, 8.97], [16.75, 13.43]]);
    // The first looks south (down the plan, +y), the second north; both straight down the long axis.
    expect(cams[0]!.target[1]).toBeGreaterThan(cams[0]!.position[1]);
    expect(cams[1]!.target[1]).toBeLessThan(cams[1]!.position[1]);
    expect(cams.every((c) => Math.abs(c.target[0] - c.position[0]) < 1e-9)).toBe(true);
  });
});
