// =============================================================================
// lib/plan/elements.ts — linear plan elements (garden pilot G1).
//
// Openings are children of walls; fixtures are points in a room. Neither shape
// fits the things a garden is made of: a boundary wall that encloses nothing, a
// bench that runs along an edge, a planter kerb, an outdoor counter. Those are
// RUNS — measured in linear metres, priced per lm — so they get their own thin
// contract alongside the other two rather than being forced into either.
//
// Coordinates are normalised plan space ([0,1]-ish, the same space as
// rooms.polygon and plan_fixtures.position), so an element survives any later
// change to the plan's metric scale. Length in metres is derived at graph-build
// time by multiplying by meta.unit_to_m — never stored, so it cannot drift from
// the geometry it describes.
//
// One kind is load-bearing for the enclosure model: `boundary_wall`. An
// unroofed zone emits no derived wall at its edges (lib/plan/geometry.ts), so a
// drawn boundary wall is the ONLY way a garden gets a wall — which is exactly
// how a real garden works, and it means the wall's length is what somebody
// drew rather than a by-product of where two lawns happen to meet.
// =============================================================================

export type LinearElementKind =
  | "boundary_wall"
  | "bench_run"
  | "planter_run"
  | "counter_run";

export const LINEAR_ELEMENT_KINDS: readonly LinearElementKind[] = [
  "boundary_wall",
  "bench_run",
  "planter_run",
  "counter_run",
];

export interface LinearElementMeta {
  label: string;
  /** Short code drawn on the SVG sheets (resvg has no icon font). */
  code: string;
  /** Stroke colour on the 2D editor + drawing sheets. */
  color: string;
  /** Default cross-section height in mm, when nobody measures one. */
  defaultHeightMm: number;
  /** Default cross-section width/thickness in mm. */
  defaultWidthMm: number;
  /** BoQ line description, priced per linear metre. */
  boqDescription: string;
}

export const LINEAR_ELEMENT_META: Record<LinearElementKind, LinearElementMeta> = {
  boundary_wall: {
    label: "Boundary wall",
    code: "BW",
    color: "#0F1B2D",
    defaultHeightMm: 1800,
    defaultWidthMm: 200,
    boqDescription: "Boundary wall — blockwork, render and coping",
  },
  bench_run: {
    label: "Bench run",
    code: "BN",
    color: "#A4793A",
    defaultHeightMm: 450,
    defaultWidthMm: 450,
    boqDescription: "Built-in bench seating — substructure, finish and coping",
  },
  planter_run: {
    label: "Planter run",
    code: "PL",
    color: "#4F7A52",
    defaultHeightMm: 600,
    defaultWidthMm: 400,
    boqDescription: "Built-in planter kerb — blockwork, lining and finish",
  },
  counter_run: {
    label: "Counter run",
    code: "CT",
    color: "#8A5A2B",
    defaultHeightMm: 900,
    defaultWidthMm: 600,
    boqDescription: "Outdoor counter — substructure, worktop and finish",
  },
};

export type ElementSource = "parsed" | "user_drawn";

/** Raw persisted row (normalised space), as stored in `plan_elements`. */
export interface RawLinearElement {
  id: string;
  room_id?: string | null;
  kind?: string | null;
  polyline?: unknown; // normalised [[x, y], …], >= 2 points
  height_mm?: number | null;
  width_mm?: number | null;
  source?: string | null;
  derived?: boolean | null;
  /** G4b: build-up and provenance (migration 036). */
  spec?: Record<string, unknown> | null;
}

/** A linear element in the PlanGraph — metric, with its length resolved. */
export interface LinearElement {
  id: string;
  kind: LinearElementKind;
  room_id: string | null;
  /** Metric polyline, origin = plan bbox top-left (same frame as walls). */
  polyline: [number, number][];
  /** Derived from the metric polyline. Never persisted. */
  length_m: number;
  height_mm: number;
  width_mm: number;
  source: ElementSource;
  /** true = cross-section dimensions were DEFAULTED, not measured. */
  derived: boolean;
  /** G4b: build-up (top slab, plinth, kerb) and where each number came from. */
  spec: Record<string, unknown> | null;
}

export function isLinearElementKind(v: unknown): v is LinearElementKind {
  return typeof v === "string" && (LINEAR_ELEMENT_KINDS as readonly string[]).includes(v);
}

/** Parse an unknown value into a polyline of >= 2 points. Null when invalid. */
export function toPolyline(value: unknown): [number, number][] | null {
  if (!Array.isArray(value)) return null;
  const pts: [number, number][] = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const [x, y] = p as unknown[];
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push([x, y]);
  }
  return pts.length >= 2 ? pts : null;
}

/** Total length of a polyline in its own coordinate units. */
export function polylineLength(pts: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

/**
 * Convert persisted rows into metric graph elements.
 *
 * `toMetric` maps a normalised point into the graph's metre frame — the same
 * function buildPlanGraph uses for rooms and walls, passed in so there is one
 * conversion and not two that can disagree.
 */
export function buildLinearElements(
  raw: readonly RawLinearElement[],
  toMetric: (p: [number, number]) => [number, number],
): LinearElement[] {
  const out: LinearElement[] = [];
  for (const r of raw) {
    const pts = toPolyline(r.polyline);
    if (!pts) continue;
    const kind: LinearElementKind = isLinearElementKind(r.kind) ? r.kind : "boundary_wall";
    const meta = LINEAR_ELEMENT_META[kind];
    const metric = pts.map(toMetric);
    const dimsDefaulted = r.height_mm == null || r.width_mm == null;
    out.push({
      id: r.id,
      kind,
      room_id: r.room_id ?? null,
      polyline: metric,
      length_m: Math.round(polylineLength(metric) * 100) / 100,
      height_mm: r.height_mm ?? meta.defaultHeightMm,
      width_mm: r.width_mm ?? meta.defaultWidthMm,
      source: r.source === "parsed" ? "parsed" : "user_drawn",
      // A defaulted cross-section must never silently read as a measured one.
      derived: r.derived ?? dimsDefaulted,
      spec: r.spec && typeof r.spec === "object" ? r.spec : null,
    });
  }
  return out;
}

/** Total linear metres per kind — the quantity the BoQ prices. */
export function lengthByKind(
  elements: readonly LinearElement[],
): Record<LinearElementKind, number> {
  const out = {
    boundary_wall: 0,
    bench_run: 0,
    planter_run: 0,
    counter_run: 0,
  } as Record<LinearElementKind, number>;
  for (const e of elements) out[e.kind] += e.length_m;
  for (const k of LINEAR_ELEMENT_KINDS) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}
