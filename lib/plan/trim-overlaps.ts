// =============================================================================
// lib/plan/trim-overlaps.ts — "Fix overlaps" that never moves a room (15 Oct).
//
// The editor's old fix (`separateOverlappingRooms`, lib/plan/separate.ts) pushed
// whole rooms apart by their bounding boxes. On prod Mudon that walked Bedroom 3,
// Bath, Toilet, Bedroom 4, the Passage and the terraces off the building — the
// areas held, the positions did not, and everything positional (openings,
// cameras, drawings) read the drifted geometry. Ruled 14–15 Oct: a fix must
// never move a room.
//
// Here an overlap is resolved by TRIMMING the shared floor from one room — a
// boolean difference, so the trimmed room can only lose area and every one of
// its points stays inside its own outline as it was. Which room keeps the floor
// follows the parse repair (lib/parse/repair.ts): the surer room (confidence),
// then the SMALLER room (a specific room — an ensuite drawn inside a bedroom's
// overstated outline — keeps its floor and carves the container), then id.
//
// What it will not do, and says so (`unresolved`):
//   - remove a room entirely (one room wholly covered by another);
//   - cut a hole (one room wholly INSIDE another — a room outline cannot carry a
//     hole; split the container on the plan instead).
// Pure, deterministic, unit-tested; same detector as everything else
// (`sharedArea` / OVERLAP_AREA_EPSILON from lib/plan/overlaps.ts).
// =============================================================================

import polygonClipping from "polygon-clipping";

import { OVERLAP_AREA_EPSILON, sharedArea } from "./overlaps";
import { pointInPolygon, pointToSegment, polygonArea, type Pt } from "./polygon";

export interface TrimmableRoom {
  id: string;
  polygon: Pt[];
  name?: string | null;
  confidence?: number | null;
}

export interface TrimRecord {
  /** The room that lost floor. */
  id: string;
  /** The room that kept it. */
  kept_by: string;
  /** Area removed, in the polygons' own units². */
  removed: number;
}

export interface Unresolved {
  a_id: string;
  b_id: string;
  reason: "would_remove_room" | "would_cut_hole" | "clipping_failed";
}

const DEFAULT_CONFIDENCE = 0.7;

function closedRing(poly: Pt[]): number[][] {
  const ring = poly.map(([x, y]) => [x, y]);
  const f = ring[0]!, l = ring[ring.length - 1]!;
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0]!, f[1]!]);
  return ring;
}

/** Open ring, consecutive duplicates and collinear points dropped. */
function openRing(ring: number[][], eps: number): Pt[] {
  const pts: Pt[] = [];
  for (const [x, y] of ring) {
    const p: Pt = [x!, y!];
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > eps) pts.push(p);
  }
  if (pts.length > 1) {
    const f = pts[0]!, l = pts[pts.length - 1]!;
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= eps) pts.pop();
  }
  // Drop collinear middle points.
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]!, b = pts[i]!, c = pts[(i + 1) % pts.length]!;
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) <= eps * eps) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Who keeps the shared floor: true when `a` outranks `b`. */
function outranks(a: TrimmableRoom, b: TrimmableRoom): boolean {
  const ca = a.confidence ?? DEFAULT_CONFIDENCE, cb = b.confidence ?? DEFAULT_CONFIDENCE;
  if (Math.abs(ca - cb) > 1e-9) return ca > cb;
  const aa = polygonArea(a.polygon), ab = polygonArea(b.polygon);
  if (Math.abs(aa - ab) > 1e-12) return aa < ab;
  return a.id < b.id;
}

/**
 * Pure: is every point of `after` inside (or within `tol` of the outline of)
 * `before`? The invariant "Fix overlaps never moves a room" in one test.
 */
export function staysWithin(before: Pt[], after: Pt[], tol: number): boolean {
  return after.every((p) => {
    if (pointInPolygon(p, before)) return true;
    for (let i = 0; i < before.length; i++) {
      if (pointToSegment(p, before[i]!, before[(i + 1) % before.length]!).dist <= tol) return true;
    }
    return false;
  });
}

/**
 * Resolve overlaps by trimming. Returns the rooms (same order, untouched rooms
 * are the SAME objects), what was trimmed, and what could not be resolved.
 */
export function trimOverlappingRooms<T extends TrimmableRoom>(rooms: readonly T[]): { rooms: T[]; trimmed: TrimRecord[]; unresolved: Unresolved[] } {
  const out = rooms.map((r) => r);
  const trimmed: TrimRecord[] = [];
  const unresolved: Unresolved[] = [];
  const skip = new Set<string>();
  const scale = Math.max(1e-9, ...rooms.flatMap((r) => r.polygon.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])));
  const eps = scale * 1e-7;

  // Largest shared area first, so a big overlap is settled before its slivers.
  for (let pass = 0; pass < rooms.length * rooms.length; pass++) {
    let worst: { i: number; j: number; shared: number } | null = null;
    for (let i = 0; i < out.length - 1; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!, b = out[j]!;
        if (skip.has(`${a.id}|${b.id}`)) continue;
        const shared = sharedArea(a.polygon, b.polygon);
        const floor = OVERLAP_AREA_EPSILON * Math.min(polygonArea(a.polygon), polygonArea(b.polygon));
        if (shared > floor && (!worst || shared > worst.shared)) worst = { i, j, shared };
      }
    }
    if (!worst) break;
    const a = out[worst.i]!, b = out[worst.j]!;
    const [keepIdx, loseIdx] = outranks(a, b) ? [worst.i, worst.j] : [worst.j, worst.i];
    const keeper = out[keepIdx]!, loser = out[loseIdx]!;
    const pairKey = `${a.id}|${b.id}`;
    let mp: number[][][][];
    try {
      mp = polygonClipping.difference([closedRing(loser.polygon)] as never, [closedRing(keeper.polygon)] as never) as unknown as number[][][][];
    } catch {
      unresolved.push({ a_id: loser.id, b_id: keeper.id, reason: "clipping_failed" });
      skip.add(pairKey);
      continue;
    }
    if (mp.length === 0) {
      unresolved.push({ a_id: loser.id, b_id: keeper.id, reason: "would_remove_room" });
      skip.add(pairKey);
      continue;
    }
    // The largest piece; a piece with a hole means the keeper sits inside the loser.
    const pieces = mp.map((poly) => ({ poly, area: polygonArea(openRing(poly[0]!, eps)) })).sort((x, y) => y.area - x.area);
    const best = pieces[0]!;
    if (best.poly.length > 1) {
      unresolved.push({ a_id: loser.id, b_id: keeper.id, reason: "would_cut_hole" });
      skip.add(pairKey);
      continue;
    }
    const polygon = openRing(best.poly[0]!, eps);
    if (polygon.length < 3) {
      unresolved.push({ a_id: loser.id, b_id: keeper.id, reason: "would_remove_room" });
      skip.add(pairKey);
      continue;
    }
    const removed = polygonArea(loser.polygon) - polygonArea(polygon);
    out[loseIdx] = { ...loser, polygon };
    trimmed.push({ id: loser.id, kept_by: keeper.id, removed });
  }
  return { rooms: out, trimmed, unresolved };
}
