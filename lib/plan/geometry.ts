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

import {
  buildLinearElements,
  polylineLength,
  type LinearElement,
  type RawLinearElement,
} from "./elements";
import { pointToSegment } from "./polygon";
import { defaultUnroofed } from "./zones";

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
  /**
   * G1 enclosure model: this zone is open to the sky. An unroofed zone has no
   * ceiling, and its polygon edges emit NO wall — a garden is bounded by what
   * somebody drew, not by where two lawns happen to meet. Defaults false, so
   * every interior room behaves exactly as it did before the garden pilot.
   */
  unroofed: boolean;
  /**
   * G4: how much of `area_m2` was APPROXIMATED rather than read off the drawing
   * (e.g. a curved edge traced as a quadrant), and why. null when nothing was.
   * A drawing that prints the area has to be able to say this, so it lives on
   * the zone rather than in a report that can be lost.
   */
  area_derived_m2: number | null;
  derived_note: string | null;
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
  /** 1 id = exterior/boundary wall; 2 ids = party wall between two rooms.
   *  Empty for a wall drawn as a `boundary_wall` linear element. */
  room_ids: string[];
  /**
   * false ONLY for a wall the user drew as a boundary_wall element — that one
   * is a measured line, not an inference from polygon edges. Every wall the
   * builder infers stays true.
   */
  derived: boolean;
  /** Where this wall came from. */
  source: "derived" | "drawn";
}

// A3/A5: openings are first-class children of walls. Assigned to the nearest
// derived wall at graph-build time (derived wall ids are volatile), so
// downstream (net-wall quantities, schedule, 3D door-cuts) key off wall_id.
export interface Opening {
  id: string;
  /** Assigned to the nearest derived wall at build time (null if none). */
  wall_id: string | null;
  room_id: string | null;
  type: "door" | "window" | "archway";
  width_mm: number;
  height_mm: number;
  sill_mm: number;
  /** Metric midpoint (origin = plan bbox top-left). */
  position: Point | null;
  /** 0..1 along the assigned wall (null if not computed). */
  along_offset: number | null;
  source: "parsed" | "user_drawn";
  /** true = dimensions were DEFAULTED (standard door/window), not measured. A
   *  defaulted opening must never silently read as a measured quantity. */
  derived: boolean;
}

/** Standard fallback dimensions (mm) when the source can't measure. */
export const DEFAULT_OPENING_DIMS: Record<
  Opening["type"],
  { width_mm: number; height_mm: number; sill_mm: number }
> = {
  door: { width_mm: 900, height_mm: 2100, sill_mm: 0 },
  window: { width_mm: 1200, height_mm: 1200, sill_mm: 900 },
  archway: { width_mm: 1200, height_mm: 2400, sill_mm: 0 },
};

/** Raw persisted/provider opening (normalised space, like rooms.polygon). */
export interface RawOpening {
  id: string;
  wall_ref?: string | null;
  room_id?: string | null;
  type?: string | null;
  width_mm?: number | null;
  height_mm?: number | null;
  sill_mm?: number | null;
  position?: unknown; // normalised [x, y]
  along_offset?: number | null;
  source?: string | null;
  derived?: boolean | null;
}

/** Where a plan's geometry came from. `user_drawn` = authored on a blank
 *  canvas with a plot dimension the user typed, never parsed from a drawing. */
export type PlanSource = "parsed" | "user_drawn";

export interface PlanGraphMeta {
  scale: string; // "1:100"
  /** G1: provenance of the whole plan. Snapshots carry this, so an authored
   *  plan is marked as authored wherever its graph is stored or read. */
  source: PlanSource;
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
  /**
   * G4: the measured plot (authored plans only), placed in the same metric frame
   * as the rooms: its top-left corner is `origin_m` (normally slightly negative,
   * because metres are measured from the rooms' bounding box, not the plot).
   */
  plot?: { width_m: number; depth_m: number; origin_m: Point } | null;
}

export interface DerivedRecord {
  walls: boolean; // wall segments derived (not persisted)
  /** G1: true when no linear elements are persisted (nothing invented). */
  elements_empty: boolean;
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
  /** G1: boundary walls, bench/planter/counter runs — priced per linear metre. */
  elements: LinearElement[];
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
  /** G1: null/absent falls back to the type's default (outdoor ⇒ unroofed). */
  unroofed?: boolean | null;
  /** G4: approximated share of the area and its reason (migration 035). */
  area_derived_m2?: number | null;
  derived_note?: string | null;
}

export interface BuildPlanGraphInput {
  projectId: string;
  planId: string | null;
  scale: string | null; // parsed_json.scale, e.g. "1:100"
  total_area_m2: number | null;
  rooms: RawRoom[];
  /** A3/A5: persisted openings (doors/windows), if any. Absent → openings[] empty. */
  openings?: RawOpening[];
  /** G1: persisted linear elements (boundary walls, bench/planter/counter runs). */
  elements?: RawLinearElement[];
  /**
   * G1: metres per normalised unit, when the plan's scale was MEASURED rather
   * than inferred. An authored plan has one (the plot width the user typed);
   * a parsed plan does not, and the builder falls back to deriving it from
   * total_area_m2. Supplying it also clears `derived.metric_scale`, because a
   * typed dimension is a measurement and must not read as a guess.
   */
  unit_to_m?: number | null;
  /** G4: the measured plot of an authored plan, so drawings can show the site. */
  plot?: { width_m: number; depth_m: number } | null;
  /** G1: how this plan's geometry came to exist. Defaults to "parsed". */
  source?: PlanSource | null;
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

/**
 * G1 open-edge rule: a segment whose every covering room is unroofed emits no
 * wall. A lawn meeting a paved area is a change of surface, not a wall, and a
 * garden's outer edge is a property line unless somebody draws a wall on it.
 * A segment shared by an unroofed zone and a roofed room still emits one — the
 * house wall the terrace abuts is real.
 */
function deriveRawWalls(
  edges: Edge[],
  eps: number,
  unroofedIds: ReadonlySet<string> = new Set(),
): RawWall[] {
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
      if (rooms.every((id) => unroofedIds.has(id))) continue; // open edge
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

// --- shared raw-space wall derivation (A5 editor + builder) -------------------
//
// The openings editor has to let the user pick the SAME wall the take-off will
// price, so wall derivation must have exactly one implementation. This runs in
// the raw/normalised space of `rooms.polygon` (no metric conversion) and hands
// back ids identical to the ones `buildPlanGraph` emits (`wall-1`, `wall-2`, …)
// because both walk `deriveRawWalls` in the same order.
//
// Wall ids stay VOLATILE by contract — an edit that changes room geometry
// renumbers them — so an opening's `wall_ref` is only ever a hint. The graph
// re-snaps every opening to its nearest wall at build time. This export exists
// so the hint is a good one and the editor's hit-testing matches the engine.

export const WALL_DERIVE_EPS = 0.0025; // parse coords are 2-decimal

/** Rooms open to the sky — an explicit `unroofed` wins, otherwise the type's
 *  default. Shared by the builder and the editor so both suppress the same
 *  edges and wall ids stay in step. */
export function unroofedIdSet(
  rooms: readonly { id: string; unroofed?: boolean | null; room_type?: string | null; type?: string | null }[],
): Set<string> {
  const out = new Set<string>();
  for (const r of rooms) {
    const explicit = r.unroofed;
    const open =
      explicit == null ? defaultUnroofed(r.room_type ?? r.type ?? null) : explicit === true;
    if (open) out.add(r.id);
  }
  return out;
}

export interface RawWallSegment {
  /** Matches the `Wall.id` buildPlanGraph assigns to the same segment. */
  id: string;
  /** Endpoints in the SAME space as the input polygons (not metres). */
  a: [number, number];
  b: [number, number];
  /** 1 id = boundary wall; 2 = party wall between two rooms. */
  roomIds: string[];
}

/** Reconstruct a raw wall's endpoints from its line identity + interval. */
function rawWallEndpoints(w: RawWall): { a: [number, number]; b: [number, number] } {
  const rx = w.c * w.nx;
  const ry = w.c * w.ny;
  const ux = -w.ny;
  const uy = w.nx;
  return {
    a: [rx + w.t0 * ux, ry + w.t0 * uy],
    b: [rx + w.t1 * ux, ry + w.t1 * uy],
  };
}

/**
 * Derive wall segments from room polygons in raw (un-converted) space. Pure.
 * Used by the A5 openings editor client-side; `buildPlanGraph` uses the same
 * `deriveRawWalls` core, so ids and ordering agree.
 */
export function deriveWallSegments(
  rooms: { id: string; polygon: unknown; unroofed?: boolean | null; room_type?: string | null }[],
  eps: number = WALL_DERIVE_EPS,
): RawWallSegment[] {
  const parsed = rooms
    .map((r) => ({ id: r.id, poly: toNormalisedPolygon(r.polygon) }))
    .filter((r): r is { id: string; poly: [number, number][] } => r.poly !== null);
  const unroofedIds = unroofedIdSet(rooms);
  const edges = parsed.flatMap(({ id, poly }) => edgesOf(id, poly, eps));
  return deriveRawWalls(edges, eps, unroofedIds).map((w, i) => {
    const { a, b } = rawWallEndpoints(w);
    return { id: `wall-${i + 1}`, a, b, roomIds: w.roomIds };
  });
}

/**
 * Project a point onto a segment, returning the clamped foot, the 0..1
 * parameter along it, and the perpendicular distance. Shared by the editor
 * (drag-along-wall) and the nearest-wall snap.
 */
export function projectOntoSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { point: [number, number]; t: number; dist: number } {
  const { dist, t } = pointToSegment(p, a, b);
  return {
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    t,
    dist,
  };
}

/** Nearest wall segment to a raw point (null when there are no walls). */
export function nearestWall(
  walls: RawWallSegment[],
  p: [number, number],
): { wall: RawWallSegment; t: number; dist: number } | null {
  let best: { wall: RawWallSegment; t: number; dist: number } | null = null;
  for (const w of walls) {
    const { t, dist } = projectOntoSegment(p, w.a, w.b);
    if (!best || dist < best.dist) best = { wall: w, t, dist };
  }
  return best;
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
  //
  // An AUTHORED plan supplies this directly (the plot width the user typed), and
  // that path matters for more than provenance: deriving the factor from
  // total_area_m2 assumes the rooms TILE the plan, which interior floors do and
  // a garden does not. Zones have gaps between them, so the derived factor would
  // inflate every zone to fill the plot. A measured scale is the only correct
  // one here, and it is also the honest one.
  const measuredScale = typeof input.unit_to_m === "number" && input.unit_to_m > 0;
  const unitToM = measuredScale
    ? input.unit_to_m!
    : normArea > 0 && totalAreaM2 > 0
      ? Math.sqrt(totalAreaM2 / normArea)
      : 1;
  notes.push(
    measuredScale
      ? `Metric geometry from a MEASURED scale (${unitToM.toFixed(4)} m per normalised unit) entered when the plan was drawn — not inferred from area.`
      : `Metric geometry derived from total_area_m2 (${totalAreaM2} m²) via a single isotropic unit→metre factor (${unitToM.toFixed(4)} m/unit); the parse carries no real x/y scale.`,
  );

  const toM = (p: [number, number]): Point => [
    (p[0] - minX) * unitToM,
    (p[1] - minY) * unitToM,
  ];

  const rooms: Room[] = rawRooms.map(({ raw, poly }) => {
    const unroofed =
      raw.unroofed == null ? defaultUnroofed(raw.room_type) : raw.unroofed === true;
    return {
      id: raw.id,
      name_en: raw.name_en?.trim() || "Room",
      name_ar: raw.name_ar ?? null,
      type: raw.room_type ?? null,
      polygon: poly.map(toM),
      area_m2: raw.area_m2 ?? Math.round(polygonArea(poly) * unitToM * unitToM * 10) / 10,
      // An unroofed zone has no ceiling. Reporting 2.9 m would put a ceiling
      // finish and a wall height onto a lawn, and every consumer downstream
      // would believe it.
      ceiling_h_m: unroofed ? 0 : DEFAULT_CEILING_H_M,
      unroofed,
      area_derived_m2:
        typeof raw.area_derived_m2 === "number" && raw.area_derived_m2 > 0
          ? Number(raw.area_derived_m2)
          : null,
      derived_note: raw.derived_note?.trim() || null,
      derived_fields: [
        // A measured scale makes the metric polygon a measurement too.
        ...(measuredScale ? [] : ["polygon"]),
        ...(unroofed ? [] : ["ceiling_h_m"]),
        // A stated area with an approximated share is still partly derived.
        ...(raw.area_m2 == null || (Number(raw.area_derived_m2) || 0) > 0 ? ["area_m2"] : []),
      ],
    };
  });

  // Wall derivation runs in normalised space, then converts to metres. Uses the
  // same eps + reconstruction as the exported `deriveWallSegments`, so the
  // editor's wall ids line up with the ones priced here.
  const eps = WALL_DERIVE_EPS;
  const unroofedIds = unroofedIdSet(rooms.map((r) => ({ id: r.id, unroofed: r.unroofed })));
  const allEdges = rawRooms.flatMap(({ raw, poly }) => edgesOf(raw.id, poly, eps));
  const rawWalls = deriveRawWalls(allEdges, eps, unroofedIds);

  const walls: Wall[] = rawWalls.map((w, i) => {
    // Endpoints from line identity: refPoint (foot of the perpendicular, c·n)
    // + t · direction u=(-ny,nx). Diagonal-capable.
    const { a: p0, b: p1 } = rawWallEndpoints(w);
    return {
      id: `wall-${i + 1}`,
      polyline: [toM(p0), toM(p1)],
      thickness_mm: DEFAULT_WALL_THICKNESS_MM,
      is_structural: null,
      room_ids: w.roomIds,
      derived: true,
      source: "derived" as const,
    };
  });

  const partyWalls = walls.filter((w) => w.room_ids.length >= 2).length;
  notes.push(
    `${walls.length} walls derived from shared/boundary polygon edges (${partyWalls} party, ${walls.length - partyWalls} boundary); thickness ${DEFAULT_WALL_THICKNESS_MM} mm and structural status are placeholders.`,
  );
  if (unroofedIds.size > 0) {
    notes.push(
      `${unroofedIds.size} unroofed zone(s): their boundaries emit no derived wall. A wall there exists only where one was drawn.`,
    );
  }

  // --- Linear elements (G1) --------------------------------------------------
  // A drawn boundary wall is a wall in its own right, so it joins walls[] after
  // the derived ones — appended, never interleaved, so derived wall ids keep
  // the numbering every other consumer already expects.
  const elements = buildLinearElements(input.elements ?? [], toM);
  let drawnIndex = 0;
  for (const el of elements) {
    if (el.kind !== "boundary_wall") continue;
    for (let i = 0; i < el.polyline.length - 1; i++) {
      const a = el.polyline[i]!;
      const b = el.polyline[i + 1]!;
      if (polylineLength([a, b]) < 1e-6) continue;
      drawnIndex += 1;
      walls.push({
        id: `wall-drawn-${drawnIndex}`,
        polyline: [a, b],
        thickness_mm: el.width_mm,
        is_structural: null,
        room_ids: [],
        derived: false,
        source: "drawn",
      });
    }
  }
  if (drawnIndex > 0) {
    notes.push(`${drawnIndex} wall segment(s) from drawn boundary-wall elements (measured, not derived).`);
  }
  if (elements.length > 0) {
    notes.push(
      `${elements.length} linear element(s) ingested (${elements.filter((e) => e.derived).length} with defaulted cross-sections).`,
    );
  }

  // --- Openings (A3/A5) — assign each to its nearest derived wall -------------
  const openings: Opening[] = (input.openings ?? [])
    .map((ro): Opening | null => {
      const type: Opening["type"] =
        ro.type === "window" || ro.type === "archway" ? ro.type : "door";
      const def = DEFAULT_OPENING_DIMS[type];
      const dimsDefaulted = ro.width_mm == null || ro.height_mm == null;
      const posNorm = isNumberPair(ro.position) ? (ro.position as [number, number]) : null;
      const posM: Point | null = posNorm
        ? [(posNorm[0] - minX) * unitToM, (posNorm[1] - minY) * unitToM]
        : null;
      let wall_id: string | null = null;
      let along: number | null = ro.along_offset ?? null;
      if (posM && walls.length > 0) {
        let best = Infinity;
        for (const w of walls) {
          const a = w.polyline[0];
          const b = w.polyline[w.polyline.length - 1];
          if (!a || !b) continue;
          const { dist, t } = pointToSegment(posM, a, b);
          if (dist < best) { best = dist; wall_id = w.id; along = t; }
        }
      }
      return {
        id: ro.id,
        wall_id,
        room_id: ro.room_id ?? null,
        type,
        width_mm: ro.width_mm ?? def.width_mm,
        height_mm: ro.height_mm ?? def.height_mm,
        sill_mm: ro.sill_mm ?? def.sill_mm,
        position: posM,
        along_offset: along,
        source: ro.source === "parsed" ? "parsed" : "user_drawn",
        // Defaulted dimensions are always derived — never silently "measured".
        derived: ro.derived ?? dimsDefaulted,
      };
    })
    .filter((o): o is Opening => o !== null);

  notes.push(
    openings.length === 0
      ? "openings: none persisted — returned empty (no doors/windows invented)."
      : `openings: ${openings.length} ingested and snapped to nearest walls (${openings.filter((o) => o.derived).length} with defaulted/derived dimensions).`,
  );

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
    openings,
    elements,
    meta: {
      scale,
      source: input.source === "user_drawn" ? "user_drawn" : "parsed",
      north_deg: DEFAULT_NORTH_DEG,
      level: DEFAULT_LEVEL,
      units: "metric",
      envelope_m: envelope,
      total_area_m2: totalAreaM2,
      unit_to_m: unitToM,
      norm_origin: [minX, minY],
      plot:
        input.plot && measuredScale
          ? {
              width_m: input.plot.width_m,
              depth_m: input.plot.depth_m,
              origin_m: [-minX * unitToM, -minY * unitToM] as Point,
            }
          : null,
    },
    derived: {
      walls: true,
      elements_empty: elements.length === 0,
      wall_thickness: true,
      is_structural: true,
      openings_empty: openings.length === 0,
      ceiling_h: rooms.some((r) => !r.unroofed),
      north: true,
      level: true,
      metric_scale: !measuredScale,
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
  if (d.elements_empty) out.push("elements[] — empty (no boundary walls or runs drawn)");
  if (d.wall_thickness) out.push(`walls[].thickness_mm — default ${DEFAULT_WALL_THICKNESS_MM} mm`);
  if (d.is_structural) out.push("walls[].is_structural — always null (unknown from parse)");
  if (d.openings_empty) out.push("openings[] — empty (no doors/windows persisted)");
  if (d.ceiling_h) out.push(`rooms[].ceiling_h_m — default ${DEFAULT_CEILING_H_M} m`);
  if (d.metric_scale) out.push("rooms[].polygon (metres) — derived from total_area_m2, no surveyed scale");
  if (d.north) out.push(`meta.north_deg — default ${DEFAULT_NORTH_DEG}°`);
  if (d.level) out.push(`meta.level — default "${DEFAULT_LEVEL}"`);
  return out;
}
