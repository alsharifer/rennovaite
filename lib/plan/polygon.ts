// =============================================================================
// lib/plan/polygon.ts — pure polygon primitives shared by the parse pipeline,
// the geometry contract (walls), and the editor.
//
// No DOM, no I/O, no other-module imports → the base of the geometry stack
// (geometry.ts imports from here, not the other way round).
// =============================================================================

export type Pt = [number, number];

/** Shoelace area (absolute) of a simple polygon, in its own coordinate units.
 *  Polygon is open (first vertex not repeated); a trailing duplicate is fine. */
export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Axis-aligned bounding box of a set of points. */
export function bbox(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Snap a scalar to a grid step. */
export function snapToGrid(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.round(v / step) * step;
}

/** Ray-casting point-in-polygon (points on the boundary may return either).
 *  A true point-in-polygon test — fills the bbox-only gap in overlays/viewbox. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/**
 * If segments A(a0→a1) and B(b0→b1) are COLLINEAR and their overlap has positive
 * length, return the overlapping sub-segment; else null. Orientation-agnostic —
 * works for diagonal edges (used to detect shared party-wall portions between two
 * rooms' polygon edges at any angle).
 */
export function segmentsOverlapCollinear(
  a0: Pt, a1: Pt, b0: Pt, b1: Pt, eps = 1e-6,
): [Pt, Pt] | null {
  const dax = a1[0] - a0[0], day = a1[1] - a0[1];
  const len = Math.hypot(dax, day);
  if (len < eps) return null;

  // Both B endpoints must lie on A's infinite line (cross ≈ 0).
  const c0 = cross(dax, day, b0[0] - a0[0], b0[1] - a0[1]);
  const c1 = cross(dax, day, b1[0] - a0[0], b1[1] - a0[1]);
  if (Math.abs(c0) > eps * len || Math.abs(c1) > eps * len) return null;

  // Project everything onto A's direction (parameter t in units of |A|²).
  const dot = (px: number, py: number) => (px - a0[0]) * dax + (py - a0[1]) * day;
  const ta0 = 0;
  const ta1 = dax * dax + day * day; // = len²
  let tb0 = dot(b0[0], b0[1]);
  let tb1 = dot(b1[0], b1[1]);
  if (tb0 > tb1) [tb0, tb1] = [tb1, tb0];

  const lo = Math.max(Math.min(ta0, ta1), tb0);
  const hi = Math.min(Math.max(ta0, ta1), tb1);
  if (hi - lo <= eps * ta1) return null; // no positive-length overlap

  const at = (t: number): Pt => [a0[0] + (dax * t) / ta1, a0[1] + (day * t) / ta1];
  return [at(lo), at(hi)];
}

/** Distance from point p to segment a→b, plus the clamped parameter t∈[0,1]
 *  of the closest point along the segment. Used to snap an opening to its
 *  nearest wall. */
export function pointToSegment(p: Pt, a: Pt, b: Pt): { dist: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return { dist: Math.hypot(p[0] - cx, p[1] - cy), t };
}

/** True if a polygon edge is (near) axis-aligned. */
export function isAxisAligned(p: Pt, q: Pt, eps = 1e-4): boolean {
  return Math.abs(p[0] - q[0]) < eps || Math.abs(p[1] - q[1]) < eps;
}

/** True if every edge of the polygon is axis-aligned (a rectilinear room). */
export function isRectilinear(poly: Pt[], eps = 1e-4): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (!isAxisAligned(poly[i]!, poly[(i + 1) % poly.length]!, eps)) return false;
  }
  return true;
}
