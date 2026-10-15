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
// EXACTLY the overlap, never more (15 Oct review): a trim that would split a
// room into pieces is tried the other way round, and reported if both ways
// split — dropping a piece would remove floor that was never shared. Areas are
// kept the same way: a trimmed room's area_m2 drops by exactly the floor
// removed (at the caller's m² per unit²), so the total falls by exactly the
// double-counted floor. (The first version re-measured trimmed rooms from their
// outline while the others kept the reading's areas — two measures summed; on
// the J0 scratch the editor showed 108.8 m² where the rooms combine to 112.8 at
// its scale, 128.6 at the plan's.)
//
// Printed sizes (15 Oct): when the sheet prints a room's size, the room further
// OVER its printed area loses the shared floor; with one printed room only, it
// loses when its outline is over its printed size. Otherwise the parse repair's
// order (confidence, then the smaller room keeps it).
//
// What it will not do, and says so (`unresolved`):
//   - remove a room entirely (one room wholly covered by another);
//   - cut a hole (one room wholly INSIDE another — a room outline cannot carry a
//     hole; split the container on the plan instead);
//   - split a room in two (both ways round).
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
  /** The room's area as the plan carries it (m²); reduced by exactly what is trimmed. */
  area_m2?: number | null;
  /** The size the sheet prints for this room (m²), when it prints one. */
  printed_m2?: number | null;
}

export interface TrimOptions {
  /** m² per polygon unit² — needed for areas and for the printed-size rule. */
  m2PerUnit2?: number;
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
  reason: "would_remove_room" | "would_cut_hole" | "would_split_room" | "clipping_failed";
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

/** How far a room's outline is over its printed size (0.1 = 10% over); null when nothing is printed. */
export function overPrinted(room: TrimmableRoom, m2PerUnit2: number | undefined): number | null {
  if (!room.printed_m2 || room.printed_m2 <= 0 || !m2PerUnit2) return null;
  return (polygonArea(room.polygon) * m2PerUnit2) / room.printed_m2 - 1;
}

/** Who keeps the shared floor: true when `a` outranks `b`. */
function outranks(a: TrimmableRoom, b: TrimmableRoom, k: number | undefined): boolean {
  const oa = overPrinted(a, k), ob = overPrinted(b, k);
  if (oa !== null && ob !== null && Math.abs(oa - ob) > 1e-9) return oa < ob; // further over loses
  if (oa !== null && ob === null && oa > 0) return false;
  if (ob !== null && oa === null && ob > 0) return true;
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
type Mp = number[][][][];

/** Trim `loser` by `keeper`: the single piece left, or why not. */
function cut(loser: TrimmableRoom, keeper: TrimmableRoom, eps: number): { polygon: Pt[] } | { reason: Unresolved["reason"] } {
  let mp: Mp;
  try {
    mp = polygonClipping.difference([closedRing(loser.polygon)] as never, [closedRing(keeper.polygon)] as never) as unknown as Mp;
  } catch {
    return { reason: "clipping_failed" };
  }
  const sliver = polygonArea(loser.polygon) * OVERLAP_AREA_EPSILON;
  const pieces = mp.map((poly) => ({ poly, area: polygonArea(openRing(poly[0]!, eps)) })).filter((p) => p.area > sliver);
  if (pieces.length === 0) return { reason: "would_remove_room" };
  if (pieces.length > 1) return { reason: "would_split_room" };
  if (pieces[0]!.poly.length > 1) return { reason: "would_cut_hole" };
  const polygon = openRing(pieces[0]!.poly[0]!, eps);
  return polygon.length < 3 ? { reason: "would_remove_room" } : { polygon };
}

/**
 * Resolve overlaps by trimming. Returns the rooms (same order, untouched rooms
 * are the SAME objects), what was trimmed, what could not be resolved, and —
 * with `m2PerUnit2` — the plan's total before and after (Σ area_m2).
 */
export function trimOverlappingRooms<T extends TrimmableRoom>(
  rooms: readonly T[],
  opts: TrimOptions = {},
): { rooms: T[]; trimmed: TrimRecord[]; unresolved: Unresolved[]; total_before_m2: number | null; total_after_m2: number | null } {
  const k = opts.m2PerUnit2;
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
    const pairKey = `${a.id}|${b.id}`;
    const [keepIdx, loseIdx] = outranks(a, b, k) ? [worst.i, worst.j] : [worst.j, worst.i];
    // The ranked way first; if that would split the loser (or cut a hole in it), the other way.
    const attempts: [number, number][] = [[keepIdx, loseIdx], [loseIdx, keepIdx]];
    let done = false;
    let firstReason: Unresolved["reason"] | null = null;
    for (const [ki, li] of attempts) {
      const res = cut(out[li]!, out[ki]!, eps);
      if ("reason" in res) {
        firstReason ??= res.reason;
        if (res.reason === "would_split_room" || res.reason === "would_cut_hole") continue;
        break;
      }
      const loser = out[li]!;
      const removed = polygonArea(loser.polygon) - polygonArea(res.polygon);
      const area = typeof loser.area_m2 === "number" && k ? Math.round((loser.area_m2 - removed * k) * 100) / 100 : loser.area_m2;
      out[li] = { ...loser, polygon: res.polygon, ...(area !== undefined ? { area_m2: area } : {}) };
      trimmed.push({ id: loser.id, kept_by: out[ki]!.id, removed });
      done = true;
      break;
    }
    if (!done) {
      unresolved.push({ a_id: out[loseIdx]!.id, b_id: out[keepIdx]!.id, reason: firstReason ?? "clipping_failed" });
      skip.add(pairKey);
    }
  }
  const total = (list: readonly TrimmableRoom[]) => (list.every((r) => typeof r.area_m2 === "number") ? Math.round(list.reduce((acc, r) => acc + (r.area_m2 as number), 0) * 100) / 100 : null);
  return { rooms: out, trimmed, unresolved, total_before_m2: total(rooms), total_after_m2: total(out) };
}
