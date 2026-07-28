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

/** Snap a coordinate to a grid so co-linear edges from different rooms match. */
function snap(v: number, eps: number): number {
  return Math.round(v / eps) * eps;
}

// --- wall derivation ----------------------------------------------------------
//
// Axis-aligned edges only (all we have). For each orientation we group edges by
// their (snapped) line coordinate, partition the line into elementary intervals
// at every edge endpoint, and label each interval by the set of rooms whose edge
// covers it. 1 room → boundary wall; 2 rooms → party wall. Adjacent intervals
// with an identical room-set are merged into one wall segment.

interface Edge {
  orient: "v" | "h";
  line: number; // x for vertical, y for horizontal (snapped, normalised)
  a: number; // interval start along the other axis (snapped)
  b: number; // interval end
  roomId: string;
}

function edgesOf(roomId: string, poly: [number, number][], eps: number): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    const sx1 = snap(x1, eps),
      sy1 = snap(y1, eps),
      sx2 = snap(x2, eps),
      sy2 = snap(y2, eps);
    if (Math.abs(sx1 - sx2) < eps / 2 && Math.abs(sy1 - sy2) >= eps / 2) {
      edges.push({ orient: "v", line: sx1, a: Math.min(sy1, sy2), b: Math.max(sy1, sy2), roomId });
    } else if (Math.abs(sy1 - sy2) < eps / 2 && Math.abs(sx1 - sx2) >= eps / 2) {
      edges.push({ orient: "h", line: sy1, a: Math.min(sx1, sx2), b: Math.max(sx1, sx2), roomId });
    }
    // Non-axis-aligned edges are ignored (the parse only produces rectangles).
  }
  return edges;
}

interface RawWall {
  orient: "v" | "h";
  line: number;
  a: number;
  b: number;
  roomIds: string[];
}

function deriveRawWalls(edges: Edge[], eps: number): RawWall[] {
  const byLine = new Map<string, Edge[]>();
  for (const e of edges) {
    const key = `${e.orient}:${e.line.toFixed(4)}`;
    (byLine.get(key) ?? byLine.set(key, []).get(key)!).push(e);
  }

  const walls: RawWall[] = [];
  for (const group of byLine.values()) {
    const orient = group[0]!.orient;
    const line = group[0]!.line;
    const cuts = Array.from(
      new Set(group.flatMap((e) => [e.a, e.b])),
    ).sort((p, q) => p - q);

    const segs: RawWall[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const t0 = cuts[i]!;
      const t1 = cuts[i + 1]!;
      if (t1 - t0 < eps / 2) continue;
      const mid = (t0 + t1) / 2;
      const rooms = Array.from(
        new Set(group.filter((e) => e.a <= mid && e.b >= mid).map((e) => e.roomId)),
      ).sort();
      if (rooms.length === 0) continue;
      const last = segs[segs.length - 1];
      if (
        last &&
        Math.abs(last.b - t0) < eps / 2 &&
        last.roomIds.length === rooms.length &&
        last.roomIds.every((r, idx) => r === rooms[idx])
      ) {
        last.b = t1; // merge co-linear neighbour with identical room-set
      } else {
        segs.push({ orient, line, a: t0, b: t1, roomIds: rooms });
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
    const p0: [number, number] =
      w.orient === "v" ? [w.line, w.a] : [w.a, w.line];
    const p1: [number, number] =
      w.orient === "v" ? [w.line, w.b] : [w.b, w.line];
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
