// =============================================================================
// lib/ground-truth/villa94-garden-geometry.ts — Villa 94's garden as polygons (G4).
//
// G3 traced the garden into AREAS, which was enough to price it. A dimensioned
// drawing needs SHAPES, and a shape whose printed area disagrees with its own
// outline is a drawing nobody should sign. So this module is the geometry, and
// every zone's area is computed from its polygon — never typed in.
//
// Coordinates are metres from the north-west inside corner of the boundary wall
// (+x east, +y south), read from the setting-out drawing GL-PS-001 at 1:50 by
// extracting the PDF's path geometry. `toNormalised()` converts to the plan's
// storage space, where x in [0, 1] spans the plot width.
//
// Three refinements over the G3 area arithmetic, each a correction rather than
// a tuning, and each disclosed where the numbers are recorded:
//
//  1. The strip between the north planting bed and the wall feature
//     (3.63–4.33 m × 0.13–0.73 m) is paving on the drawing. G3 left it in the
//     lawn remainder; it is not contiguous with the lawn and cannot be.
//  2. The curved lawn edge in the seating-bench court is traced from its actual
//     end points — an elliptical quarter, radii 2.91 × 2.85 m — instead of G3's
//     circular formula on a corner that is not square.
//  3. The step block beside the villa's east wing runs to the villa face, as
//     drawn, so the lawn has no hole.
//
// Zones are simple polygons (no holes): the front lawn is split around the
// planter box into a north U and a south band, which is how a setting-out
// drawing dimensions around a fixed object anyway.
//
// G4b adds what stands on the plot and how high: levels (GL-PS-001), structure
// heights and build-ups (A-A-001, B-A-001/002, C-A-001), and the existing villa,
// garage, pergola, steps and boundary walls as CONTEXT. Tracing the villa's
// building line on GL-PS-001 (calibrated on the 1800 mm planter box: 56.69 pt
// per metre, i.e. 1:50) exposed three G4 trace errors, corrected here and
// disclosed wherever totals are reported:
//
//  4. The side courtyard is an L — the east wing steps back at 11.20 m, leaving
//     0.59 × 2.13 m of +300 paving the G4 rectangle missed (+1.26 m²).
//  5. The front approach starts at the villa's entrance block (22.75 m), not at
//     21.59 m inside it (−2.76 m²), and it is two levels — +150 to 24.27 m, ±000
//     beyond — so it is two zones.
//  6. A +150 step spans the courtyard mouth (4.43–6.92 × 9.34–9.63 m); G4 left
//     it in the lawn (−0.72 m²).
// =============================================================================

import polygonClipping from "polygon-clipping";

export type Pt = [number, number];

export const PLOT = { width_m: 12.06, depth_m: 26.64 } as const;
export const DRAWING_REF = "GL-PS-001 (as revised setting-out plan), 1:50";
export const SECTION_REF = {
  pergola: "A-A-001 layout + sectional elevations A-A and B-B, 1:20",
  bench: "B-A-001 section A-A (1:10) and B-A-002 section B-B (1:20)",
  wallFeature: "C-A-001 layout + sectional elevation A-A, 1:10",
} as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Shoelace area, absolute. */
export function ringArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// --- The curved edge ----------------------------------------------------------

/** Centre and radii of the elliptical quarter bounding the seating-bench court. */
const ARC = { cx: 10.45, cy: 2.25, rx: 2.91, ry: 2.85, segments: 12 } as const;

/** Arc points from the court's south edge (10.45, 5.10) round to its west edge
 *  (7.54, 2.25), convex toward the lawn. */
function arcPoints(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= ARC.segments; i++) {
    const t = (i / ARC.segments) * (Math.PI / 2);
    pts.push([
      Math.round((ARC.cx - ARC.rx * Math.sin(t)) * 10_000) / 10_000,
      Math.round((ARC.cy + ARC.ry * Math.cos(t)) * 10_000) / 10_000,
    ]);
  }
  return pts;
}

// --- Zones -------------------------------------------------------------------

export interface GeoZone {
  id: string;
  name: string;
  kind: "paving" | "artificial_grass" | "planting_bed" | "structure";
  polygon: Pt[];
  /** Computed from the polygon, rounded to 0.01 m². */
  area_m2: number;
  /** The share of the area bounded by an approximated edge, and why. */
  area_derived_m2?: number;
  derived_note?: string;
  /** Finished level, mm relative to ±000 FFL. Absent = not stated on the drawing. */
  level_mm?: number;
  /** Structure zones: top of structure above the zone level, mm. */
  height_mm?: number;
  spec?: Record<string, unknown>;
}

/** Stated ±000 FFL on the setting-out plan. */
const AT_FFL = { level_mm: 0, spec: { level_source: DRAWING_REF } };

const benchCourt: Pt[] = [
  [7.54, 0.13],
  [11.89, 0.13],
  [11.89, 5.1],
  ...arcPoints(),
];

/** Backyard open ground between the boundary and the villa — three rectangles. */
const BACKYARD_OPEN: Pt[][] = [
  rect(0.13, 0.13, 4.43, 9.63),
  rect(4.43, 0.13, 6.92, 9.63),
  rect(6.92, 0.13, 11.89, 6.72),
];

const BASE: Omit<GeoZone, "area_m2">[] = [
  { id: "z-planting-north", name: "North planting strip", kind: "planting_bed", polygon: rect(0.13, 0.13, 3.63, 0.73) },
  {
    id: "z-pergola",
    name: "Aluminium pergola",
    kind: "structure",
    polygon: rect(0.13, 0.73, 3.63, 4.23),
    level_mm: 0,
    height_mm: 2800,
    spec: {
      system: "Motorised aluminium louvred pergola",
      member_mm: 150,
      beam_depth_mm: 150,
      clear_height_mm: 2650,
      // North-west corner of each 150 mm post, mm from the zone's north-west corner.
      posts_mm: [[1000, 0], [3350, 0], [1000, 3350], [3350, 3350]],
      // Beam lines (west / north edge of each 150 mm member), mm from the same corner.
      beams_x_mm: [0, 1000, 2175, 3350],
      beams_y_mm: [0, 1117, 2233, 3350],
      level_source: DRAWING_REF,
      height_source: SECTION_REF.pergola,
    },
  },
  {
    id: "z-paving-pergola-court",
    name: "Pergola court paving",
    kind: "paving",
    // An L around the pergola, running north past the planting strip to the wall.
    polygon: [
      [3.63, 0.13],
      [4.33, 0.13],
      [4.33, 4.78],
      [0.13, 4.78],
      [0.13, 4.23],
      [3.63, 4.23],
    ],
    ...AT_FFL,
  },
  { id: "z-paving-wall-feature", name: "Wall-feature terrace", kind: "paving", polygon: rect(4.33, 0.13, 7.54, 2.1), ...AT_FFL },
  { id: "z-paving-bench-court", name: "Seating-bench court", kind: "paving", polygon: benchCourt, ...AT_FFL },
  { id: "z-planting-west", name: "West planting strip", kind: "planting_bed", polygon: rect(0.13, 4.78, 0.73, 9.63) },
  {
    id: "z-paving-courtyard",
    name: "Side courtyard",
    kind: "paving",
    // An L: the villa's east wing steps back at 11.20 m.
    polygon: [
      [4.43, 9.63],
      [6.92, 9.63],
      [6.92, 11.2],
      [7.51, 11.2],
      [7.51, 13.33],
      [4.43, 13.33],
    ],
    level_mm: 300,
    spec: { level_source: DRAWING_REF },
  },
  {
    id: "z-paving-front-upper",
    name: "Front approach — upper",
    kind: "paving",
    polygon: rect(5.64, 22.75, 8.02, 24.27),
    level_mm: 150,
    spec: { level_source: DRAWING_REF },
  },
  { id: "z-paving-front-lower", name: "Front approach — lower", kind: "paving", polygon: rect(5.64, 24.27, 8.02, 26.64), ...AT_FFL },
  {
    id: "z-lawn-front-north",
    name: "Front lawn — north",
    kind: "artificial_grass",
    // A U round the planter box (9.14–10.94 × 23.22–25.02).
    polygon: [
      [8.12, 21.69],
      [11.96, 21.69],
      [11.96, 25.02],
      [10.94, 25.02],
      [10.94, 23.22],
      [9.14, 23.22],
      [9.14, 25.02],
      [8.12, 25.02],
    ],
    ...AT_FFL,
  },
  { id: "z-lawn-front-south", name: "Front lawn — south", kind: "artificial_grass", polygon: rect(8.12, 25.02, 11.96, 26.54), ...AT_FFL },
];

/** Entrance steps (outer tread footprints) — ground that is neither lawn nor in scope. */
const STEPS: Pt[][] = [rect(1.05, 9.03, 3.47, 9.63), rect(7.48, 6.13, 11.29, 6.72), rect(4.43, 9.34, 6.92, 9.63)];

type MP = [number, number][][][];

/** The backyard lawn: whatever open ground nothing else claims. */
function backyardLawn(): Pt[] {
  const claimed = [...BASE.filter((z) => z.polygon[0]![1] < 9.7).map((z) => z.polygon), ...STEPS];
  const [first, ...others] = BACKYARD_OPEN.map((p) => [p]) as never[];
  const open = polygonClipping.union(first!, ...others) as MP;
  const rest = polygonClipping.difference(open as never, ...(claimed.map((p) => [p]) as never[])) as MP;
  // Keep the largest piece. Anything else is a numerical crumb, and the test
  // below pins that there is none of real size.
  const pieces = rest
    .map((poly) => poly[0]!.slice(0, -1) as Pt[]) // outer ring, closing point dropped
    .sort((a, b) => ringArea(b) - ringArea(a));
  return pieces[0]!.map(([x, y]) => [Math.round(x * 10_000) / 10_000, Math.round(y * 10_000) / 10_000]);
}

/** Area of the lawn bounded by the approximated curve (outside the ellipse). */
function curveCutArea(): number {
  const corner = rect(7.54, 2.25, 10.45, 5.1);
  const insideCourt = polygonClipping.intersection([corner] as never, [benchCourt] as never) as MP;
  const inside = insideCourt.reduce((s, poly) => s + ringArea(poly[0]!.slice(0, -1) as Pt[]), 0);
  return r2(ringArea(corner) - inside);
}

export function villa94Zones(): GeoZone[] {
  const lawnPolygon = backyardLawn();
  const cut = curveCutArea();
  const zones: GeoZone[] = [
    ...BASE.map((z) => ({ ...z, area_m2: r2(ringArea(z.polygon)) })),
    {
      id: "z-lawn-back",
      name: "Backyard lawn",
      kind: "artificial_grass" as const,
      polygon: lawnPolygon,
      area_m2: r2(ringArea(lawnPolygon)),
      ...AT_FFL,
      area_derived_m2: cut,
      derived_note:
        `${cut} m² of this lawn lies behind the curved edge of the seating-bench court, traced as an elliptical quarter (radii 2.91 × 2.85 m) from its end points on ${DRAWING_REF}. The true curve was not dimensioned.`,
    },
  ];
  return zones;
}

// --- Runs, units, points -----------------------------------------------------

export interface GeoRun {
  id: string;
  kind: "bench_run" | "planter_run" | "counter_run" | "boundary_wall";
  polyline: Pt[];
  variant?: "bar" | "bbq";
  /** Top of the run above its zone level, mm. */
  height_mm: number;
  /** Overall width across the run, mm. */
  width_mm: number;
  /**
   * Build-up and provenance. `band_mm` places the width across the polyline, mm,
   * positive to the RIGHT of travel (plan x east, y south); absent = centred.
   * The traced polylines are the drawing's reference lines (a kerb face, a
   * counter's setting-out line), not always centrelines.
   */
  spec: Record<string, unknown>;
}

export const RUNS: GeoRun[] = [
  // Inside the pergola: BBQ 3000 long, bar 3400 long, meeting in an L.
  {
    id: "r-counter-bbq",
    kind: "counter_run",
    variant: "bbq",
    polyline: [[0.73, 0.88], [0.73, 3.88]],
    height_mm: 900,
    width_mm: 900,
    // 200 mm cladding against the boundary wall + 700 mm cabinet: x 0.13–1.03 m.
    spec: { band_mm: [-300, 600], top_slab_mm: 100, cabinet_mm: 750, plinth_mm: 50, cladding_mm: 200, source: SECTION_REF.pergola },
  },
  {
    id: "r-counter-bar",
    kind: "counter_run",
    variant: "bar",
    polyline: [[0.13, 3.855], [3.53, 3.855]],
    height_mm: 1000,
    width_mm: 450,
    spec: { top_slab_mm: 100, support_mm: 200, source: SECTION_REF.pergola },
  },
  // The L in the north-east corner. The traced line is the planting-side face of
  // the planter kerb; the seat lies 100–700 mm in front of it.
  {
    id: "r-bench-l",
    kind: "bench_run",
    polyline: [[7.69, 0.73], [11.29, 0.73], [11.29, 4.63]],
    height_mm: 350,
    width_mm: 600,
    spec: { band_mm: [100, 700], body_mm: 300, plinth_mm: 50, source: SECTION_REF.bench },
  },
  {
    id: "r-planter-l",
    kind: "planter_run",
    polyline: [[7.64, 0.63], [11.39, 0.63], [11.39, 4.68]],
    height_mm: 600,
    width_mm: 700,
    // 600 mm of planting behind a 100 mm kerb; the kerb is the bench's +600 back.
    spec: { band_mm: [-500, 200], kerb_mm: 100, kerb_band_mm: [100, 200], soil: "sweet soil", source: SECTION_REF.bench },
  },
];

export interface GeoUnit {
  id: string;
  type: "planter_box" | "wall_feature" | "bbq_grill";
  position: Pt;
  spec: Record<string, unknown>;
}

export const UNITS: GeoUnit[] = [
  {
    id: "u-wall-feature",
    type: "wall_feature",
    position: [5.935, 0.28],
    spec: {
      width_mm: 2500,
      depth_mm: 300,
      height_mm: 1800,
      facing: "south",
      arch: { opening_mm: 1751, spring_mm: 1000, crown_mm: 1650 },
      bench: { top_mm: 450, slab_mm: 100, projection_mm: 275 },
      source: SECTION_REF.wallFeature,
    },
  },
  {
    id: "u-planter-olive",
    type: "planter_box",
    position: [10.04, 24.12],
    spec: { width_mm: 1800, depth_mm: 1800, height_mm: 450, wall_mm: 200, planting: "olive tree", source: DRAWING_REF },
  },
  {
    id: "u-bbq-grill",
    type: "bbq_grill",
    position: [0.58, 2.0],
    spec: { width_mm: 700, depth_mm: 500, height_mm: 150, on: "r-counter-bbq", source: SECTION_REF.pergola },
  },
];

// --- Context (existing, not in scope) ----------------------------------------------

export interface GeoContext {
  id: string;
  kind: "existing_building" | "existing_structure" | "steps" | "boundary_wall";
  name: string;
  polygon: Pt[];
  height_mm: number;
  derived: boolean;
  note: string;
}

const WALL_NOTE =
  "Existing boundary wall. Height not dimensioned: ~2000 mm scaled from the existing-boundary-wall-height marker on A-A-001 section B-B.";

const tread = (id: string, name: string, poly: Pt[], h: number): GeoContext => ({
  id,
  kind: "steps",
  name,
  polygon: poly,
  height_mm: h,
  derived: false,
  note: `Tread +${h} FFL per ${DRAWING_REF}.`,
});

export const CONTEXT: GeoContext[] = [
  {
    id: "c-villa",
    kind: "existing_building",
    name: "Existing G+1 villa",
    polygon: [
      [0, 9.63], [4.43, 9.63], [4.43, 13.33], [7.51, 13.33], [7.51, 11.2], [6.92, 11.2], [6.92, 6.72],
      [12.06, 6.72], [12.06, 21.6], [8.02, 21.6], [8.02, 22.75], [5.64, 22.75], [5.64, 21.3], [0, 21.3],
    ],
    height_mm: 7000,
    derived: true,
    note: `Footprint traced from the building line on ${DRAWING_REF}. Height is not on the landscape pack: 7000 mm assumed for a G+1 villa.`,
  },
  {
    id: "c-garage",
    kind: "existing_building",
    name: "Existing garage",
    polygon: rect(0, 21.3, 5.64, 26.63),
    height_mm: 3200,
    derived: true,
    note: `Footprint traced from ${DRAWING_REF}. Height not on the pack: 3200 mm assumed.`,
  },
  {
    id: "c-existing-pergola",
    kind: "existing_structure",
    name: "Existing pergola",
    polygon: rect(4.38, 6.7, 6.97, 10.23),
    height_mm: 3000,
    derived: true,
    note: `Six slats spanning between the villa wings, traced from ${DRAWING_REF}. Height not on the pack: 3000 mm assumed.`,
  },
  tread("c-steps-west-150", "West steps (+150)", rect(1.05, 9.03, 3.47, 9.63), 150),
  tread("c-steps-west-300", "West steps (+300)", rect(1.36, 9.34, 3.18, 9.63), 300),
  tread("c-steps-east-150", "East steps (+150)", rect(7.48, 6.13, 11.29, 6.72), 150),
  tread("c-steps-east-300", "East steps (+300)", rect(7.8, 6.44, 11.22, 6.72), 300),
  tread("c-steps-courtyard-150", "Courtyard step (+150)", rect(4.43, 9.34, 6.92, 9.63), 150),
  { id: "c-wall-north", kind: "boundary_wall", name: "North boundary wall", polygon: rect(0, 0, 12.06, 0.13), height_mm: 2000, derived: true, note: WALL_NOTE },
  { id: "c-wall-west", kind: "boundary_wall", name: "West boundary wall", polygon: rect(0, 0.13, 0.13, 9.63), height_mm: 2000, derived: true, note: WALL_NOTE },
  { id: "c-wall-east", kind: "boundary_wall", name: "East boundary wall", polygon: rect(11.89, 0.13, 12.06, 6.72), height_mm: 2000, derived: true, note: WALL_NOTE },
  { id: "c-wall-front-east", kind: "boundary_wall", name: "Front east boundary wall", polygon: rect(11.96, 21.6, 12.06, 26.64), height_mm: 2000, derived: true, note: `${WALL_NOTE} Front walls assumed to match.` },
  { id: "c-wall-front-south", kind: "boundary_wall", name: "Front south boundary wall", polygon: rect(8.02, 26.54, 11.96, 26.64), height_mm: 2000, derived: true, note: `${WALL_NOTE} Front walls assumed to match.` },
];

export interface GeoPoint {
  id: string;
  type: "garden_light" | "boundary_light";
  position: Pt;
  zone_id: string | null;
  fitting: string;
}

/**
 * Lighting AS DESIGNED — not surveyed.
 *
 * The drawing pack has no lighting layout. The count and the fitting mix are the
 * contract's (7 inground 1 W, 6 spike 8.5 W, 7 spike 4.5 W and an LED strip
 * billed as 8 points; 9 boundary lights by variation). Positions are placed on
 * the plan the way a design session would place them, and every document that
 * shows them says so. None sits inside the pergola: its eight downlights are
 * part of the pergola.
 */
export const POINTS: GeoPoint[] = [
  // 7 inground 1 W — paving
  { id: "p-ig-1", type: "garden_light", position: [4.0, 2.5], zone_id: "z-paving-pergola-court", fitting: "Inground 1 W" },
  { id: "p-ig-2", type: "garden_light", position: [5.2, 1.6], zone_id: "z-paving-wall-feature", fitting: "Inground 1 W" },
  { id: "p-ig-3", type: "garden_light", position: [6.7, 1.6], zone_id: "z-paving-wall-feature", fitting: "Inground 1 W" },
  { id: "p-ig-4", type: "garden_light", position: [8.5, 1.9], zone_id: "z-paving-bench-court", fitting: "Inground 1 W" },
  { id: "p-ig-5", type: "garden_light", position: [9.6, 3.6], zone_id: "z-paving-bench-court", fitting: "Inground 1 W" },
  { id: "p-ig-6", type: "garden_light", position: [5.67, 11.5], zone_id: "z-paving-courtyard", fitting: "Inground 1 W" },
  { id: "p-ig-7", type: "garden_light", position: [6.83, 24.1], zone_id: "z-paving-front-upper", fitting: "Inground 1 W" },
  // 6 spike 8.5 W — backyard lawn
  { id: "p-sp8-1", type: "garden_light", position: [2.0, 5.5], zone_id: "z-lawn-back", fitting: "Spike 8.5 W" },
  { id: "p-sp8-2", type: "garden_light", position: [3.5, 7.5], zone_id: "z-lawn-back", fitting: "Spike 8.5 W" },
  { id: "p-sp8-3", type: "garden_light", position: [5.5, 5.5], zone_id: "z-lawn-back", fitting: "Spike 8.5 W" },
  { id: "p-sp8-4", type: "garden_light", position: [6.5, 8.5], zone_id: "z-lawn-back", fitting: "Spike 8.5 W" },
  { id: "p-sp8-5", type: "garden_light", position: [8.0, 5.8], zone_id: "z-lawn-back", fitting: "Spike 8.5 W" },
  { id: "p-sp8-6", type: "garden_light", position: [10.5, 5.6], zone_id: "z-lawn-back", fitting: "Spike 8.5 W" },
  // 7 spike 4.5 W — planting
  { id: "p-sp4-1", type: "garden_light", position: [1.0, 0.43], zone_id: "z-planting-north", fitting: "Spike 4.5 W" },
  { id: "p-sp4-2", type: "garden_light", position: [2.5, 0.43], zone_id: "z-planting-north", fitting: "Spike 4.5 W" },
  { id: "p-sp4-3", type: "garden_light", position: [0.43, 6.0], zone_id: "z-planting-west", fitting: "Spike 4.5 W" },
  { id: "p-sp4-4", type: "garden_light", position: [0.43, 8.0], zone_id: "z-planting-west", fitting: "Spike 4.5 W" },
  { id: "p-sp4-5", type: "garden_light", position: [8.6, 22.4], zone_id: "z-lawn-front-north", fitting: "Spike 4.5 W" },
  { id: "p-sp4-6", type: "garden_light", position: [11.5, 22.4], zone_id: "z-lawn-front-north", fitting: "Spike 4.5 W" },
  { id: "p-sp4-7", type: "garden_light", position: [10.0, 25.8], zone_id: "z-lawn-front-south", fitting: "Spike 4.5 W" },
  // LED strip, billed as 8 points — along the planter L
  ...[[8.0, 0.63], [9.2, 0.63], [10.4, 0.63], [11.39, 1.0], [11.39, 2.0], [11.39, 3.0], [11.39, 4.0], [11.39, 4.6]].map(
    ([x, y], i): GeoPoint => ({
      id: `p-strip-${i + 1}`,
      type: "garden_light",
      position: [x!, y!],
      zone_id: "z-paving-bench-court",
      fitting: "LED strip (billed per point)",
    }),
  ),
  // 9 boundary lights — on the boundary wall faces
  ...[[0.13, 5.5], [0.13, 7.0], [0.13, 8.5], [11.89, 1.2], [11.89, 2.4], [11.89, 3.6], [11.89, 4.8], [11.89, 6.0], [11.96, 24.0]].map(
    ([x, y], i): GeoPoint => ({
      id: `p-boundary-${i + 1}`,
      type: "boundary_light",
      position: [x!, y!],
      zone_id: null,
      fitting: "Boundary wall light",
    }),
  ),
];

/** The source statement every lighting document carries. */
export const LIGHTING_SOURCE =
  "AS DESIGNED — not surveyed. Count and fitting mix from the contract; positions placed on the plan.";

/** Metres → the plan's normalised storage space (x in [0, 1] across the plot). */
export function toNormalised(p: Pt): Pt {
  return [p[0] / PLOT.width_m, p[1] / PLOT.width_m];
}

/** Polyline length in metres. */
export function lineLength(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    s += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
  }
  return r2(s);
}

// --- As plan records ------------------------------------------------------------

/** The garden as the rows the plan tables hold (normalised space), for the live
 *  seed script and for tests that build a PlanGraph without a database. */
export function villa94PlanRecords() {
  const zones = villa94Zones();
  return {
    plot: { width_m: PLOT.width_m, depth_m: PLOT.depth_m },
    rooms: zones.map((z) => ({
      id: z.id,
      name_en: z.name,
      name_ar: null,
      room_type: z.kind,
      area_m2: z.area_m2,
      polygon: z.polygon.map(toNormalised),
      unroofed: true,
      area_derived_m2: z.area_derived_m2 ?? null,
      derived_note: z.derived_note ?? null,
      level_mm: z.level_mm ?? null,
      height_mm: z.height_mm ?? null,
      spec: z.spec ?? null,
    })),
    elements: RUNS.map((r) => ({
      id: r.id,
      kind: r.kind,
      polyline: r.polyline.map(toNormalised),
      variant: r.variant ?? null,
      source: "user_drawn",
      height_mm: r.height_mm,
      width_mm: r.width_mm,
      derived: false,
      spec: r.spec,
    })),
    context: CONTEXT.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      polygon: c.polygon.map(toNormalised),
      base_mm: 0,
      height_mm: c.height_mm,
      derived: c.derived,
      note: c.note,
    })),
    fixtures: [
      ...UNITS.map((u) => ({
        id: u.id,
        layer: "landscape",
        type: u.type,
        room_id: null as string | null,
        position: toNormalised(u.position),
        spec: u.spec as Record<string, unknown> | null,
      })),
      ...POINTS.map((p) => ({
        id: p.id,
        layer: "electrical",
        type: p.type,
        room_id: p.zone_id,
        position: toNormalised(p.position),
        spec: { fitting: p.fitting, source: "as_designed" } as Record<string, unknown> | null,
      })),
    ],
  };
}
