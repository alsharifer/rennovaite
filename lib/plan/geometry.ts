// =============================================================================
// lib/plan/geometry.ts — the Pilot-Seven geometry contract (Prompt P1).
//
// This is the single source of truth for plan geometry that the 2D drawing
// engine (lib/drawings), the future 3D viewer (lib/overlays), and permit checks
// (lib/compliance) all read. It is DETERMINISTIC and never involves an LLM.
//
// Reality of what we persist today (verified in PILOT_SEVEN_PREFLIGHT.md):
//   - rooms.polygon: axis-aligned 4-point rectangles in NORMALISED [0,1] plan
//     space (not metres, not pixels). rooms.area_m2 is the authoritative area.
//   - plans.parsed_json.scale = "1:100", units = metric. total_area_m2 given.
//   - NO wall segments, NO openings are persisted anywhere.
//
// So `buildPlanGraph`:
//   - Converts normalised polygons to a single consistent METRIC space using a
//     global unit→metre factor derived from total_area_m2 (isotropic; the parse
//     gives us no separate x/y scale).
//   - DERIVES walls as shared/boundary polygon edges (default 200 mm, structural
//     unknown → null). Every derived wall carries `derived: true`.
//   - Returns openings: [] and records that fact (we never invent doors).
//   - Records every derived scalar in `graph.derived` + human-readable `notes`
//     so the UI (and the P1 verification gate) can be honest about confidence.
// =============================================================================

export type Point = [number, number]; // metres. Origin = plan bbox top-left; +x right, +y DOWN (drawing convention).

export const DEFAULT_WALL_THICKNESS_MM = 200;
export const DEFAULT_CEILING_H_M = 2.9;
export const DEFAULT_LEVEL = "first_floor";
export const DEFAULT_NORTH_DEG = 0;

export interface Room {
  id: string;
  name_en: string;
  name_ar: string | null;
  type: string | null;
  /** Metric polygon, closed implicitly (first point not repeated). */
  polygon: Point[];
  /** Authoritative area from the DB — NOT recomputed from the scaled polygon. */
  area_m2: number;
  ceiling_h_m: number;
  /** Names of fields on this room whose value is derived, not sourced. */
  derived_fields: string[];
}

export interface Wall {
  id: string;
  /** Straight segment: exactly two metric points. */
  polyline: Point[];
  thickness_mm: number;
  /** null = unknown (we cannot tell structural from the parse). */
  is_structural: boolean | null;
  /** 1 id = exterior/boundary wall; 2 ids = party wall between two rooms. */
  room_ids: string[];
  /** Walls are entirely derived today — always true. */
  derived: true;
}

export interface Opening {
  id: string;
  wall_id: string;
  type: "door" | "window";
  width_mm: number;
  height_mm: number;
  sill_mm: number;
  derived: true;
}

export interface PlanGraphMeta {
  scale: string; // "1:100"
  north_deg: number; // 0 = plan-up is north
  level: string; // e.g. "first_floor"
  units: "metric";
  /** Overall bounding envelope in metres. */
  envelope_m: { width: number; depth: number };
  total_area_m2: number;
  /** Normalised-unit → metre linear factor used for the whole conversion. */
  unit_to_m: number;
  /** Raw normalised-space origin (min x/y) subtracted during metric conversion.
   *  A normalised point p maps to metres via ((p - norm_origin) * unit_to_m).
   *  Overlay fixtures are stored in this normalised space (like rooms.polygon);
   *  this lets the drawing sheets place them in metres. */
  norm_origin: [number, number];
}

export interface DerivedRecord {
  walls: boolean; // wall segments derived (not persisted)
  wall_thickness: boolean; // 200 mm default
  is_structural: boolean; // always unknown → null
  openings_empty: boolean; // true = we produced none because none are persisted
  ceiling_h: boolean; // 2.9 m default
  north: boolean; // 0 deg default
  level: boolean; // level string defaulted
  metric_scale: boolean; // metres derived from total_area_m2, not a real scale bar
}

export interface PlanGraph {
  projectId: string;
  planId: string | null;
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
  meta: PlanGraphMeta;
  derived: DerivedRecord;
  notes: string[];
}

// --- raw input (shape of a persisted room, DB or parsed_json) -----------------

export interface RawRoom {
  id: string;
  name_en: string | null;
  name_ar: string | null;
  room_type: string | null;
  area_m2: number | null;
  polygon: unknown; // expected number[][] in normalised space
}

export interface BuildPlanGraphInput {
  projectId: string;
  planId: string | null;
  scale: string | null; // parsed_json.scale, e.g. "1:100"
  total_area_m2: number | null;
  rooms: RawRoom[];
}

// --- helpers ------------------------------------------------------------------

function isNumberPair(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number"
  );
}

function toNormalisedPolygon(value: unknown): [number, number][] | null {
  if (!Array.isArray(value)) return null;
  const pts: [number, number][] = [];
  for (const p of value) {
    if (!isNumberPair(p)) return null;
    pts.push([p[0], p[1]]);
  }
  return pts.length >= 3 ? pts : null;
}

/** Shoelace area (absolute) of a simple polygon in its own coordinate units. */
export function polygonArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// --- wall derivation (orientation-agnostic) -----------------------------------
//
// Rooms may be non-rectilinear (L-shapes, diagonals). Each polygon edge is a
// candidate wall segment lying on some infinite line. We group edges by line
// identity (canonical unit normal angle + perpendicular offset, both quantised
// so collinear edges from different rooms fall in one bucket), cut each line
// into elementary intervals at every endpoint, label each interval by the
// covering room-set (1 → boundary wall; 2 → party wall), and merge adjacent
// intervals with an identical room-set. Emitted walls are 2-point segments and
// may be diagonal — axis-aligned inputs reproduce the previous walls exactly.

const ANG_EPS = 0.01; // ~0.57°: collinear room edges must land in the same bucket

interface Edge {
  key: string; // line identity (quantised angle:offset)
  nx: number; // canonical unit normal
  ny: number;
  c: number; // signed perpendicular offset (n · point)
  t0: number; // interval along the line direction u = (-ny, nx)
  t1: number;
  roomId: string;
}

function edgesOf(roomId: string, poly: [number, number][], eps: number): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < eps) continue; // skip degenerate edges
    // Canonical unit normal (sign fixed so opposite-wound shared edges match).
    let nx = -dy / len;
    let ny = dx / len;
    if (nx < -1e-9 || (Math.abs(nx) < 1e-9 && ny < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const c = nx * x1 + ny * y1;
    const ux = -ny; // line direction
    const uy = nx;
    const ta = x1 * ux + y1 * uy;
    const tb = x2 * ux + y2 * uy;
    const key = `${Math.round(Math.atan2(ny, nx) / ANG_EPS)}:${Math.round(c / eps)}`;
    edges.push({ key, nx, ny, c, t0: Math.min(ta, tb), t1: Math.max(ta, tb), roomId });
  }
  return edges;
}

interface RawWall {
  nx: number;
  ny: number;
  c: number;
  t0: number;
  t1: number;
  roomIds: string[];
}

function deriveRawWalls(edges: Edge[], eps: number): RawWall[] {
  const byLine = new Map<string, Edge[]>();
  for (const e of edges) {
    const g = byLine.get(e.key);
    if (g) g.push(e);
    else byLine.set(e.key, [e]);
  }

  const walls: RawWall[] = [];
  for (const group of byLine.values()) {
    const { nx, ny } = group[0]!;
    // Mean offset so per-edge float noise doesn't shift the reconstructed wall.
    const c = group.reduce((s, e) => s + e.c, 0) / group.length;
    const cuts = Array.from(new Set(group.flatMap((e) => [e.t0, e.t1]))).sort(
      (p, q) => p - q,
    );

    const segs: RawWall[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i]!;
      const b = cuts[i + 1]!;
      if (b - a < eps / 2) continue;
      const mid = (a + b) / 2;
      const rooms = Array.from(
        new Set(group.filter((e) => e.t0 <= mid && e.t1 >= mid).map((e) => e.roomId)),
      ).sort();
      if (rooms.length === 0) continue;
      const last = segs[segs.length - 1];
      if (
        last &&
        Math.abs(last.t1 - a) < eps / 2 &&
        last.roomIds.length === rooms.length &&
        last.roomIds.every((r, idx) => r === rooms[idx])
      ) {
        last.t1 = b; // merge co-linear neighbour with identical room-set
      } else {
        segs.push({ nx, ny, c, t0: a, t1: b, roomIds: rooms });
      }
    }
    walls.push(...segs);
  }
  return walls;
}

// --- main builder (pure, unit-testable, no DB) --------------------------------

export function buildPlanGraph(input: BuildPlanGraphInput): PlanGraph {
  const notes: string[] = [];

  const rawRooms = input.rooms
    .map((r) => ({ raw: r, poly: toNormalisedPolygon(r.polygon) }))
    .filter((r): r is { raw: RawRoom; poly: [number, number][] } => r.poly !== null);

  const dropped = input.rooms.length - rawRooms.length;
  if (dropped > 0) notes.push(`${dropped} room(s) dropped: polygon missing or invalid.`);

  // Global normalised bounding box + total normalised polygon area.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let normArea = 0;
  for (const { poly } of rawRooms) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    normArea += polygonArea(poly);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }

  const totalAreaM2 =
    input.total_area_m2 && input.total_area_m2 > 0
      ? input.total_area_m2
      : rawRooms.reduce((s, r) => s + (r.raw.area_m2 ?? 0), 0);

  // Single isotropic unit→metre factor: metres per normalised unit.
  const unitToM = normArea > 0 && totalAreaM2 > 0 ? Math.sqrt(totalAreaM2 / normArea) : 1;
  notes.push(
    `Metric geometry derived from total_area_m2 (${totalAreaM2} m²) via a single isotropic unit→metre factor (${unitToM.toFixed(4)} m/unit); the parse carries no real x/y scale.`,
  );

  const toM = (p: [number, number]): Point => [
    (p[0] - minX) * unitToM,
    (p[1] - minY) * unitToM,
  ];

  const rooms: Room[] = rawRooms.map(({ raw, poly }) => ({
    id: raw.id,
    name_en: raw.name_en?.trim() || "Room",
    name_ar: raw.name_ar ?? null,
    type: raw.room_type ?? null,
    polygon: poly.map(toM),
    area_m2: raw.area_m2 ?? Math.round(polygonArea(poly) * unitToM * unitToM * 10) / 10,
    ceiling_h_m: DEFAULT_CEILING_H_M,
    derived_fields: [
      "polygon", // metres are a global-scale derivation, not surveyed
      "ceiling_h_m",
      ...(raw.area_m2 == null ? ["area_m2"] : []),
    ],
  }));

  // Wall derivation runs in normalised space, then converts to metres.
  const eps = 0.0025; // parse coords are 2-decimal; this preserves distinct lines
  const allEdges = rawRooms.flatMap(({ raw, poly }) => edgesOf(raw.id, poly, eps));
  const rawWalls = deriveRawWalls(allEdges, eps);

  const walls: Wall[] = rawWalls.map((w, i) => {
    // Reconstruct endpoints from line identity: refPoint (foot of the
    // perpendicular, c·n) + t · direction u=(-ny,nx). Diagonal-capable.
    const rx = w.c * w.nx;
    const ry = w.c * w.ny;
    const ux = -w.ny;
    const uy = w.nx;
    const p0: [number, number] = [rx + w.t0 * ux, ry + w.t0 * uy];
    const p1: [number, number] = [rx + w.t1 * ux, ry + w.t1 * uy];
    return {
      id: `wall-${i + 1}`,
      polyline: [toM(p0), toM(p1)],
      thickness_mm: DEFAULT_WALL_THICKNESS_MM,
      is_structural: null,
      room_ids: w.roomIds,
      derived: true,
    };
  });

  const partyWalls = walls.filter((w) => w.room_ids.length >= 2).length;
  notes.push(
    `${walls.length} walls derived from shared/boundary polygon edges (${partyWalls} party, ${walls.length - partyWalls} boundary); thickness ${DEFAULT_WALL_THICKNESS_MM} mm and structural status are placeholders.`,
  );
  notes.push("openings: none persisted in the parse — returned empty (no doors/windows invented).");

  const envelope = {
    width: (maxX - minX) * unitToM,
    depth: (maxY - minY) * unitToM,
  };

  const scale = input.scale?.trim() || "1:100";
  if (!input.scale) notes.push('scale absent from parse — defaulted to "1:100".');

  return {
    projectId: input.projectId,
    planId: input.planId,
    rooms,
    walls,
    openings: [],
    meta: {
      scale,
      north_deg: DEFAULT_NORTH_DEG,
      level: DEFAULT_LEVEL,
      units: "metric",
      envelope_m: envelope,
      total_area_m2: totalAreaM2,
      unit_to_m: unitToM,
      norm_origin: [minX, minY],
    },
    derived: {
      walls: true,
      wall_thickness: true,
      is_structural: true,
      openings_empty: true,
      ceiling_h: true,
      north: true,
      level: true,
      metric_scale: true,
    },
    notes,
  };
}

/**
 * Human-readable list of every derived field/value in a graph — feeds the P1
 * verification gate ("tell me exactly which fields came back derived: true").
 */
export function derivedFieldSummary(graph: PlanGraph): string[] {
  const out: string[] = [];
  const d = graph.derived;
  if (d.walls) out.push("walls[] — all wall segments (not persisted; derived from shared polygon edges)");
  if (d.wall_thickness) out.push(`walls[].thickness_mm — default ${DEFAULT_WALL_THICKNESS_MM} mm`);
  if (d.is_structural) out.push("walls[].is_structural — always null (unknown from parse)");
  if (d.openings_empty) out.push("openings[] — empty (no doors/windows persisted)");
  if (d.ceiling_h) out.push(`rooms[].ceiling_h_m — default ${DEFAULT_CEILING_H_M} m`);
  if (d.metric_scale) out.push("rooms[].polygon (metres) — derived from total_area_m2, no surveyed scale");
  if (d.north) out.push(`meta.north_deg — default ${DEFAULT_NORTH_DEG}°`);
  if (d.level) out.push(`meta.level — default "${DEFAULT_LEVEL}"`);
  return out;
}
