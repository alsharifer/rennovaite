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
// This module is the single detector both paths use, so the banner the user
// sees and the 409 they get can never disagree. Pure: no DB, no React.
// =============================================================================

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

/**
 * Find every overlapping room pair.
 *
 * Bounding-box test, deliberately: it is exactly what the editor already
 * highlights and what `separateOverlappingRooms` resolves, so the banner, the
 * fix button and the 409 all agree. A polygon-exact test would flag pairs the
 * editor's fix could not clear, which would be worse than a slightly
 * conservative one. Rooms with an unusable polygon are skipped rather than
 * guessed at.
 */
export function findOverlaps(rooms: OverlapRoom[]): OverlapReport {
  const usable = rooms
    .map((r) => ({ r, poly: toPolygon(r.polygon) }))
    .filter((x): x is { r: OverlapRoom; poly: Pt[] } => x.poly !== null)
    .map((x) => ({ r: x.r, box: bbox(x.poly) }));

  const pairs: OverlapPair[] = [];
  for (let i = 0; i < usable.length - 1; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (!boxesOverlap(usable[i]!.box, usable[j]!.box)) continue;
      pairs.push({
        a_id: usable[i]!.r.id,
        a_name: usable[i]!.r.name,
        b_id: usable[j]!.r.id,
        b_name: usable[j]!.r.name,
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
