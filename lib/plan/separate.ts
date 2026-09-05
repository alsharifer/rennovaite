// =============================================================================
// lib/plan/separate.ts — rigid separation of overlapping rooms (D3).
//
// Extracted from editable-plan-viewer so it can be tested. This is the "Fix
// overlaps" operation the editor offers, and it is deliberately DIFFERENT from
// the parse-time `repairOverlaps`:
//
//   repairOverlaps (lib/parse/repair.ts) — boolean-difference CARVE. Changes
//     room shapes to make polygon intersection ∅. Topology-exact, destructive
//     to geometry. Right for a machine parse nobody has reviewed.
//   separateOverlappingRooms (here)      — rigid TRANSLATION. Pushes whole
//     rooms apart along the shallower axis. Right for a human's plan, because
//     it never silently reshapes a room someone drew.
//
// CAVEAT worth knowing: the viewBox clamp is not shape-preserving. When a push
// would take a room outside the canvas, `clampToViewBox` replaces its polygon
// with its bounding RECTANGLE — so a room that has been dragged off-canvas can
// come back rectangular. Rectilinear plans (every room a 4-point rect) are
// unaffected, which is every plan produced before the N-vertex parse. The unit
// tests pin both behaviours so the difference is visible rather than a
// surprise.
// =============================================================================

export type Point = [number, number];

export interface SeparableRoom {
  polygon: Point[];
}

export function bboxOf(points: Point[]): {
  xL: number;
  yT: number;
  xR: number;
  yB: number;
} {
  let xL = Infinity,
    yT = Infinity,
    xR = -Infinity,
    yB = -Infinity;
  for (const [x, y] of points) {
    if (x < xL) xL = x;
    if (y < yT) yT = y;
    if (x > xR) xR = x;
    if (y > yB) yB = y;
  }
  return { xL, yT, xR, yB };
}

/** [x, y, width, height] of a polygon's bounding box. */
export function polygonToRect(polygon: Point[]): [number, number, number, number] {
  const bb = bboxOf(polygon);
  return [bb.xL, bb.yT, bb.xR - bb.xL, bb.yB - bb.yT];
}

export function rectFromBbox(
  xL: number,
  yT: number,
  xR: number,
  yB: number,
): Point[] {
  return [
    [xL, yT],
    [xR, yT],
    [xR, yB],
    [xL, yB],
  ];
}

/** True iff two [x,y,w,h] rects share interior area. */
export function rectsOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  return (
    Math.min(ax + aw, bx + bw) - Math.max(ax, bx) > 0 &&
    Math.min(ay + ah, by + bh) - Math.max(ay, by) > 0
  );
}

function applyOffset<T extends SeparableRoom>(room: T, dx: number, dy: number): T {
  return {
    ...room,
    polygon: room.polygon.map(([x, y]) => [x + dx, y + dy] as Point),
  };
}

/**
 * Keep a room inside the canvas.
 *
 * NOTE the shape cost: when a room must be pulled back in, its polygon is
 * replaced by its bounding rectangle. That is the one place this operation is
 * not shape-preserving.
 */
export function clampToViewBox<T extends SeparableRoom>(
  room: T,
  vw: number,
  vh: number,
): T {
  const [x, y, w, h] = polygonToRect(room.polygon);
  const nw = Math.min(w, vw);
  const nh = Math.min(h, vh);
  let nx = x;
  let ny = y;
  if (nx < 0) nx = 0;
  if (ny < 0) ny = 0;
  if (nx + nw > vw) nx = vw - nw;
  if (ny + nh > vh) ny = vh - nh;
  if (nx === x && ny === y && nw === w && nh === h) return room;
  return { ...room, polygon: rectFromBbox(nx, ny, nx + nw, ny + nh) };
}

export const MAX_SEPARATION_ITERATIONS = 80;
export const SEPARATION_GAP = 4;

/**
 * Push overlapping rooms apart along the shallower overlap axis, iterating
 * until nothing moves or the cap is hit. Deterministic: same input, same
 * output, and rooms are only ever translated (subject to the clamp caveat).
 */
export function separateOverlappingRooms<T extends SeparableRoom>(
  rooms: T[],
  vw: number,
  vh: number,
): T[] {
  let next = rooms.map((r) => ({ ...r }));

  for (let iter = 0; iter < MAX_SEPARATION_ITERATIONS; iter++) {
    let movedAny = false;

    for (let i = 0; i < next.length - 1; i++) {
      for (let j = i + 1; j < next.length; j++) {
        const [ax, ay, aw, ah] = polygonToRect(next[i]!.polygon);
        const [bx, by, bw, bh] = polygonToRect(next[j]!.polygon);

        const overlapX = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
        const overlapY = Math.min(ay + ah, by + bh) - Math.max(ay, by);

        if (overlapX > 0 && overlapY > 0) {
          movedAny = true;
          if (overlapX < overlapY) {
            const push = (overlapX + SEPARATION_GAP) / 2;
            if (ax + aw / 2 < bx + bw / 2) {
              next[i] = applyOffset(next[i]!, -push, 0);
              next[j] = applyOffset(next[j]!, push, 0);
            } else {
              next[i] = applyOffset(next[i]!, push, 0);
              next[j] = applyOffset(next[j]!, -push, 0);
            }
          } else {
            const push = (overlapY + SEPARATION_GAP) / 2;
            if (ay + ah / 2 < by + bh / 2) {
              next[i] = applyOffset(next[i]!, 0, -push);
              next[j] = applyOffset(next[j]!, 0, push);
            } else {
              next[i] = applyOffset(next[i]!, 0, push);
              next[j] = applyOffset(next[j]!, 0, -push);
            }
          }
        }
      }
    }

    next = next.map((r) => clampToViewBox(r, vw, vh));
    if (!movedAny) break;
  }

  return next;
}

/** Count of rooms involved in at least one overlap, for the editor badge. */
export function overlappingCount<T extends SeparableRoom>(rooms: T[]): number {
  const flagged = new Set<number>();
  for (let i = 0; i < rooms.length - 1; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (rectsOverlap(polygonToRect(rooms[i]!.polygon), polygonToRect(rooms[j]!.polygon))) {
        flagged.add(i);
        flagged.add(j);
      }
    }
  }
  return flagged.size;
}
