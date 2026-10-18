// =============================================================================
// lib/overlays/footprint.ts — a sanitary fixture's footprint, and its wall (B1).
//
// Until B1 a plumbing fixture was a bare point: the BoQ counts points, and
// "the BoQ uses counts, not positions" (seed.ts). A render or a massing view of
// a bathroom needs more — how big the WC is, which wall it backs onto and which
// way it faces. That lives in the fixture's existing `spec` (no migration):
//
//   spec.width_mm      along the wall it backs onto
//   spec.depth_mm      out from that wall into the room
//   spec.rotation_deg  the compass heading it FACES — 0 = plan up (−y), 90 =
//                      plan right (+x), clockwise; the room sheet's convention
//   spec.wall_gap_mm   back of the fixture to the wall face (0 = flush)
//   spec.footprint     "default" (the per-type size below, derived) |
//                      "entered" (typed — measured)
//
// and `plan_fixtures.wall_id`, which B0 found was never filled in. Like an
// opening's `wall_ref` it is a HINT: derived wall ids renumber with every
// outline edit (#112), so the authority is the position + rotation, and a
// consumer re-finds the wall by position.
//
// Pure: the editor previews the snap with the same function the route stores.
// Nothing here prices — the BoQ still counts points.
// =============================================================================

import { pointToSegment } from "@/lib/plan/polygon";

import type { FixtureType } from "./types";

/** The fixtures that stand on the floor against a wall and have a size. */
export const FOOTPRINT_TYPES = ["wc_point", "bidet_point", "basin_point", "shower_mixer", "bath_point"] as const;
export type FootprintType = (typeof FOOTPRINT_TYPES)[number];

export const isFootprintType = (t: FixtureType | string): t is FootprintType => (FOOTPRINT_TYPES as readonly string[]).includes(t);

/**
 * Default size per type (mm): width along the wall × depth into the room. A
 * starting point, marked "default" until someone types the real one. The basin
 * is a vanity (0.9 m run); the shower is a 0.9 m square tray.
 */
export const DEFAULT_FOOTPRINT_MM: Record<FootprintType, { width_mm: number; depth_mm: number }> = {
  wc_point: { width_mm: 400, depth_mm: 700 },
  bidet_point: { width_mm: 400, depth_mm: 550 },
  basin_point: { width_mm: 900, depth_mm: 600 },
  shower_mixer: { width_mm: 900, depth_mm: 900 },
  bath_point: { width_mm: 1700, depth_mm: 750 },
};

export interface Footprint {
  width_mm: number;
  depth_mm: number;
  rotation_deg: number;
  wall_gap_mm: number;
  footprint: "default" | "entered";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** The footprint a fixture's spec states, completed from the type's default. null for a point-only type. */
export function footprintOf(type: FixtureType | string, spec: Record<string, unknown> | null | undefined): Footprint | null {
  if (!isFootprintType(type)) return null;
  const def = DEFAULT_FOOTPRINT_MM[type];
  const w = num(spec?.width_mm), d = num(spec?.depth_mm);
  const entered = spec?.footprint === "entered" || (spec?.footprint !== "default" && w != null && d != null);
  return {
    width_mm: w != null && w > 0 ? w : def.width_mm,
    depth_mm: d != null && d > 0 ? d : def.depth_mm,
    rotation_deg: num(spec?.rotation_deg) ?? 0,
    wall_gap_mm: Math.max(0, num(spec?.wall_gap_mm) ?? 0),
    footprint: entered ? "entered" : "default",
  };
}

export interface SnapWall {
  id: string;
  a: [number, number];
  b: [number, number];
  roomIds: string[];
}

export interface Snapped {
  /** The footprint's centre, in the plan's own (normalised) space. */
  position: [number, number];
  wall_id: string;
  /** The spec to store: the fixture's own fields + the completed footprint. */
  spec: Record<string, unknown>;
}

/** Compass heading (0 = −y, clockwise) of a plan-space direction. */
export function headingOf(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const r = Math.round(((deg % 360) + 360) % 360 * 10) / 10;
  return r === 360 ? 0 : r;
}

/**
 * Put a footprint fixture against the nearest wall of its room: its back on the
 * wall face (plus `wall_gap_mm`), facing into the room, its centre where it was
 * along the wall — kept far enough from the wall's ends that the footprint
 * stays on it. `mPerU` = metres per plan unit. null when the room has no wall
 * (the fixture keeps the point it was given).
 */
export function snapToWall(
  f: { type: FixtureType | string; position: [number, number]; room_id: string | null; spec?: Record<string, unknown> | null },
  walls: readonly SnapWall[],
  mPerU: number,
): Snapped | null {
  const fp = footprintOf(f.type, f.spec ?? null);
  if (!fp || !(mPerU > 0)) return null;
  const own = f.room_id ? walls.filter((w) => w.roomIds.includes(f.room_id!)) : [];
  const pool = own.length > 0 ? own : walls;
  let best: { w: SnapWall; dist: number; t: number } | null = null;
  for (const w of pool) {
    const { dist, t } = pointToSegment(f.position, w.a, w.b);
    if (!best || dist < best.dist - 1e-12) best = { w, dist, t };
  }
  if (!best) return null;
  const { w } = best;
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dy);
  if (len <= 0) return null;
  const ux = dx / len, uy = dy / len;
  // Into the room: the side of the wall the fixture was dropped on.
  const side = ux * (f.position[1] - w.a[1]) - uy * (f.position[0] - w.a[0]);
  let nx = -uy, ny = ux;
  if (side < 0) { nx = uy; ny = -ux; }
  const lenM = len * mPerU;
  const halfW = fp.width_mm / 2000;
  // Along the wall, in metres from `a`, clamped so the footprint stays on it.
  const alongM = Math.min(Math.max(best.t * lenM, Math.min(halfW, lenM / 2)), Math.max(lenM - halfW, lenM / 2));
  const outM = fp.depth_mm / 2000 + fp.wall_gap_mm / 1000;
  const position: [number, number] = [
    w.a[0] + (ux * alongM + nx * outM) / mPerU,
    w.a[1] + (uy * alongM + ny * outM) / mPerU,
  ];
  return {
    position,
    wall_id: w.id,
    spec: { ...(f.spec ?? {}), width_mm: fp.width_mm, depth_mm: fp.depth_mm, rotation_deg: headingOf(nx, ny), wall_gap_mm: fp.wall_gap_mm, footprint: fp.footprint },
  };
}

/**
 * The footprint's four corners in plan space (for drawing): centre ± half the
 * width along the wall and ± half the depth across it, turned to its heading.
 */
export function footprintCorners(position: [number, number], fp: Pick<Footprint, "width_mm" | "depth_mm" | "rotation_deg">, mPerU: number): [number, number][] {
  const th = (fp.rotation_deg * Math.PI) / 180;
  // Facing direction f (into the room) and the wall direction u (perpendicular).
  const fx = Math.sin(th), fy = -Math.cos(th);
  const ux = -fy, uy = fx;
  const hw = fp.width_mm / 2000 / mPerU, hd = fp.depth_mm / 2000 / mPerU;
  const c = position;
  return [
    [c[0] - ux * hw - fx * hd, c[1] - uy * hw - fy * hd],
    [c[0] + ux * hw - fx * hd, c[1] + uy * hw - fy * hd],
    [c[0] + ux * hw + fx * hd, c[1] + uy * hw + fy * hd],
    [c[0] - ux * hw + fx * hd, c[1] - uy * hw + fy * hd],
  ];
}
