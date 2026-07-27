// Room geometry helpers shared by the render pipeline.
//
// These recover a room's real-world width/depth in metres from its parsed-plan
// polygon (screen/plan coordinates) plus its area in m². The off-plan render
// path (app/api/render/route.ts) uses them to describe an empty room shell to a
// text-to-image model when no photo exists.
//
// Extracted from the former lib/control-image.ts (deleted with the flux-canny/
// depth control-image pipeline) so the geometry survives the model change.

export type Point2D = [number, number];

export type RoomLike = {
  polygon: unknown;
  area_m2: number | null;
};

export function parsePolygon(value: unknown): Point2D[] | null {
  if (!Array.isArray(value)) return null;
  const pts: Point2D[] = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push([x, y]);
  }
  return pts.length >= 3 ? pts : null;
}

// Photographer's convention: shoot the LONGER axis of the room so depth
// perspective reads. So depth = max(real width, real height); width = min.
export function realWorldDimensions(
  polygon: Point2D[],
  areaM2: number,
): { widthM: number; depthM: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bboxW = Math.max(maxX - minX, 1e-6);
  const bboxH = Math.max(maxY - minY, 1e-6);
  const aspect = bboxW / bboxH;
  const area = Math.max(areaM2, 1);
  const dimA = Math.sqrt(area * aspect);
  const dimB = Math.sqrt(area / aspect);
  return {
    depthM: Math.max(dimA, dimB),
    widthM: Math.min(dimA, dimB),
  };
}

// Best-effort real-world dimensions straight from a room row. Returns null when
// the polygon is missing/malformed so callers can fall back to a dimensionless
// prompt rather than throwing.
export function roomDimensions(
  room: RoomLike,
): { widthM: number; depthM: number } | null {
  const polygon = parsePolygon(room.polygon);
  if (!polygon) return null;
  return realWorldDimensions(polygon, room.area_m2 ?? 0);
}
