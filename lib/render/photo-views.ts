// =============================================================================
// lib/render/photo-views.ts — every photo of a room is a view (bathroom pilot B2).
//
// Pure and client-safe. A room's photos (room_photos) are listed oldest first as
// "Photo 1 · your photo", "Photo 2 · your photo", … — ALL of them, not just the
// latest (which is what the single-photo render path still reads). A photo can
// be placed on the room plan: where it was taken from and which way it looks
// (062: camera_position in the plan's normalised space, camera_heading_deg as a
// compass heading, 0 = plan up, clockwise — the room sheet's convention).
//
// The same file assigned to a room twice (the asset library re-assigns by
// inserting a row) is one view: rows are de-duplicated by storage path, the
// first row keeping its place and its camera.
// =============================================================================

export interface PhotoCamera {
  /** [x, y] in the plan's normalised space (rooms.polygon's space). */
  position: [number, number];
  /** Compass heading the camera looks along: 0 = plan up (−y), 90 = plan right, clockwise. */
  heading_deg: number;
}

export interface PhotoView {
  id: string;
  room_id: string;
  /** 1-based, oldest first. */
  n: number;
  label: string;
  url: string;
  storage_path: string | null;
  created_at: string | null;
  camera: PhotoCamera | null;
}

export interface RoomPhotoRow {
  id: string;
  room_id: string | null;
  public_url: string | null;
  storage_path: string | null;
  created_at: string | null;
  camera_position?: unknown;
  camera_heading_deg?: number | string | null;
}

export const photoLabel = (n: number) => `Photo ${n} · your photo`;

/** A stored camera, or null when the photo is not placed (or the values are unusable). */
export function cameraOf(row: Pick<RoomPhotoRow, "camera_position" | "camera_heading_deg">): PhotoCamera | null {
  const p = row.camera_position;
  const h = row.camera_heading_deg == null ? NaN : Number(row.camera_heading_deg);
  if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(h)) return null;
  const x = Number(p[0]), y = Number(p[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { position: [x, y], heading_deg: normHeading(h) };
}

/** A heading in [0, 360), to 0.1°. */
export function normHeading(deg: number): number {
  const r = Math.round((((deg % 360) + 360) % 360) * 10) / 10;
  return r === 360 ? 0 : r;
}

/** The compass heading from one plan point towards another (a drag on the plan). */
export function headingBetween(from: [number, number], to: [number, number]): number {
  return normHeading((Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180) / Math.PI);
}

/** Compass word for a heading: N, NNE, … (the room sheet writes "~155° (SSE)"). */
export function compassWord(deg: number): string {
  const W = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return W[Math.round(normHeading(deg) / 22.5) % 16]!;
}

/** A room's photo views, oldest first, one per stored file. */
export function photoViewsOf(rows: readonly RoomPhotoRow[], roomId: string): PhotoView[] {
  const mine = rows
    .filter((r) => r.room_id === roomId && !!r.public_url)
    .slice()
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const out: PhotoView[] = [];
  for (const r of mine) {
    const key = r.storage_path ?? r.public_url!;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = out.length + 1;
    out.push({ id: r.id, room_id: roomId, n, label: photoLabel(n), url: r.public_url!, storage_path: r.storage_path, created_at: r.created_at, camera: cameraOf(r) });
  }
  return out;
}

/** Is a normalised point inside (or on) the room's outline? A camera must stand in its room. */
export function insidePolygon(p: [number, number], poly: readonly [number, number][], tol = 1e-9): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    // On an edge counts as inside (a phone held against the wall).
    const cross = (xj - xi) * (p[1] - yi) - (yj - yi) * (p[0] - xi);
    if (Math.abs(cross) <= tol && Math.min(xi, xj) - tol <= p[0] && p[0] <= Math.max(xi, xj) + tol && Math.min(yi, yj) - tol <= p[1] && p[1] <= Math.max(yi, yj) + tol) return true;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
