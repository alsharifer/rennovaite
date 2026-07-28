// =============================================================================
// lib/drawings/dimensions.ts — pure, rule-based dimensioning of a PlanGraph.
//
// No SVG, no DOM, no LLM — just geometry → dimension values. Used by
// plan-sheet.ts to place dimension chains, and unit-tested for closure.
// =============================================================================

import type { PlanGraph, Point, Room } from "@/lib/plan/geometry";

export type Axis = "x" | "y";

export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DimSegment {
  from: number; // metres along the axis
  to: number;
  length_mm: number; // rounded to whole millimetres (drawing convention)
}

const AXIS_INDEX: Record<Axis, 0 | 1> = { x: 0, y: 1 };

export function bboxOfPoints(pts: Point[]): Bbox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function graphBbox(graph: PlanGraph): Bbox {
  const all = graph.rooms.flatMap((r) => r.polygon);
  if (all.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return bboxOfPoints(all);
}

export function roomBbox(room: Room): Bbox {
  return bboxOfPoints(room.polygon);
}

/** Internal clear dimensions (bbox extents) of a room, in whole millimetres. */
export function roomInternalDims(room: Room): { width_mm: number; depth_mm: number } {
  const b = roomBbox(room);
  return {
    width_mm: Math.round((b.maxX - b.minX) * 1000),
    depth_mm: Math.round((b.maxY - b.minY) * 1000),
  };
}

/**
 * Ordered, unique grid lines (room edge coordinates) along an axis, spanning
 * the whole envelope. `tol` collapses lines closer than 1 mm so floating-point
 * edges from adjacent rooms don't split a dimension.
 */
export function gridLines(graph: PlanGraph, axis: Axis, tolM = 0.001): number[] {
  const i = AXIS_INDEX[axis];
  const raw: number[] = [];
  for (const r of graph.rooms) {
    const b = roomBbox(r);
    raw.push(i === 0 ? b.minX : b.minY, i === 0 ? b.maxX : b.maxY);
  }
  raw.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of raw) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]!) > tolM) out.push(v);
  }
  return out;
}

/**
 * Dimension chain along an axis: the consecutive gaps between grid lines that
 * span the envelope. By construction Σ segment lengths === envelope extent, so
 * the chain always closes on the overall dimension (the P1 closure invariant).
 */
export function dimensionChain(graph: PlanGraph, axis: Axis): DimSegment[] {
  const lines = gridLines(graph, axis);
  const segs: DimSegment[] = [];
  for (let k = 0; k < lines.length - 1; k++) {
    const from = lines[k]!;
    const to = lines[k + 1]!;
    segs.push({ from, to, length_mm: Math.round((to - from) * 1000) });
  }
  return segs;
}

/** Overall envelope dimension along an axis, in whole millimetres. */
export function envelopeDimensionMm(graph: PlanGraph, axis: Axis): number {
  const b = graphBbox(graph);
  return axis === "x"
    ? Math.round((b.maxX - b.minX) * 1000)
    : Math.round((b.maxY - b.minY) * 1000);
}

/**
 * Closure check used by the sheet + the unit test. Compares in RAW metres, not
 * display-rounded millimetres: the grid-line gaps telescope, so their sum
 * equals the envelope extent exactly (per-segment mm rounding only affects the
 * printed labels, which can drift a millimetre or two — that is cosmetic).
 */
export function chainCloses(graph: PlanGraph, axis: Axis, tolM = 1e-6): boolean {
  const lines = gridLines(graph, axis);
  if (lines.length < 2) return false;
  const sum = lines[lines.length - 1]! - lines[0]!;
  const b = graphBbox(graph);
  const envelope = axis === "x" ? b.maxX - b.minX : b.maxY - b.minY;
  return Math.abs(sum - envelope) <= tolM;
}
