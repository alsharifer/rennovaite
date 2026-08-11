// =============================================================================
// lib/overlays/viewbox.ts — shared raw↔viewBox fit for the 2D overlay editor.
//
// Mirrors EditablePlanViewer's fit (aspect-preserving into a 1000×600 viewBox)
// so switching Plan ↔ Electrical ↔ Plumbing never jumps. Pure — no React.
// =============================================================================

export const VIEW_W = 1000;
export const VIEW_H = 600;
export const PADDING = 24;

export type Pt = [number, number];

export interface FitRoom {
  id: string;
  name_en: string;
  name_ar: string | null;
  room_type: string | null;
  area_m2: number;
  /** viewBox-space polygon points for read-only display. */
  pts: Pt[];
  /** raw bounding box, for point-in-room assignment on add. */
  raw: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface Fit {
  rooms: FitRoom[];
  toViewBox: (p: Pt) => Pt;
  toRaw: (v: Pt) => Pt;
}

export interface RawRoomInput {
  id: string;
  name_en: string | null;
  name_ar: string | null;
  room_type: string | null;
  area_m2: number | null;
  polygon: unknown;
  /** Parser confidence 0..1 (nullable); forwarded to the editor's flag. */
  confidence?: number | null;
}

function asPolygon(v: unknown): Pt[] | null {
  if (!Array.isArray(v)) return null;
  const pts: Pt[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") return null;
    pts.push([p[0], p[1]]);
  }
  return pts.length >= 3 ? pts : null;
}

export function fitRooms(rooms: RawRoomInput[]): Fit {
  const parsed = rooms
    .map((r) => ({ r, poly: asPolygon(r.polygon) }))
    .filter((x): x is { r: RawRoomInput; poly: Pt[] } => x.poly !== null);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const { poly } of parsed) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const availW = VIEW_W - 2 * PADDING;
  const availH = VIEW_H - 2 * PADDING;
  const scale = Math.min(availW / spanX, availH / spanY);
  const offsetX = (VIEW_W - spanX * scale) / 2;
  const offsetY = (VIEW_H - spanY * scale) / 2;

  const toViewBox = (p: Pt): Pt => [
    (p[0] - minX) * scale + offsetX,
    (p[1] - minY) * scale + offsetY,
  ];
  const toRaw = (v: Pt): Pt => [
    (v[0] - offsetX) / scale + minX,
    (v[1] - offsetY) / scale + minY,
  ];

  const fitRoomsOut: FitRoom[] = parsed.map(({ r, poly }) => {
    let rminX = Infinity,
      rminY = Infinity,
      rmaxX = -Infinity,
      rmaxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < rminX) rminX = x;
      if (y < rminY) rminY = y;
      if (x > rmaxX) rmaxX = x;
      if (y > rmaxY) rmaxY = y;
    }
    return {
      id: r.id,
      name_en: r.name_en?.trim() || "Room",
      name_ar: r.name_ar ?? null,
      room_type: r.room_type ?? null,
      area_m2: typeof r.area_m2 === "number" ? r.area_m2 : 0,
      pts: poly.map(toViewBox),
      raw: { minX: rminX, minY: rminY, maxX: rmaxX, maxY: rmaxY },
    };
  });

  return { rooms: fitRoomsOut, toViewBox, toRaw };
}

/** First room whose raw bbox contains the raw point (add → room_id). */
export function roomAt(fit: Fit, raw: Pt): string | null {
  for (const r of fit.rooms) {
    if (raw[0] >= r.raw.minX && raw[0] <= r.raw.maxX && raw[1] >= r.raw.minY && raw[1] <= r.raw.maxY) {
      return r.id;
    }
  }
  return null;
}
