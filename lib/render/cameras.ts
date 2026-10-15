// =============================================================================
// lib/render/cameras.ts — default interior cameras from the plan (R10c guards,
// ruled 14–15 Oct). Pure; plan units in, plan units out.
//
//   - A room is split into ARMS: the fewest maximal axis-aligned rectangles
//     that cover it (an L → 2, a U → 3). An arm COUNTS only when both of its
//     sides are at least ARM_MIN_M (1.5 m) — a 3 cm step in a wall is not an
//     arm (Jumeirah Parks' 8-vertex Kitchen is one rectangle with a notch).
//   - With fewer than two counting arms the room is treated as a rectangle:
//     the default TWO views, from the two ends of its main arm, looking along
//     it at each other.
//   - With two or more, ONE camera per counting arm, at most MAX_CAMERAS (3),
//     largest arms first; each stands at the arm's far end and looks along it.
//   - Every camera stands INSIDE the room with at least CLEARANCE_M (0.4 m) to
//     every wall (`assertInside`); one that cannot is moved toward its arm's
//     centre and, failing that, dropped — never rendered from.
// =============================================================================

import { pointInPolygon, pointToSegment, type Pt } from "@/lib/plan/polygon";

export const ARM_MIN_M = 1.5;
export const MAX_CAMERAS = 3;
export const CLEARANCE_M = 0.4;
/** How far in from an arm's end wall a camera stands. */
export const STANDOFF_M = 0.6;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A maximal rectangle of the room, and the floor it adds beyond the arms picked before it. */
export interface Arm extends Box {
  own: Box;
}

export interface Camera {
  position: Pt;
  /** The point it looks at (the far end of its arm). */
  target: Pt;
  arm: number;
}


/** Distance from a point to the room outline, in plan units. */
export function distanceToOutline(p: Pt, polygon: readonly Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < polygon.length; i++) d = Math.min(d, pointToSegment(p, polygon[i]!, polygon[(i + 1) % polygon.length]!).dist);
  return d;
}

/** The guard: inside the room, and at least CLEARANCE_M from every wall. */
export function assertInside(p: Pt, polygon: readonly Pt[], unitToM: number): boolean {
  return pointInPolygon(p, polygon as Pt[]) && distanceToOutline(p, polygon) * unitToM >= CLEARANCE_M - 1e-9;
}

/**
 * The fewest maximal rectangles covering the room, the main body first; each
 * carries `own` — the floor it adds beyond the arms before it. Cells come
 * from the polygon's own vertex coordinates, so an orthogonal room decomposes
 * exactly; a diagonal edge is approximated by whole cells.
 */
export function roomArms(polygon: readonly Pt[]): Arm[] {
  const xs = [...new Set(polygon.map((p) => p[0]))].sort((a, b) => a - b);
  const ys = [...new Set(polygon.map((p) => p[1]))].sort((a, b) => a - b);
  const W = xs.length - 1, H = ys.length - 1;
  if (W < 1 || H < 1) return [];
  const inside: boolean[][] = [];
  for (let i = 0; i < W; i++) {
    inside[i] = [];
    for (let j = 0; j < H; j++) inside[i]![j] = pointInPolygon([(xs[i]! + xs[i + 1]!) / 2, (ys[j]! + ys[j + 1]!) / 2], polygon as Pt[]);
  }
  const full = (i0: number, i1: number, j0: number, j1: number) => {
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (!inside[i]![j]) return false;
    return true;
  };
  // Every full cell rectangle, then the maximal ones.
  const rects: [number, number, number, number][] = [];
  for (let i0 = 0; i0 < W; i0++) for (let i1 = i0; i1 < W; i1++) for (let j0 = 0; j0 < H; j0++) for (let j1 = j0; j1 < H; j1++) if (full(i0, i1, j0, j1)) rects.push([i0, i1, j0, j1]);
  const maximal = rects.filter(([a0, a1, b0, b1]) => !rects.some(([c0, c1, d0, d1]) => (c0 <= a0 && c1 >= a1 && d0 <= b0 && d1 >= b1) && (c0 < a0 || c1 > a1 || d0 < b0 || d1 > b1)));
  const toBox = ([i0, i1, j0, j1]: [number, number, number, number]): Box => ({ minX: xs[i0]!, maxX: xs[i1 + 1]!, minY: ys[j0]!, maxY: ys[j1 + 1]! });
  // Greedy cover: each pick adds the most floor not yet covered.
  const covered = inside.map((col) => col.map(() => false));
  const cellArea = (i: number, j: number) => (xs[i + 1]! - xs[i]!) * (ys[j + 1]! - ys[j]!);
  const total = inside.reduce((s, col, i) => s + col.reduce((t, v, j) => t + (v ? cellArea(i, j) : 0), 0), 0);
  const picked: Arm[] = [];
  let left = total;
  while (left > total * 0.02) {
    let best: { r: [number, number, number, number]; gain: number } | null = null;
    for (const r of maximal) {
      let gain = 0;
      for (let i = r[0]; i <= r[1]; i++) for (let j = r[2]; j <= r[3]; j++) if (!covered[i]![j]) gain += cellArea(i, j);
      if (gain > 0 && (!best || gain > best.gain)) best = { r, gain };
    }
    if (!best) break;
    // The floor this arm ADDS — what the 1.5 m rule measures (a shallow bay
    // whose maximal rectangle runs through the whole room is still shallow).
    let o: [number, number, number, number] | null = null;
    for (let i = best.r[0]; i <= best.r[1]; i++) for (let j = best.r[2]; j <= best.r[3]; j++) {
      if (covered[i]![j]) continue;
      o = o ? [Math.min(o[0], i), Math.max(o[1], i), Math.min(o[2], j), Math.max(o[3], j)] : [i, i, j, j];
      covered[i]![j] = true;
    }
    picked.push({ ...toBox(best.r), own: toBox(o ?? best.r) });
    left -= best.gain;
  }
  // Picked order is largest-gain first, so the main body leads.
  return picked;
}

/** Arms that count as arms: both sides at least ARM_MIN_M. */
export function countingArms(polygon: readonly Pt[], unitToM: number): Arm[] {
  return roomArms(polygon).filter((a) => (a.own.maxX - a.own.minX) * unitToM >= ARM_MIN_M - 1e-9 && (a.own.maxY - a.own.minY) * unitToM >= ARM_MIN_M - 1e-9);
}

/** Place a camera at one end of an arm, looking along it; pull it in until the guard holds. */
function placeInArm(arm: Arm, end: "start" | "end", polygon: readonly Pt[], unitToM: number, armIndex: number): Camera | null {
  const alongX = arm.maxX - arm.minX >= arm.maxY - arm.minY;
  const cx = (arm.minX + arm.maxX) / 2, cy = (arm.minY + arm.maxY) / 2;
  const inset = STANDOFF_M / unitToM;
  const at = (k: number): Pt => {
    // k = 1 at the end wall (inset), 0 at the arm's centre.
    if (alongX) {
      const x0 = end === "start" ? arm.minX + inset : arm.maxX - inset;
      return [cx + (x0 - cx) * k, cy];
    }
    const y0 = end === "start" ? arm.minY + inset : arm.maxY - inset;
    return [cx, cy + (y0 - cy) * k];
  };
  const target: Pt = alongX ? [end === "start" ? arm.maxX : arm.minX, cy] : [cx, end === "start" ? arm.maxY : arm.minY];
  for (let step = 0; step <= 10; step++) {
    const p = at(1 - step / 10);
    if (assertInside(p, polygon, unitToM)) return { position: p, target, arm: armIndex };
  }
  return null;
}

/**
 * The room's default cameras. Rectangles (and rooms with < 2 counting arms):
 * two, from both ends of the main arm. Otherwise one per counting arm, max 3,
 * each from the arm's end farther from the room's centre.
 */
export function defaultCameras(polygon: readonly Pt[], unitToM: number): Camera[] {
  const all = roomArms(polygon);
  if (all.length === 0) return [];
  const counting = countingArms(polygon, unitToM);
  if (counting.length < 2) {
    const main = all[0]!;
    return [placeInArm(main, "start", polygon, unitToM, 0), placeInArm(main, "end", polygon, unitToM, 0)].filter((c): c is Camera => c !== null);
  }
  const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length, cy = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
  return counting
    .slice(0, MAX_CAMERAS)
    .map((arm, i) => {
      const alongX = arm.maxX - arm.minX >= arm.maxY - arm.minY;
      const startFar = alongX ? Math.abs(arm.minX - cx) > Math.abs(arm.maxX - cx) : Math.abs(arm.minY - cy) > Math.abs(arm.maxY - cy);
      return placeInArm(arm, startFar ? "start" : "end", polygon, unitToM, i);
    })
    .filter((c): c is Camera => c !== null);
}
