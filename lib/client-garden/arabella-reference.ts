// =============================================================================
// lib/client-garden/arabella-reference.ts — the client garden on DERIVED
// reference dimensions (garden pilot G5, draft stage).
//
// Arabella 3, Type B, corner plot. No measured drawing exists yet: the plot, the
// house footprint and the garden strips below are calibrated off the developer's
// type plan (42 px/m, room dimensions cross-checked). Every boundary-dependent
// value is therefore flagged derived, with the note below, and the documents
// built from it are drafts until the plot is measured (Step 5 amends derived →
// measured through the same routes, and the change report is the diff).
//
// No client personal name appears here or anywhere this module reaches.
//
// Frame: metres, origin at the plot's rear-left corner, +x along the 26.7 m
// frontage, +y from the rear boundary toward the street (drawing convention,
// +y down). Along x: garage/drive block 6.3 + house 14.8 + side garden 5.6 =
// 26.7 (the stated ~6.4 m garage block absorbs the 0.1 m rounding). Along y: rear
// strip 4.3 + house 6.1 = 10.4 against a 10.5 m plot; the 0.1 m residual is left
// at the street boundary and stated rather than spread.
//
// Existing features come from the client photos
// (data/garden pilot/Client Garden Photos/), placed approximately and tagged
// site_reference with NO disposition: keep / remove / replace is the designer's
// call in the editor, and the pack refuses to export until every one is made.
// =============================================================================

export const PROJECT_NAME = "Arabella Garden — Draft for Review";

export const SOURCE_NOTE =
  "calibrated from developer type plan (42 px/m, room-dims cross-checked); corner plot — side garden likely wider; pending affection plan / site measurement";

const PHOTO_NOTE = "placed approximately from client site photos — position and size to verify on site";

export const PLOT = { width_m: 26.7, depth_m: 10.5 } as const;

type Pt = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const norm = (p: Pt): Pt => [round6(p[0] / PLOT.width_m), round6(p[1] / PLOT.width_m)];
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const area = (poly: Pt[]) => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length]!;
  return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

export const X = { garage: 6.3, sideGarden: 21.1, deckEdge: 23.2, plot: 26.7 } as const;
export const Y = { rearStrip: 4.3, houseFront: 10.4, gazebo: 3.5, plot: 10.5 } as const;

export interface RefZone {
  key: string;
  name: string;
  kind: string;
  polygon: Pt[];
  area_m2: number;
  site_reference?: boolean;
  height_mm?: number;
  spec?: Record<string, unknown>;
  derived_note: string;
}

export const ZONES: RefZone[] = [
  { key: "rear-lawn", name: "Rear garden strip — lawn", kind: "artificial_grass", polygon: rect(0, 0, X.sideGarden, Y.rearStrip), area_m2: 0, derived_note: SOURCE_NOTE },
  { key: "side-deck", name: "Side garden — deck strip", kind: "deck", polygon: rect(X.sideGarden, 0, X.deckEdge, Y.plot), area_m2: 0, derived_note: SOURCE_NOTE },
  { key: "side-lawn", name: "Side garden — lawn", kind: "artificial_grass", polygon: rect(X.deckEdge, Y.gazebo, X.plot, Y.plot), area_m2: 0, derived_note: SOURCE_NOTE },
  {
    key: "gazebo",
    name: "Gazebo (existing)",
    kind: "structure",
    polygon: rect(X.deckEdge, 0, X.plot, Y.gazebo),
    area_m2: 0,
    site_reference: true,
    height_mm: 2700,
    spec: {
      form: "gazebo",
      source: "site photos IMG-20260911-WA0073/0074/0075/0078 — hardtop gazebo with dark glazed panels on a dark tile pad",
      height_source: "assumed (typical hardtop gazebo), not measured",
    },
    derived_note: `${PHOTO_NOTE}; ${SOURCE_NOTE}`,
  },
].map((z) => ({ ...z, area_m2: Math.round(area(z.polygon) * 100) / 100 }));

export interface RefContext {
  key: string;
  kind: "existing_building" | "boundary_wall";
  name: string;
  polygon: Pt[];
  height_mm: number;
  note: string;
  site_reference?: boolean;
}

export const CONTEXT: RefContext[] = [
  { key: "villa", kind: "existing_building", name: "Existing villa", polygon: rect(X.garage, Y.rearStrip, X.sideGarden, Y.houseFront), height_mm: 7500, note: `footprint ~14.8 × 6.1 m per type plan; height assumed (two storeys), not dimensioned; 0.1 m residual to the street boundary left unallocated` },
  { key: "garage", kind: "existing_building", name: "Garage / drive block", polygon: rect(0, Y.rearStrip, X.garage, Y.plot), height_mm: 3200, note: "~6.4 m wide per type plan (6.3 m after rounding to the 26.7 m frontage); garage and open drive not separated; height assumed" },
  { key: "wall-rear", kind: "boundary_wall", name: "Rear boundary wall", polygon: rect(0, 0, X.plot, 0.2), height_mm: 2000, note: `${PHOTO_NOTE}; height scaled from photos`, site_reference: true },
  { key: "wall-corner", kind: "boundary_wall", name: "Corner boundary wall (side garden)", polygon: rect(X.plot - 0.2, 0.2, X.plot, Y.plot), height_mm: 2000, note: `${PHOTO_NOTE}; string lights fixed along it; height scaled from photos`, site_reference: true },
  { key: "wall-front", kind: "boundary_wall", name: "Side garden street wall", polygon: rect(X.sideGarden, Y.plot - 0.2, X.plot - 0.2, Y.plot), height_mm: 2000, note: `${PHOTO_NOTE}; garden entrance side`, site_reference: true },
  { key: "wall-left", kind: "boundary_wall", name: "Rear strip end wall", polygon: rect(0, 0.2, 0.2, Y.rearStrip), height_mm: 2000, note: `${PHOTO_NOTE}; height scaled from photos`, site_reference: true },
];

export interface RefRun {
  key: string;
  kind: "stepping_path" | "counter_run" | "planter_run" | "string_light_run";
  name: string;
  polyline: Pt[];
  height_mm: number;
  width_mm: number;
  spec: Record<string, unknown>;
}

export const RUNS: RefRun[] = [
  {
    key: "path",
    kind: "stepping_path",
    name: "Stepping-stone path (existing)",
    polyline: [[21.75, 10.0], [21.75, 3.8], [1.0, 3.8]],
    height_mm: 40,
    width_mm: 600,
    spec: { name: "Stepping-stone path (existing)", slab_mm: [1200, 500], gap_mm: 150, source: "photos WA0074/0075/0077/0079/0082 — concrete slabs set in lawn along the house" },
  },
  {
    key: "sink-counter",
    kind: "counter_run",
    name: "Outdoor sink counter (existing)",
    polyline: [[26.2, 4.4], [26.2, 6.8]],
    height_mm: 900,
    width_mm: 600,
    spec: { name: "Outdoor sink counter (existing)", form: "sink counter", source: "photos WA0073/0080/0083 — rendered counter with sink and louvred doors against the corner wall" },
  },
  {
    key: "planter-rear",
    kind: "planter_run",
    name: "Planter border with stone edging (existing) — rear",
    polyline: [[0.5, 0.5], [20.6, 0.5]],
    height_mm: 400,
    width_mm: 600,
    spec: { name: "Planter border with stone edging (existing) — rear", form: "planter border", source: "photos WA0079/0082 — slate-edged raised border under the trees along the rear wall" },
  },
  {
    key: "planter-side",
    kind: "planter_run",
    name: "Planter border with stone edging (existing) — side",
    polyline: [[26.2, 7.3], [26.2, 10.0]],
    height_mm: 400,
    width_mm: 600,
    spec: { name: "Planter border with stone edging (existing) — side", form: "planter border", source: "photos WA0078/0081 — slate-edged border along the boundary wall" },
  },
  {
    key: "lights-corner",
    kind: "string_light_run",
    name: "String lights (existing) — corner wall",
    polyline: [[26.5, 0.4], [26.5, 10.1]],
    height_mm: 2200,
    width_mm: 20,
    spec: { name: "String lights (existing) — corner wall", source: "photos WA0073/0074/0075/0080 — festoon lamps along the wall top" },
  },
  {
    key: "lights-across",
    kind: "string_light_run",
    name: "String lights (existing) — across side garden",
    polyline: [[21.2, 6.5], [26.5, 2.0]],
    height_mm: 2600,
    width_mm: 20,
    spec: { name: "String lights (existing) — across side garden", source: "photos WA0073/0075 — festoon catenary from the house to the gazebo corner" },
  },
];

export interface RefTree {
  key: string;
  name: string;
  position: Pt;
  spec: Record<string, unknown>;
}

const frangipani = (key: string, name: string, p: Pt): RefTree => ({ key, name, position: p, spec: { name, species: "frangipani", height_mm: 4000, canopy_mm: 3500, source: "photos WA0077/0079/0082" } });

export const TREES: RefTree[] = [
  frangipani("tree-1", "Frangipani (existing) — rear 1", [3.0, 0.8]),
  frangipani("tree-2", "Frangipani (existing) — rear 2", [8.5, 0.8]),
  { key: "palm", name: "Palm (existing) — rear lawn", position: [11.5, 2.0], spec: { name: "Palm (existing) — rear lawn", species: "palm", height_mm: 6000, canopy_mm: 3000, source: "photo WA0079 — palm in lawn with white pebble ring" } },
  frangipani("tree-3", "Frangipani (existing) — rear 3", [14.5, 0.8]),
  frangipani("tree-4", "Frangipani (existing) — rear 4", [19.0, 0.8]),
  frangipani("tree-5", "Frangipani (existing) — side garden", [22.2, 0.8]),
];

/**
 * Which client photo shows which zone, and what site-reference items are in
 * view — the manifest a before/after photo pair is checked against. Photos not
 * listed show the street frontage (outside the garden zones) and pair nothing.
 */
export const PHOTO_COVERAGE: { file: string; zone: string; shows: string[] }[] = [
  { file: "IMG-20260911-WA0079.jpg", zone: "rear-lawn", shows: ["path", "palm", "tree-3", "tree-4", "planter-rear"] },
  { file: "IMG-20260911-WA0082.jpg", zone: "rear-lawn", shows: ["path", "planter-rear", "tree-1", "tree-2"] },
  { file: "IMG-20260911-WA0080.jpg", zone: "side-lawn", shows: ["gazebo", "sink-counter", "lights-corner"] },
  { file: "IMG-20260911-WA0083.jpg", zone: "side-lawn", shows: ["gazebo", "sink-counter", "lights-across"] },
  { file: "IMG-20260911-WA0074.jpg", zone: "side-deck", shows: ["path", "gazebo", "lights-across"] },
  { file: "IMG-20260911-WA0075.jpg", zone: "side-deck", shows: ["path", "gazebo", "lights-across"] },
  { file: "IMG-20260911-WA0073.jpg", zone: "side-lawn", shows: ["gazebo", "sink-counter", "lights-across", "tree-5"] },
  { file: "IMG-20260911-WA0078.jpg", zone: "side-lawn", shows: ["gazebo", "planter-side"] },
  { file: "IMG-20260911-WA0077.jpg", zone: "rear-lawn", shows: ["path", "tree-1", "tree-2"] },
];

export const photoAssetFiles = (): string[] =>
  ["0073", "0074", "0075", "0076", "0077", "0078", "0079", "0080", "0081", "0082", "0083", "0084", "0085", "0086"].map((n) => `IMG-20260911-WA${n}.jpg`);

/** The records in normalised plan space, as the routes store them. */
export function arabellaReferenceRecords() {
  return {
    plot: PLOT,
    zones: ZONES.map((z) => ({ ...z, polygon: z.polygon.map(norm) })),
    context: CONTEXT.map((c) => ({ ...c, polygon: c.polygon.map(norm) })),
    runs: RUNS.map((r) => ({ ...r, polyline: r.polyline.map(norm) })),
    trees: TREES.map((t) => ({ ...t, position: norm(t.position) })),
  };
}

/** Plot area accounted for by zones + context footprints (walls excluded). */
export function referenceCoverage() {
  const zones = ZONES.reduce((s, z) => s + z.area_m2, 0);
  const buildings = CONTEXT.filter((c) => c.kind === "existing_building").reduce((s, c) => s + area(c.polygon), 0);
  return { plot_m2: PLOT.width_m * PLOT.depth_m, zones_m2: Math.round(zones * 100) / 100, buildings_m2: Math.round(buildings * 100) / 100 };
}

/**
 * The reference layout in the shape buildPlanGraph and the drawing/scene
 * builders take — for tests, which build the same garden without a database.
 * `dispositions` sets the designer's call per item key (default: undecided).
 */
export function arabellaPlanInput(dispositions: Record<string, "keep" | "remove" | "replace" | null> = {}) {
  const rec = arabellaReferenceRecords();
  const disp = (key: string) => dispositions[key] ?? null;
  return {
    plot: rec.plot,
    rooms: rec.zones.map((z) => ({
      id: `z-${z.key}`,
      name_en: z.name,
      name_ar: null,
      room_type: z.kind,
      area_m2: z.area_m2,
      polygon: z.polygon,
      unroofed: true,
      derived_note: z.derived_note,
      height_mm: z.height_mm ?? null,
      spec: z.spec ?? null,
      dims_derived: true,
      site_reference: z.site_reference === true,
      disposition: z.site_reference ? disp(z.key) : null,
    })),
    elements: rec.runs.map((r) => ({
      id: `r-${r.key}`,
      kind: r.kind,
      polyline: r.polyline,
      height_mm: r.height_mm,
      width_mm: r.width_mm,
      source: "user_drawn",
      derived: true,
      spec: r.spec,
      dims_derived: true,
      derived_note: SOURCE_NOTE,
      site_reference: true,
      disposition: disp(r.key),
    })),
    context: rec.context.map((c) => ({
      id: `c-${c.key}`,
      kind: c.kind,
      name: c.name,
      polygon: c.polygon,
      base_mm: 0,
      height_mm: c.height_mm,
      derived: true,
      note: c.note,
      dims_derived: true,
      site_reference: c.site_reference === true,
      disposition: c.site_reference ? disp(c.key) : null,
    })),
    fixtures: rec.trees.map((t) => ({
      id: `t-${t.key}`,
      layer: "landscape",
      type: "tree",
      room_id: null as string | null,
      position: t.position,
      spec: t.spec as Record<string, unknown> | null,
      site_reference: true,
      disposition: disp(t.key),
      dims_derived: true,
    })),
  };
}
