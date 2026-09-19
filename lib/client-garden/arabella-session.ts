// =============================================================================
// lib/client-garden/arabella-session.ts — the design session's measurements,
// applied to the client garden (garden pilot G5d).
//
// Newspace measured five things on site and gave two AGGREGATES (Sheet A of
// data/garden pilot/Arabella_Session_Capture.xlsx). This module turns them into
// zone geometry, and says for every zone which constraint moved it:
//
//   point measures (become MEASURED where they fix a boundary-critical dimension)
//     - path run from the garden gate ............ 12.2 m   (drafted 20.6)
//     - garden-gate entrance area width .......... 5.85 m   (not drawn in the draft)
//     - separator wall → end-of-pathway wall ..... 6.0 m    (drafted 6.0 — confirms)
//     - front / street border width .............. 5.3 m    (assumed 2.2)
//     - door landing at the villa door ........... 1.20 × 1.30 m (new element)
//   aggregates (never turned into invented per-zone "measurements")
//     - total artificial grass ≈ 50 m²             (drafted 76.9)
//     - total tiled area ≈ 69.4 m²                 (drafted 62.95, pergola slab incl.)
//
// THE REFIT RULE. Every cross-section the draft DESIGNED stays as designed — the
// 0.6 m rear bed, the 2.7 m rear lawn, the 1.0 m path, the 2.6 m side terrace, the
// 2.4 m side lawn, the 3.5 × 3.5 m pergola. The measured runs set lengths along the
// rear strip; the two aggregates are then met by sizing the only surfaces the
// draft never designed: the new entrance area's paved depth (→ tiled total) and
// the front garden's grass patch (→ grass total). What is left of each becomes
// planting bed. Those two sizes are DERIVED, noted "sized to measured aggregate".
//
// WHAT ABSORBS THE DIFFERENCE. The measured runs along the rear strip — entrance
// area 5.85 + path 12.2, then the 6.0 m court beyond the separator wall — account
// for 24.05 m of a plot whose width (26.7 m) is itself derived from the type plan.
// The remaining 2.35 m at the garage end of the rear strip is left UNALLOCATED:
// not zoned, not priced, stated. It is not spread across zones (that would invent
// dimensions) and the plot is not shrunk (Newspace did not measure it). The DRAFT
// watermark stays on while the plot is derived.
//
// Frame: the type-plan frame of arabella-reference.ts (metres, +x from the garage
// end along the 26.7 m frontage, +y from the rear boundary toward the street);
// the records reach the database through toSite / toSitePath like every other
// Arabella record. No client personal name appears here.
// =============================================================================

import { PLOT, SOURCE_NOTE, toSite, toSitePath } from "./arabella-reference";

export const SESSION_SOURCE = "Newspace site measurement, design session Sep 2026";
export const AGGREGATE_NOTE = "sized to measured aggregate";
/** Who the session's corrections are attributed to — on their own corrections only. */
export const SESSION_FIRM = "Newspace";
export const SESSION_REF = "three-firms #1 — Arabella design session, Sep 2026";

/** Sheet A, as captured (the session script re-reads the workbook and asserts these). */
export const SESSION_MEASURES = {
  entrance_area_width_m: 5.85,
  path_from_gate_m: 12.2,
  separator_to_end_wall_m: 6.0,
  front_border_width_m: 5.3,
  door_landing_m: [1.2, 1.3] as const,
  total_grass_m2: 50,
  total_tiled_m2: 69.4,
} as const;

type Pt = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const r2 = (n: number) => Math.round(n * 100) / 100;
export const polyArea = (poly: readonly Pt[]) =>
  Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * p[1], 0)) / 2;
const bbox = (poly: readonly Pt[]) => ({ x0: Math.min(...poly.map((p) => p[0])), y0: Math.min(...poly.map((p) => p[1])), x1: Math.max(...poly.map((p) => p[0])), y1: Math.max(...poly.map((p) => p[1])) });

export type ZoneKey = "rear-bed" | "rear-lawn" | "rear-path" | "entrance" | "landing" | "court" | "pergola" | "side-deck" | "side-lawn" | "side-bed" | "front-lawn" | "front-bed";

/** The zones as the G5 design seed drew them (type-plan frame) — the "old" of the reconciliation. */
export const DRAFT_ZONES: { key: ZoneKey; name: string; type: string; poly: Pt[] }[] = [
  { key: "rear-bed", name: "Rear planting bed", type: "planting_bed", poly: rect(0, 0, 20.6, 0.6) },
  { key: "rear-lawn", name: "Rear garden — lawn", type: "artificial_grass", poly: rect(0, 0.6, 20.6, 3.3) },
  { key: "rear-path", name: "Porcelain path — garden gate to side garden", type: "path", poly: rect(0, 3.3, 20.6, 4.3) },
  { key: "court", name: "Pergola court — porcelain paving", type: "paving", poly: [[20.6, 0], [23.2, 0], [23.2, 3.5], [26.7, 3.5], [26.7, 4.3], [20.6, 4.3]] },
  { key: "pergola", name: "Louvred pergola (replaces existing gazebo)", type: "structure", poly: rect(23.2, 0, 26.7, 3.5) },
  { key: "side-deck", name: "Side garden — porcelain paving terrace", type: "paving", poly: rect(21.1, 4.3, 23.7, 10.5) },
  { key: "side-lawn", name: "Side garden — lawn", type: "artificial_grass", poly: rect(23.7, 4.3, 26.1, 10.5) },
  { key: "side-bed", name: "Side garden — planting bed", type: "planting_bed", poly: rect(26.1, 4.3, 26.7, 10.5) },
  { key: "front-lawn", name: "Front garden — lawn", type: "artificial_grass", poly: rect(0.6, 6.5, 2.2, 10.5) },
  { key: "front-bed", name: "Front garden — planting bed", type: "planting_bed", poly: rect(0, 6.5, 0.6, 10.5) },
];

/** Which aggregate a zone type counts toward. The pergola's base slab is tiled (the drafted 62.95 included it). */
export const aggregateOf = (type: string): "grass" | "tiled" | null =>
  type === "artificial_grass" ? "grass" : type === "paving" || type === "path" || type === "structure" ? "tiled" : null;

/** Which constraint moved a zone — each change of the change report carries exactly one. */
export type Cause = "dimension update" | "aggregate refit";

export interface SessionZone {
  key: ZoneKey;
  name: string;
  type: string;
  poly: Pt[];
  /** false = a boundary-critical dimension of this zone was measured at the session. */
  dims_derived: boolean;
  note: string;
  /** The constraints that shaped it, in the order applied (empty = unchanged from the draft). */
  drivers: Cause[];
  /** The constraint(s), in words. */
  because: string;
}

// --- The refit (type-plan frame) --------------------------------------------------------

const M = SESSION_MEASURES;
/** Separator wall's court-side face and the rear-strip x at which the measured path starts. */
const SEPARATOR_X = 20.6;
const PATH_X0 = r2(SEPARATOR_X - M.path_from_gate_m); // 8.4
const ENTRANCE_X0 = r2(PATH_X0 - M.entrance_area_width_m); // 2.55
/** The unallocated residual at the garage end: x 0.2 (end wall face) → ENTRANCE_X0. */
export const RESIDUAL = { x0: 0.2, x1: ENTRANCE_X0, width_m: r2(ENTRANCE_X0 - 0.2) } as const;
/**
 * Door landing at the villa door facing the entrance area, where the entrance area
 * meets the path (position from photo WA0084 — derived, to verify; the size is measured).
 */
const LANDING = rect(r2(PATH_X0 - M.door_landing_m[0]), r2(4.3 - M.door_landing_m[1]), PATH_X0, 4.3);
const LX0 = LANDING[0]![0];
const LY0 = LANDING[0]![1];

/** Fixed tiled surfaces (measured or designed): path, court, pergola slab, side terrace, landing. */
function fixedTiled(): number {
  const court = polyArea(DRAFT_ZONES.find((z) => z.key === "court")!.poly);
  const pergola = polyArea(DRAFT_ZONES.find((z) => z.key === "pergola")!.poly);
  const terrace = polyArea(DRAFT_ZONES.find((z) => z.key === "side-deck")!.poly);
  return M.path_from_gate_m * 1.0 + court + pergola + terrace + M.door_landing_m[0] * M.door_landing_m[1];
}

/** Entrance area paved depth (from the villa face), to the cm, so the tiled total reconciles. */
export const ENTRANCE_DEPTH_M = r2((M.total_tiled_m2 - fixedTiled() + M.door_landing_m[0] * M.door_landing_m[1]) / M.entrance_area_width_m);
/** Rear lawn along the measured path, at its designed 2.7 m depth. */
const REAR_LAWN = rect(PATH_X0, 0.6, SEPARATOR_X, 3.3);
/** Front lawn patch: the drafted patch's proportions (1.6 : 4.0), sized so the grass total reconciles. */
const FRONT_PATCH_M2 = M.total_grass_m2 - polyArea(REAR_LAWN) - polyArea(DRAFT_ZONES.find((z) => z.key === "side-lawn")!.poly);
const FRONT_PATCH_W = r2(Math.sqrt((FRONT_PATCH_M2 * 1.6) / 4.0));
const FRONT_PATCH_D = r2(FRONT_PATCH_M2 / FRONT_PATCH_W);

/**
 * The client garden's zones after the session, in two stages so every movement
 * has one cause:
 *   "measured" — the point measures only. Lengths change; every cross-section is
 *                the draft's (the entrance area paved at the path's 1.0 m, the
 *                rear lawn running on through it, the front lawn filling the wider
 *                border at its assumed depth). Grass and tile totals are whatever
 *                that gives — NOT the measured aggregates.
 *   "refit"    — then the aggregates: the entrance area's paved depth and the front
 *                lawn patch are sized so the totals are ≈ 69.4 m² tiled and ≈ 50 m²
 *                of grass; what they give up becomes planting bed.
 */
export function sessionZones(stage: "measured" | "refit" = "refit"): SessionZone[] {
  const refit = stage === "refit";
  const fx1 = M.front_border_width_m;
  const draft = (k: ZoneKey) => DRAFT_ZONES.find((z) => z.key === k)!;
  const measured = (what: string) => `${what} (${SESSION_SOURCE})`;
  const ey = refit ? r2(4.3 - ENTRANCE_DEPTH_M) : 3.3;
  const patch: Pt[] = refit ? rect(0.6, r2(10.5 - FRONT_PATCH_D), r2(0.6 + FRONT_PATCH_W), 10.5) : rect(0.6, 6.5, fx1, 10.5);
  const both: Cause[] = ["dimension update", "aggregate refit"];
  return [
    {
      ...draft("rear-path"),
      poly: rect(PATH_X0, 3.3, SEPARATOR_X, 4.3),
      dims_derived: false,
      note: `${measured(`run from the garden gate ${M.path_from_gate_m} m`)}; width 1.0 m by design; set against the villa's rear face (${SOURCE_NOTE})`,
      drivers: ["dimension update"],
      because: `path run from the garden gate measured ${M.path_from_gate_m} m (drafted 20.6)`,
    },
    {
      key: "entrance",
      name: "Garden entrance area — porcelain paving",
      type: "paving",
      // Paved from the villa face out, less the door landing (its own element) at the east end.
      poly: LY0 <= ey ? rect(ENTRANCE_X0, ey, LX0, 4.3) : [[ENTRANCE_X0, ey], [PATH_X0, ey], [PATH_X0, LY0], [LX0, LY0], [LX0, 4.3], [ENTRANCE_X0, 4.3]],
      dims_derived: true,
      note: refit
        ? `${measured(`width ${M.entrance_area_width_m} m`)}; paved depth ${ENTRANCE_DEPTH_M} m ${AGGREGATE_NOTE} (total tiled ≈ ${M.total_tiled_m2} m²)`
        : `${measured(`width ${M.entrance_area_width_m} m`)}; paved at the path's 1.0 m until the tiled aggregate sizes it`,
      drivers: refit ? both : ["dimension update"],
      because: `width measured ${M.entrance_area_width_m} m${refit ? `; paved depth sized so the tiled total is ≈ ${M.total_tiled_m2} m²` : ""}`,
    },
    {
      key: "landing",
      name: "Door landing — villa door",
      type: "paving",
      poly: LANDING,
      dims_derived: false,
      note: `${measured(`${M.door_landing_m[0].toFixed(2)} × ${M.door_landing_m[1].toFixed(2)} m`)}; at the villa door where the entrance area meets the path — position from photo WA0084, to verify`,
      drivers: ["dimension update"],
      because: `door landing measured ${M.door_landing_m[0].toFixed(2)} × ${M.door_landing_m[1].toFixed(2)} m (new element)`,
    },
    {
      ...draft("rear-lawn"),
      poly: refit
        ? REAR_LAWN
        : [[ENTRANCE_X0, 0.6], [SEPARATOR_X, 0.6], [SEPARATOR_X, 3.3], [PATH_X0, 3.3], [PATH_X0, LY0], [LX0, LY0], [LX0, 3.3], [ENTRANCE_X0, 3.3]],
      dims_derived: true,
      note: refit ? `runs the measured ${M.path_from_gate_m} m path at its designed 2.7 m depth — its length ${AGGREGATE_NOTE} (total grass ≈ ${M.total_grass_m2} m²); ${SOURCE_NOTE}` : `designed 2.7 m depth along the measured strip; ${SOURCE_NOTE}`,
      drivers: refit ? both : ["dimension update"],
      because: refit
        ? `strip shortened by the measured runs, then confined to the ${M.path_from_gate_m} m path by the grass aggregate (the entrance area is paved and planted)`
        : `strip shortened by the measured runs (entrance area ${M.entrance_area_width_m} m + path ${M.path_from_gate_m} m)`,
    },
    {
      ...draft("rear-bed"),
      poly: refit
        ? [[ENTRANCE_X0, 0], [SEPARATOR_X, 0], [SEPARATOR_X, 0.6], [PATH_X0, 0.6], [PATH_X0, ey], [ENTRANCE_X0, ey]]
        : rect(ENTRANCE_X0, 0, SEPARATOR_X, 0.6),
      dims_derived: true,
      note: refit ? `0.6 m along the rear wall as designed, deepening to the entrance paving in the entrance area; ${AGGREGATE_NOTE}; ${SOURCE_NOTE}` : `0.6 m along the rear wall as designed; ${SOURCE_NOTE}`,
      drivers: refit ? both : ["dimension update"],
      because: refit ? `starts at the entrance area (x ${ENTRANCE_X0} m); takes the entrance-area ground the aggregates leave unpaved and ungrassed` : `starts at the entrance area (x ${ENTRANCE_X0} m)`,
    },
    {
      ...draft("court"),
      dims_derived: true,
      note: `${measured(`separator wall → end-of-pathway wall ${M.separator_to_end_wall_m} m`)} — confirms the drafted extent; strip depth ${SOURCE_NOTE}`,
      drivers: [],
      because: `separator wall → end-of-pathway wall measured ${M.separator_to_end_wall_m} m — confirms the draft`,
    },
    { ...draft("pergola"), dims_derived: true, note: `design: 3.5 × 3.5 m louvred pergola in the gazebo's footprint; ${SOURCE_NOTE}`, drivers: [], because: "design (unchanged)" },
    { ...draft("side-deck"), dims_derived: true, note: SOURCE_NOTE, drivers: [], because: "designed split (unchanged)" },
    { ...draft("side-lawn"), dims_derived: true, note: SOURCE_NOTE, drivers: [], because: "designed split (unchanged)" },
    { ...draft("side-bed"), dims_derived: true, note: SOURCE_NOTE, drivers: [], because: "designed split (unchanged)" },
    {
      ...draft("front-lawn"),
      poly: patch,
      dims_derived: true,
      note: refit
        ? `lawn patch ${FRONT_PATCH_W} × ${FRONT_PATCH_D} m ${AGGREGATE_NOTE} (total grass ≈ ${M.total_grass_m2} m²); front garden depth 4.0 m assumed`
        : `fills the measured ${M.front_border_width_m} m border at the assumed 4.0 m depth; ${SOURCE_NOTE}`,
      drivers: refit ? both : ["dimension update"],
      because: refit ? `border widened to ${M.front_border_width_m} m, then the lawn cut to a patch so the grass total is ≈ ${M.total_grass_m2} m²` : `front border width measured ${M.front_border_width_m} m (assumed 2.2)`,
    },
    {
      ...draft("front-bed"),
      poly: refit
        ? [[0, 6.5], [fx1, 6.5], [fx1, 10.5], [patch[1]![0], 10.5], [patch[1]![0], patch[0]![1]], [patch[0]![0], patch[0]![1]], [patch[0]![0], 10.5], [0, 10.5]]
        : draft("front-bed").poly,
      dims_derived: true,
      note: refit
        ? `${measured(`front border width ${M.front_border_width_m} m`)}; depth 4.0 m assumed; the bed is the border less the lawn patch (${AGGREGATE_NOTE})`
        : `0.6 m bed along the border's outer edge as drafted; ${SOURCE_NOTE}`,
      drivers: refit ? ["aggregate refit"] : [],
      because: refit ? `the border less the lawn patch the grass aggregate allows` : "as drafted",
    },
  ];
}

/** The garage/drive context reshaped around the measured front border (derived — the drive is not measured). */
export const GARAGE_POLY: Pt[] = [[0, 4.3], [6.3, 4.3], [6.3, 10.5], [SESSION_MEASURES.front_border_width_m, 10.5], [SESSION_MEASURES.front_border_width_m, 6.5], [0, 6.5]];

/** The existing stepping path, its rear leg ending at the entrance area (the measured 12.2 m run from the gate). */
export const STEPPING_PATH: Pt[] = [[PATH_X0, 3.8], [21.75, 3.8], [21.75, 10.0]];

/** What stands beyond each Arabella boundary wall (by reference key) — the scene's surroundings. */
export const WALL_BEYOND: Record<string, "neighbour" | "street" | "open"> = {
  "wall-rear": "neighbour",
  "wall-corner": "street",
  "wall-front": "street",
  // The garage end of the rear strip is the entrance side: the villa's own drive and
  // front passage, not a neighbouring house (session comment 3).
  "wall-left": "open",
};

/** The pergola's four posts, as the scene has always placed them — now carried by the graph (L-301). */
export const PERGOLA_POSTS_MM: [number, number][] = [[0, 0], [3350, 0], [0, 3350], [3350, 3350]];

export interface ReconciliationRow {
  key: ZoneKey;
  name: string;
  type: string;
  aggregate: "grass" | "tiled" | null;
  old_extent: string | null;
  old_m2: number | null;
  measured_extent: string;
  measured_m2: number;
  new_extent: string;
  new_m2: number;
  drivers: Cause[];
  because: string;
  measured: boolean;
}

const extent = (poly: readonly Pt[]) => {
  const b = bbox(poly);
  const rectLike = Math.abs(polyArea(poly) - (b.x1 - b.x0) * (b.y1 - b.y0)) < 1e-6;
  return `${r2(b.x1 - b.x0).toFixed(2)} × ${r2(b.y1 - b.y0).toFixed(2)} m${rectLike ? "" : " (shaped)"}`;
};

type Totals = { old: number; measured: number; new: number };
export function reconciliation(): {
  rows: ReconciliationRow[];
  totals: { grass: Totals & { target: number }; tiled: Totals & { target: number }; planting: Totals };
  residual: typeof RESIDUAL;
} {
  const mid = sessionZones("measured");
  const zones = sessionZones("refit");
  const rows: ReconciliationRow[] = zones.map((z) => {
    const old = DRAFT_ZONES.find((d) => d.key === z.key) ?? null;
    const m = mid.find((x) => x.key === z.key)!;
    return {
      key: z.key,
      name: z.name,
      type: z.type,
      aggregate: aggregateOf(z.type),
      old_extent: old ? extent(old.poly) : null,
      old_m2: old ? r2(polyArea(old.poly)) : null,
      measured_extent: extent(m.poly),
      measured_m2: r2(polyArea(m.poly)),
      new_extent: extent(z.poly),
      new_m2: r2(polyArea(z.poly)),
      drivers: z.drivers,
      because: z.because,
      measured: !z.dims_derived,
    };
  });
  const sum = (list: { type: string; poly: Pt[] }[], agg: "grass" | "tiled" | "planting") =>
    r2(list.filter((z) => (agg === "planting" ? z.type === "planting_bed" : aggregateOf(z.type) === agg)).reduce((s, z) => s + polyArea(z.poly), 0));
  const tot = (agg: "grass" | "tiled" | "planting") => ({ old: sum(DRAFT_ZONES, agg), measured: sum(mid, agg), new: sum(zones, agg) });
  return {
    rows,
    totals: { grass: { ...tot("grass"), target: SESSION_MEASURES.total_grass_m2 }, tiled: { ...tot("tiled"), target: SESSION_MEASURES.total_tiled_m2 }, planting: tot("planting") },
    residual: RESIDUAL,
  };
}

// --- Into the site frame, normalised like the routes store it ----------------------------

const norm = (p: Pt): Pt => [Math.round((p[0] / PLOT.width_m) * 1e6) / 1e6, Math.round((p[1] / PLOT.width_m) * 1e6) / 1e6];
export const siteNormPath = (path: readonly Pt[]): Pt[] => toSitePath(path).map(norm);
export const siteNormPoint = (p: Pt): Pt => norm(toSite(p));

// --- The whole session plan, pure (tests build the scene without a database) -------------

/** The design's built runs, as the G5 seed placed them (type-plan frame). */
export const DESIGN_RUNS = [
  { key: "bbq", kind: "counter_run" as const, variant: "bbq" as const, polyline: [[23.45, 0.7], [26.45, 0.7]] as Pt[], height_mm: 900, width_mm: 900, zone: "pergola" as ZoneKey, spec: { name: "BBQ counter (under the pergola)", top_slab_mm: 100 } },
  { key: "bench", kind: "bench_run" as const, variant: null, polyline: [[20.9, 1.0], [20.9, 3.0], [22.9, 3.0]] as Pt[], height_mm: 450, width_mm: 500, zone: "court" as ZoneKey, spec: { name: "L-seating bench (pergola court)" } },
];

/** Designed points (type-plan frame): lighting as designed, drainage, taps. */
export const DESIGN_POINTS: { type: string; at: Pt; spec: Record<string, unknown> | null }[] = [
  ...([[5.5, 0.3], [11, 0.3], [17, 0.3], [26.4, 6], [26.4, 9], [0.3, 8.5]] as Pt[]).map((at) => ({ type: "garden_light", at, spec: { fitting: "spike", source: "as_designed" } })),
  ...([[3, 3.8], [8, 3.8], [13, 3.8], [18, 3.8], [22.4, 6.5], [22.4, 9.5]] as Pt[]).map((at) => ({ type: "garden_light", at, spec: { fitting: "inground", source: "as_designed" } })),
  ...([[5, 0.1], [10, 0.1], [15, 0.1], [26.6, 5.5], [26.6, 8.5], [24.9, 10.4]] as Pt[]).map((at) => ({ type: "boundary_light", at, spec: { fitting: "wall", source: "as_designed" } })),
  ...([[21.9, 3.9], [22.4, 8.0]] as Pt[]).map((at) => ({ type: "drainage_point", at, spec: null })),
  { type: "water_tap", at: [13.0, 4.2], spec: { name: "Outdoor water tap — rear strip", source: "as_designed" } },
  { type: "water_tap", at: [21.2, 7.0], spec: { name: "Outdoor water tap — side garden", source: "as_designed" } },
];

/** The pergola's design spec, with its four posts (G5d: the graph carries them — L-301 printed "Posts: 0"). */
export const PERGOLA_SPEC = {
  form: "louvred pergola",
  system: "Motorised louvred aluminium pergola",
  variant: "louvered",
  member_mm: 150,
  beam_depth_mm: 150,
  posts_mm: PERGOLA_POSTS_MM,
  posts_source: "four corner posts, 150 mm square, at the 3.5 × 3.5 m footprint's corners (design)",
};

/**
 * The client garden after the session, in the shape buildPlanGraph and the scene
 * take — every existing item decided as the draft pack proposed (Sheet B: nothing
 * overridden; the shed KEEP carried).
 */
export async function arabellaSessionPlanInput() {
  const ref = await import("./arabella-reference");
  const base = ref.arabellaPlanInput({
    "wall-rear": "keep", "wall-corner": "keep", "wall-front": "keep", "wall-left": "keep", "wall-separator": "keep",
    path: "replace", "sink-counter": "replace", "lights-corner": "replace", "lights-across": "replace", "planter-rear": "remove", "planter-side": "remove",
    "tree-1": "keep", "tree-2": "keep", palm: "keep", "tree-3": "keep", "tree-4": "keep", "tree-5": "keep", shed: "keep", gate: "keep", gazebo: "replace",
  });
  const zones = sessionZones();
  const inside = (p: Pt, poly: readonly Pt[]) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const zoneAt = (p: Pt) => zones.find((z) => inside(p, z.poly))?.key ?? null;
  return {
    ...base,
    rooms: zones.map((z) => ({
      id: `z-${z.key}`,
      name_en: z.name,
      name_ar: null,
      room_type: z.type,
      area_m2: Math.round(polyArea(z.poly) * 100) / 100,
      polygon: siteNormPath(z.poly),
      unroofed: true,
      derived_note: z.note,
      height_mm: z.key === "pergola" ? 2800 : null,
      spec: z.key === "pergola" ? PERGOLA_SPEC : null,
      dims_derived: z.dims_derived,
      site_reference: false,
      disposition: null,
    })),
    context: base.context.map((c) => {
      const key = c.id.replace(/^c-/, "");
      return {
        ...c,
        ...(key === "garage" ? { polygon: siteNormPath(GARAGE_POLY) } : {}),
        ...(WALL_BEYOND[key] ? { spec: { beyond: WALL_BEYOND[key] } } : {}),
      };
    }),
    elements: [
      ...base.elements.map((e) => (e.id === "r-path" ? { ...e, polyline: siteNormPath(STEPPING_PATH) } : e)),
      ...DESIGN_RUNS.map((r) => ({
        id: `r-${r.key}`, kind: r.kind, polyline: siteNormPath(r.polyline), height_mm: r.height_mm, width_mm: r.width_mm,
        source: "user_drawn", derived: true, spec: r.spec as Record<string, unknown>, dims_derived: true, derived_note: SOURCE_NOTE, site_reference: false, disposition: null,
      })),
    ],
    fixtures: [
      ...base.fixtures,
      ...DESIGN_POINTS.map((p, i) => ({ id: `p-${p.type}-${i}`, layer: p.type === "water_tap" || p.type === "drainage_point" ? "plumbing" : "garden", type: p.type, room_id: zoneAt(p.at) ? `z-${zoneAt(p.at)}` : null, position: siteNormPoint(p.at), spec: p.spec, site_reference: false, disposition: null, dims_derived: true })),
    ],
    variants: Object.fromEntries(DESIGN_RUNS.map((r) => [`r-${r.key}`, r.variant])),
  };
}
