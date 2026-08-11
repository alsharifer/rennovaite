// =============================================================================
// lib/viewer/scene.ts — pure plan-graph → 3D scene model (Prompt P3).
//
// buildScene(planGraph, finishes?) turns the P1 PlanGraph into plain geometry
// data (wall boxes, floor polygons, labels, bounds) that components/viewer
// renders with react-three-fiber. It imports NO three.js and touches no DOM, so
// it is SSR-safe and unit-testable (wall count, true metric dimensions).
//
// This is a VIEW model only — it describes geometry to *display*. Nothing here
// (or downstream) mutates the plan; edits live in the 2D plan (P1/P2).
//
// Coordinate mapping: plan metres (x → right, y → DOWN) map to world
// (X = x − cx, Z = y − cz, Y = up), centred on the envelope so the orbit target
// sits at the origin.
// =============================================================================

import type { Opening, PlanGraph, Point } from "@/lib/plan/geometry";

export const WALL_WHITE = "#F4EFE6"; // matte clay-white (canvas-adjacent)
export const FLOOR_BONE = "#EDE6D8";
export const DEFAULT_CEILING_H_M = 2.9;
const DOOR_H_M = 2.1;

export interface WallBox {
  id: string;
  /** World-space centre [x, y, z] (metres). */
  center: [number, number, number];
  /** Box size [length, height, thickness] (metres). */
  size: [number, number, number];
  /** Rotation about the world Y axis (radians). */
  rotationY: number;
  /** Wall geometry is derived (not surveyed) — render at reduced opacity. */
  derived: boolean;
}

export interface FloorSlab {
  roomId: string;
  /** World XZ polygon (metres) at y = 0. */
  points: [number, number][];
  color: string;
}

export interface RoomLabel {
  roomId: string;
  name: string;
  area_m2: number;
  /** World XZ centroid (metres). */
  center: [number, number];
}

export interface WallSegment {
  /** World XZ endpoints (metres) of the wall centre-line. */
  a: [number, number];
  b: [number, number];
  thickness: number;
}

export interface SceneModel {
  walls: WallBox[];
  /** Pre-split wall centre-lines for walk-mode collision. */
  wallSegments: WallSegment[];
  floors: FloorSlab[];
  labels: RoomLabel[];
  bounds: {
    center: [number, number];
    /** [width, depth] in metres. */
    size: [number, number];
    height: number;
  };
  /** Number of source walls in the graph (verification cross-check). */
  wallCount: number;
  /** true when the graph has no walls → the viewer shows its empty state. */
  isEmpty: boolean;
}

export interface BuildSceneOptions {
  /** Per-room floor colour (hex) from the locked StyleBoard, if any. */
  floorColorByRoom?: Record<string, string>;
}

function centroid(poly: Point[]): [number, number] {
  let x = 0,
    y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  return [x / poly.length, y / poly.length];
}

export function buildScene(
  graph: PlanGraph,
  opts: BuildSceneOptions = {},
): SceneModel {
  const { width, depth } = graph.meta.envelope_m;
  const cx = width / 2;
  const cz = depth / 2;
  const toWorldXZ = (p: Point): [number, number] => [p[0] - cx, p[1] - cz];

  const ceilingByRoom = new Map<string, number>();
  for (const r of graph.rooms) ceilingByRoom.set(r.id, r.ceiling_h_m || DEFAULT_CEILING_H_M);
  const globalCeiling =
    graph.rooms.reduce((m, r) => Math.max(m, r.ceiling_h_m || 0), 0) || DEFAULT_CEILING_H_M;

  const openingsByWall = new Map<string, Opening[]>();
  for (const o of graph.openings) {
    if (!o.wall_id) continue; // unsnapped opening — no wall to cut
    (openingsByWall.get(o.wall_id) ?? openingsByWall.set(o.wall_id, []).get(o.wall_id)!).push(o);
  }

  const walls: WallBox[] = [];
  const wallSegments: WallSegment[] = [];
  for (const w of graph.walls) {
    const [a, b] = w.polyline;
    if (!a || !b) continue;
    const height =
      w.room_ids.reduce((m, id) => Math.max(m, ceilingByRoom.get(id) ?? 0), 0) || globalCeiling;
    const thickness = (w.thickness_mm || 200) / 1000;
    const wa = toWorldXZ(a);
    const wb = toWorldXZ(b);
    wallSegments.push({ a: wa, b: wb, thickness });
    pushWallBoxes(walls, w.id, wa, wb, thickness, height, w.derived === true, openingsByWall.get(w.id) ?? []);
  }

  const floors: FloorSlab[] = graph.rooms.map((r) => ({
    roomId: r.id,
    points: r.polygon.map(toWorldXZ),
    color: opts.floorColorByRoom?.[r.id] ?? FLOOR_BONE,
  }));

  const labels: RoomLabel[] = graph.rooms.map((r) => {
    const [x, z] = toWorldXZ(centroid(r.polygon));
    return { roomId: r.id, name: r.name_en, area_m2: r.area_m2, center: [x, z] };
  });

  return {
    walls,
    wallSegments,
    floors,
    labels,
    bounds: { center: [0, 0], size: [width, depth], height: globalCeiling },
    wallCount: graph.walls.length,
    isEmpty: graph.walls.length === 0,
  };
}

/**
 * Emit the wall box(es) for a segment, cutting any door/window openings the
 * graph attaches to it. Openings carry no along-wall position in the P1
 * contract, so a single opening is centred on the wall (Mudon has none, so this
 * branch is inert today). TODO(P-later): honour a real along-wall offset.
 */
function pushWallBoxes(
  out: WallBox[],
  id: string,
  a: [number, number],
  b: [number, number],
  thickness: number,
  height: number,
  derived: boolean,
  openings: Opening[],
): void {
  const [ax, az] = a;
  const [bx, bz] = b;
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz);
  if (length < 1e-4) return;
  const rotationY = -Math.atan2(dz, dx);
  const midX = (ax + bx) / 2;
  const midZ = (az + bz) / 2;

  if (openings.length === 0) {
    out.push({ id, center: [midX, height / 2, midZ], size: [length, height, thickness], rotationY, derived });
    return;
  }

  const op = openings[0]!;
  const w = Math.min((op.width_mm || 900) / 1000, length * 0.9);
  const jamb = (length - w) / 2;
  const openH = op.type === "door" ? DOOR_H_M : (op.height_mm || 1200) / 1000;
  const sill = op.type === "door" ? 0 : (op.sill_mm || 900) / 1000;
  const ux = dx / length;
  const uz = dz / length;
  const seg = (offset: number, segLen: number, y: number, h: number, tag: string) => {
    if (segLen <= 1e-3 || h <= 1e-3) return;
    const t = offset + segLen / 2 - length / 2;
    out.push({
      id: `${id}:${tag}`,
      center: [midX + ux * t, y + h / 2, midZ + uz * t],
      size: [segLen, h, thickness],
      rotationY,
      derived,
    });
  };
  seg(0, jamb, 0, height, "j0");
  seg(length - jamb, jamb, 0, height, "j1");
  seg(jamb, w, sill + openH, height - (sill + openH), "hdr");
  if (sill > 0) seg(jamb, w, 0, sill, "sill");
}
