// =============================================================================
// lib/plan/door-hinge.ts — which jamb a door hangs on (bathroom pilot B7 2). Pure.
//
// Stored on the opening's spec:
//   spec.hinge_side   "left" | "right" — AS SEEN FROM INSIDE THE ROOM, facing the
//                     door (the way a client describes it);
//   spec.hinge        legacy compass ("W"), B6 — still honoured.
// With neither, the hinge is ESTIMATED on the jamb nearer a room corner (where a
// door is usually hung, so the leaf opens against the wall) and every surface
// that shows it says so.
//
// Works in any consistent space: plan metres for the drawings, viewBox pixels
// for the editor — only directions and distances are compared.
// =============================================================================

export type V2 = readonly [number, number];
export type HingeSide = "left" | "right";
export type HingeSource = "entered" | "estimate";

export interface HingeResolution {
  hinge: [number, number];
  free: [number, number];
  side: HingeSide;
  source: HingeSource;
  /** The legacy compass letter when that is what was stored. */
  compass: string | null;
}

const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The viewer's right, standing in the room facing the wall (y down, like the plan). */
export function rightOf(inward: V2): [number, number] {
  // Facing the wall = −inward; right = facing rotated +90° in a y-down frame.
  return [inward[1], -inward[0]];
}

export function hingeSideOf(spec: Record<string, unknown> | null | undefined): HingeSide | null {
  const s = spec?.hinge_side;
  return s === "left" || s === "right" ? s : null;
}

/**
 * Resolve the hinge jamb of a door with jambs `j0`, `j1` on a wall running
 * `wallA` → `wallB`, whose room is on the `inward` side.
 */
export function resolveHinge(j0: V2, j1: V2, inward: V2, wallA: V2, wallB: V2, spec: Record<string, unknown> | null | undefined): HingeResolution {
  const r = rightOf(inward);
  const sideOfJamb = (j: V2, other: V2): HingeSide => (dot(j, r) >= dot(other, r) ? "right" : "left");
  const pick = (hinge: V2, free: V2, source: HingeSource, compass: string | null): HingeResolution => ({ hinge: [hinge[0], hinge[1]], free: [free[0], free[1]], side: sideOfJamb(hinge, free), source, compass });

  const side = hingeSideOf(spec);
  if (side) {
    const j0Right = dot(j0, r) >= dot(j1, r);
    return side === "right" ? (j0Right ? pick(j0, j1, "entered", null) : pick(j1, j0, "entered", null)) : j0Right ? pick(j1, j0, "entered", null) : pick(j0, j1, "entered", null);
  }
  const compass = typeof spec?.hinge === "string" ? spec.hinge.toUpperCase() : null;
  const dir: Record<string, V2> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  if (compass && dir[compass]) return dot(j0, dir[compass]!) >= dot(j1, dir[compass]!) ? pick(j0, j1, "entered", compass) : pick(j1, j0, "entered", compass);
  // Estimate: the jamb nearer a corner of its wall.
  const near = (j: V2) => Math.min(dist(j, wallA), dist(j, wallB));
  return near(j0) <= near(j1) ? pick(j0, j1, "estimate", null) : pick(j1, j0, "estimate", null);
}

/** The words every surface uses for it. */
export function hingeLabel(h: Pick<HingeResolution, "side" | "source">): string {
  return h.source === "estimate" ? `Hinge ${h.side} — estimated (the side nearer the corner); confirm on site` : `Hinge ${h.side}, as seen from the room`;
}
