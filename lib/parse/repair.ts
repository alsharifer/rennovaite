// =============================================================================
// lib/parse/repair.ts — deterministic overlap elimination for parsed rooms.
//
// Providers return rooms as normalised N-vertex polygons that may overlap (an
// LLM/vision parse is not topology-aware). This carves overlaps away so that
// pairwise room-polygon intersection is ∅, snaps to a 1 mm grid and drops float
// slivers. Pure + deterministic (stable ordering); unit-tested. Boolean
// difference via `polygon-clipping`.
//
// REPAIR ADJUSTS GEOMETRY, NOT AREAS. It used to recompute every area by
// rescaling polygon share to total_area_m2, which threw away the best number in
// the whole pipeline: on a vector sheet the provider's area is the drawing's own
// "3985X5000" label. Measured on the pilot sheet, that rescaling turned eight
// exactly-correct room areas into eight that were 16–51% out. So a provider area
// now survives repair, and geometry only overrides it when the two cannot be
// describing the same room — and even then only when the area was the model's
// own ESTIMATE. An area MEASURED off a printed dimension is never overwritten;
// a disagreement there flags the outline for review (disputed_area_room_ids)
// instead of replacing the architect's number with a vision model's.
// =============================================================================

import polygonClipping from "polygon-clipping";

import { polygonArea, snapToGrid, type Pt } from "@/lib/plan/polygon";

import {
  AREA_CONTRADICTION_FLOOR_M2,
  AREA_CONTRADICTION_RATIO,
  CARVE_DOWNGRADE_FRACTION,
  DEFAULT_PARSE_CONFIDENCE,
  LOW_CONFIDENCE_FLAG,
  SLIVER_AREA_M2,
  SNAP_GRID_MM,
} from "./constants";

// polygon-clipping's structural types (Position/Ring/Polygon/MultiPolygon).
type Ring = number[][];
type Poly = Ring[];
type MultiPoly = Poly[];

export interface RepairInputRoom {
  id: string;
  polygon: Pt[]; // normalised, open (first vertex not repeated)
  area_m2?: number | null;
  /** Where `area_m2` came from. "measured" is a dimension printed on the
   *  drawing and is never overwritten; anything else is a guess geometry may
   *  overrule. Defaults to "estimated". */
  area_source?: "measured" | "estimated" | null;
  confidence?: number | null;
}

export type RepairedRoom<T> = T & {
  polygon: Pt[];
  area_m2: number;
  confidence: number;
  /** True when this room's area came from its geometry because the provider
   *  gave none, or gave one the polygon materially contradicts. */
  area_derived: boolean;
};

export interface RepairSummary {
  rooms_in: number;
  rooms_out: number;
  dropped_room_ids: string[]; // rooms fully consumed by higher-priority rooms
  sliver_parts_dropped: number;
  carved_room_ids: string[]; // rooms that lost > CARVE_DOWNGRADE_FRACTION of area
  /** Rooms whose area is geometry-derived rather than provider-stated. */
  derived_area_room_ids: string[];
  /** Rooms that kept the area their provider reported. */
  stated_area_room_ids: string[];
  /** Rooms whose area was MEASURED off the drawing but whose polygon
   *  materially disagrees. The measurement is kept — a vision model's estimate
   *  does not overrule a dimension the architect printed — but the room is
   *  flagged so someone checks the outline. */
  disputed_area_room_ids: string[];
  area_sum_m2: number;
  total_area_m2: number;
}

function toClosedRing(poly: Pt[]): Ring {
  const ring: Ring = poly.map(([x, y]) => [x, y]);
  const f = ring[0]!;
  const l = ring[ring.length - 1]!;
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0]!, f[1]!]);
  return ring;
}

function ringToOpenPts(ring: Ring, snapEps: number): Pt[] {
  const pts: Pt[] = [];
  for (const p of ring) {
    const x = snapToGrid(p[0]!, snapEps);
    const y = snapToGrid(p[1]!, snapEps);
    const last = pts[pts.length - 1];
    if (!last || last[0] !== x || last[1] !== y) pts.push([x, y]);
  }
  // Drop trailing point equal to the first (rings are closed).
  if (pts.length > 1) {
    const f = pts[0]!;
    const l = pts[pts.length - 1]!;
    if (f[0] === l[0] && f[1] === l[1]) pts.pop();
  }
  return pts;
}

/**
 * Eliminate pairwise room overlaps. Rooms are claimed in priority order
 * (confidence desc, then area desc, then id asc — fully deterministic); each
 * room keeps only the space not already claimed by a higher-priority room.
 */
export function repairOverlaps<T extends RepairInputRoom>(
  rooms: T[],
  opts: { totalAreaM2: number },
): { rooms: RepairedRoom<T>[]; summary: RepairSummary } {
  const totalAreaM2 = opts.totalAreaM2 > 0 ? opts.totalAreaM2 : 0;

  // Provisional scale (overlap-inflated) — thresholds only, NOT final areas.
  const provNormArea = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
  const provUnitToM =
    provNormArea > 0 && totalAreaM2 > 0 ? Math.sqrt(totalAreaM2 / provNormArea) : 1;
  const snapEps = provUnitToM > 0 ? SNAP_GRID_MM / 1000 / provUnitToM : 0;
  const sliverNorm = provUnitToM > 0 ? SLIVER_AREA_M2 / (provUnitToM * provUnitToM) : 0;

  // Priority: higher confidence first; then SMALLER area first (a specific room
  // — e.g. an ensuite drawn inside a bedroom's overstated bbox — should claim
  // its space and carve the container, not be consumed by it); then id (stable,
  // float-noise-proof via an area epsilon).
  const order = [...rooms].sort((a, b) => {
    const ca = a.confidence ?? DEFAULT_PARSE_CONFIDENCE;
    const cb = b.confidence ?? DEFAULT_PARSE_CONFIDENCE;
    if (Math.abs(cb - ca) > 1e-9) return cb - ca;
    const aa = polygonArea(a.polygon);
    const ab = polygonArea(b.polygon);
    if (Math.abs(ab - aa) > 1e-9) return aa - ab;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let claimed: MultiPoly | null = null;
  let sliverPartsDropped = 0;
  const droppedRoomIds: string[] = [];
  const carvedRoomIds: string[] = [];
  const kept = new Map<string, { pts: Pt[]; areaNorm: number; confidence: number }>();

  for (const room of order) {
    const origArea = polygonArea(room.polygon);
    const subject: Poly = [toClosedRing(room.polygon)];

    let resultMP: MultiPoly;
    try {
      resultMP = claimed
        ? (polygonClipping.difference(subject as never, claimed as never) as MultiPoly)
        : [subject];
    } catch {
      resultMP = [subject]; // clipping failed — keep original (rare; clean input)
    }

    // Keep the largest non-sliver outer ring; count the rest as dropped slivers.
    let best: { pts: Pt[]; areaNorm: number } | null = null;
    for (const poly of resultMP) {
      const outer = poly[0];
      if (!outer) continue;
      const pts = ringToOpenPts(outer, snapEps);
      if (pts.length < 3) continue;
      const areaNorm = polygonArea(pts);
      if (areaNorm < sliverNorm) {
        sliverPartsDropped++;
        continue;
      }
      if (!best) best = { pts, areaNorm };
      else if (areaNorm > best.areaNorm) {
        sliverPartsDropped++; // previous best was a smaller (but non-sliver) part
        best = { pts, areaNorm };
      } else {
        sliverPartsDropped++;
      }
    }

    if (!best) {
      droppedRoomIds.push(room.id); // fully consumed by a higher-priority room
      continue;
    }

    const carveFraction = origArea > 0 ? 1 - best.areaNorm / origArea : 0;
    let confidence = room.confidence ?? DEFAULT_PARSE_CONFIDENCE;
    if (carveFraction > CARVE_DOWNGRADE_FRACTION) {
      carvedRoomIds.push(room.id);
      confidence = Math.min(confidence, LOW_CONFIDENCE_FLAG - 0.05);
    }
    kept.set(room.id, { pts: best.pts, areaNorm: best.areaNorm, confidence });

    const finalPoly: Poly = [toClosedRing(best.pts)];
    try {
      claimed = claimed
        ? (polygonClipping.union(claimed as never, finalPoly as never) as MultiPoly)
        : [finalPoly];
    } catch {
      claimed = claimed ? [...claimed, finalPoly] : [finalPoly];
    }
  }

  // Normalised-area → m² factor, used ONLY to sanity-check a stated area and to
  // fill in for a room that has none. It is fitted to the rooms that DO carry a
  // provider area, so the check compares like with like; total_area_m2 is the
  // fallback for a parse that states no areas at all.
  const kernel = rooms
    .map((r) => ({ stated: r.area_m2 ?? 0, k: kept.get(r.id) }))
    .filter((x) => x.k !== undefined && x.stated > 0);
  const statedSum = kernel.reduce((s, x) => s + x.stated, 0);
  const kernelNormArea = kernel.reduce((s, x) => s + x.k!.areaNorm, 0);
  const postNormArea = [...kept.values()].reduce((s, k) => s + k.areaNorm, 0);
  const normToM2 =
    kernelNormArea > 0 && statedSum > 0
      ? statedSum / kernelNormArea
      : postNormArea > 0 && totalAreaM2 > 0
        ? totalAreaM2 / postNormArea
        : 1;

  const outRooms: RepairedRoom<T>[] = [];
  const derivedAreaRoomIds: string[] = [];
  const statedAreaRoomIds: string[] = [];
  const disputedAreaRoomIds: string[] = [];
  let areaSum = 0;
  for (const room of rooms) {
    const k = kept.get(room.id);
    if (!k) continue; // dropped
    const geometric = Math.round(k.areaNorm * normToM2 * 100) / 100;
    const stated = room.area_m2 ?? 0;
    const measured = room.area_source === "measured";

    // "Materially contradicts" needs BOTH tests. Ratio alone is unusable on
    // small rooms: a 2.7 m² toilet drawn one wall too generously trips 2x over
    // a gap no quantity surveyor would argue about.
    const contradicts =
      stated > 0 &&
      geometric > 0 &&
      Math.max(stated, geometric) / Math.min(stated, geometric) > AREA_CONTRADICTION_RATIO &&
      Math.abs(stated - geometric) > AREA_CONTRADICTION_FLOOR_M2;

    let area_m2 = geometric;
    let area_derived = true;
    let confidence = k.confidence;

    if (stated > 0 && (measured || !contradicts || geometric <= 0)) {
      // Keep what we were told. A measured area is a dimension the architect
      // printed, and a vision model's read of where the walls are does not get
      // to overrule it — the right response to a disagreement is to flag the
      // outline for review, not to replace a measurement with an estimate.
      area_m2 = Math.round(stated * 100) / 100;
      area_derived = false;
      statedAreaRoomIds.push(room.id);
      if (contradicts) {
        disputedAreaRoomIds.push(room.id);
        confidence = Math.min(confidence, LOW_CONFIDENCE_FLAG - 0.05);
      }
    } else if (stated > 0) {
      // An estimate the geometry contradicts. Geometry wins, and somebody
      // should look at the room.
      derivedAreaRoomIds.push(room.id);
      confidence = Math.min(confidence, LOW_CONFIDENCE_FLAG - 0.05);
    }
    // else: no area at all was reported; geometry is the only source there is.

    areaSum += area_m2;
    outRooms.push({ ...room, polygon: k.pts, area_m2, confidence, area_derived });
  }

  return {
    rooms: outRooms,
    summary: {
      rooms_in: rooms.length,
      rooms_out: outRooms.length,
      dropped_room_ids: droppedRoomIds,
      sliver_parts_dropped: sliverPartsDropped,
      carved_room_ids: carvedRoomIds,
      derived_area_room_ids: derivedAreaRoomIds,
      stated_area_room_ids: statedAreaRoomIds,
      disputed_area_room_ids: disputedAreaRoomIds,
      area_sum_m2: Math.round(areaSum * 100) / 100,
      total_area_m2: totalAreaM2,
    },
  };
}
