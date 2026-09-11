// =============================================================================
// lib/plan/overlaps.ts — the one overlap detector (D3).
//
// Overlapping rooms are a legitimate TRANSIENT state while editing: dragging a
// room across another creates one, and refusing to save that would put a user's
// unsaved work one refresh away from being lost. So saving is always allowed.
//
// What overlaps actually harm is QUANTITIES — two rooms claiming the same floor
// double-count area, and shared-edge wall derivation double-counts wall. That
// happens at take-off, so that is where the invariant is enforced: the save
// records `has_overlaps`, and BoQ generation refuses.
//
// This module is the single detector every path uses — the editor banner, the
// save record and the BoQ 409 — so they can never disagree. Pure: no DB, no
// React.
//
// It tests POLYGONS, not bounding boxes. It used to test boxes, on the argument
// that the editor's rigid-translation "fix overlaps" could always clear what was
// flagged. That was true but it flagged plans that were already correct: overlap
// repair carves L-shapes, and an L's bounding box keeps intersecting its
// neighbour's long after the two rooms stop sharing a square millimetre. On the
// pilot sheet that reported three overlaps on a plan with zero, and the 409
// refused to cost it. Box overlap is a strict superset of polygon overlap, so
// moving to polygons only ever flags LESS, and the editor's fix still clears
// everything that is flagged.
// =============================================================================

import polygonClipping from "polygon-clipping";

import { polygonArea } from "./polygon";

export interface OverlapRoom {
  id: string;
  name: string;
  /** Any coordinate space — detection is scale-invariant. */
  polygon: unknown;
}

export interface OverlapPair {
  a_id: string;
  a_name: string;
  b_id: string;
  b_name: string;
}

export interface OverlapReport {
  has_overlaps: boolean;
  pairs: OverlapPair[];
  /** Distinct room ids involved in at least one overlap. */
  room_ids: string[];
  /** Distinct room names, for message copy. */
  room_names: string[];
}

export const EMPTY_OVERLAP_REPORT: OverlapReport = {
  has_overlaps: false,
  pairs: [],
  room_ids: [],
  room_names: [],
};

type Pt = [number, number];

function toPolygon(value: unknown): Pt[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const pts: Pt[] = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push([x, y]);
  }
  return pts;
}

/** Axis-aligned bounding box as [xL, yT, xR, yB]. */
function bbox(poly: Pt[]): [number, number, number, number] {
  let xL = Infinity,
    yT = Infinity,
    xR = -Infinity,
    yB = -Infinity;
  for (const [x, y] of poly) {
    if (x < xL) xL = x;
    if (y < yT) yT = y;
    if (x > xR) xR = x;
    if (y > yB) yB = y;
  }
  return [xL, yT, xR, yB];
}

/**
 * True when two boxes share INTERIOR area. Touching edges are not an overlap —
 * adjacent rooms share a wall by construction, and flagging those would make
 * every plan permanently invalid.
 */
export function boxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
  eps = 1e-9,
): boolean {
  return (
    Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > eps &&
    Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > eps
  );
}

/** Shared area below this fraction of the smaller room is a rounding artefact,
 *  not an overlap. Relative, so the test stays scale-invariant: the same plan
 *  in normalised [0,1] and in pixels must give the same answer. */
export const OVERLAP_AREA_EPSILON = 1e-4;

function closedRing(poly: Pt[]): number[][] {
  const ring: number[][] = poly.map(([x, y]) => [x, y]);
  const f = ring[0]!;
  const l = ring[ring.length - 1]!;
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0]!, f[1]!]);
  return ring;
}

/** Area two polygons share. 0 when they only touch along an edge. */
export function sharedArea(a: Pt[], b: Pt[]): number {
  try {
    const mp = polygonClipping.intersection(
      [closedRing(a)] as never,
      [closedRing(b)] as never,
    ) as unknown as Pt[][][];
    let out = 0;
    for (const poly of mp) {
      for (let i = 0; i < poly.length; i++) {
        const ring = polygonArea(poly[i]!);
        out += i === 0 ? ring : -ring; // subtract holes
      }
    }
    return out;
  } catch {
    // Clipping failed on a degenerate ring. Fall back to the bounding boxes,
    // which over-report: a false alarm someone can clear beats a silent
    // double-count in the take-off.
    return boxesOverlap(bbox(a), bbox(b)) ? Infinity : 0;
  }
}

/**
 * Find every overlapping room pair.
 *
 * Polygon-exact, with the bounding boxes as a cheap prefilter (box overlap is a
 * superset of polygon overlap, so the prefilter can never drop a real pair).
 * Adjacency is not an overlap: adjacent rooms share a wall line by
 * construction. Rooms with an unusable polygon are skipped rather than guessed
 * at.
 */
export function findOverlaps(rooms: OverlapRoom[]): OverlapReport {
  const usable = rooms
    .map((r) => ({ r, poly: toPolygon(r.polygon) }))
    .filter((x): x is { r: OverlapRoom; poly: Pt[] } => x.poly !== null)
    .map((x) => ({ r: x.r, poly: x.poly, box: bbox(x.poly), area: polygonArea(x.poly) }));

  const pairs: OverlapPair[] = [];
  for (let i = 0; i < usable.length - 1; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i]!;
      const b = usable[j]!;
      if (!boxesOverlap(a.box, b.box)) continue;
      const smaller = Math.min(a.area, b.area);
      if (!(sharedArea(a.poly, b.poly) > smaller * OVERLAP_AREA_EPSILON)) continue;
      pairs.push({
        a_id: a.r.id,
        a_name: a.r.name,
        b_id: b.r.id,
        b_name: b.r.name,
      });
    }
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const p of pairs) {
    ids.add(p.a_id);
    ids.add(p.b_id);
    names.add(p.a_name);
    names.add(p.b_name);
  }

  return {
    has_overlaps: pairs.length > 0,
    pairs,
    room_ids: [...ids],
    room_names: [...names],
  };
}

/** One-line summary for an error body or a banner. */
export function describeOverlaps(report: OverlapReport): string {
  if (!report.has_overlaps) return "No overlapping rooms.";
  const n = report.room_names.length;
  return `${n} overlapping room${n === 1 ? "" : "s"}: ${report.room_names.join(", ")}`;
}
