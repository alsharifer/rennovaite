// =============================================================================
// lib/drawings/garden-sheets.ts — garden drawing set (garden pilot G4).
//
// The KAME-pack structure, assembled from the PlanGraph like every other sheet:
//
//   L-100  Site plan           bird's-eye, every zone, dimension chains, zone
//                              schedule, levels legend
//   L-1nn  Zone sheets         one per zone: every straight edge dimensioned in
//                              mm, overall extents, what stands in it
//   L-401  Lighting overlay    points by fitting, indicative cable route
//   L-402  Irrigation overlay  irrigated zones and runs, indicative routing,
//                              drainage points — NO HVAC
//
// Differences from the interior engine (lib/drawings/plan-sheet.ts), each for a
// reason:
//   · SCALE IS CHOSEN, not fixed. A 26 m garden does not fit A3 at 1:100 and a
//     1.8 m planter box is unreadable at it. Each sheet picks the largest
//     standard scale that fits and prints it in the title block and scale bar.
//     The interior engine is untouched and still prints at 1:100.
//   · Every dimension carries `data-dim` / `data-mm` attributes, so a test can
//     check the printed figure against the graph to the millimetre instead of
//     trusting that it was drawn right.
//   · Anything not measured says so on the sheet: derived areas, lighting AS
//     DESIGNED, routes that are indicative. A drawing is the document most
//     likely to be taken as fact, so it is the last place to be vague.
//
// Deterministic SVG. No LLM, no DOM.
// =============================================================================

import { LINEAR_ELEMENT_META, type LinearElement } from "@/lib/plan/elements";
import type { ContextVolume, PlanGraph, Point, Room } from "@/lib/plan/geometry";
import { roomTypeLabel } from "@/lib/plan/zones";

import {
  BONE,
  BRASS,
  esc,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  INK_100,
  INK_500,
  INK_700,
  INK_900,
  PAPER,
  renderSheet,
  SHEET_H,
  SHEET_MARGIN,
  SHEET_W,
  TERRACOTTA,
  TITLE_H,
  TITLE_W,
  type SheetMeta,
} from "./sheet";

const r2 = (n: number) => Math.round(n * 100) / 100;
const f2 = (n: number) => n.toFixed(2);

// --- Inputs ------------------------------------------------------------------

export interface GardenFixture {
  id: string;
  layer: string;
  type: string;
  room_id: string | null;
  /** Normalised plan space, like rooms.polygon. */
  position: [number, number];
  spec?: Record<string, unknown> | null;
}

export interface GardenSheet {
  kind: "site_plan" | "zone_plan" | "lighting_overlay" | "irrigation_overlay";
  title: string;
  sheetNumber: string;
  zoneId?: string;
  svg: string;
}

/** The statement every lighting drawing carries (G4 rider: never "as surveyed"). */
export const LIGHTING_SOURCE_STATEMENT =
  "LIGHTING AS DESIGNED — NOT SURVEYED. Points are placed on the plan from the design; confirm positions on site.";

// --- Scale -------------------------------------------------------------------

/** Standard drawing scales, largest (most detailed) first. */
export const STANDARD_SCALES = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500] as const;

/** Paper mm per real metre at 1:denominator. */
export const mmPerMetre = (denominator: number) => 1000 / denominator;

/** The most detailed standard scale at which `wM × hM` metres fits `availW × availH` mm. */
export function fitScale(wM: number, hM: number, availW: number, availH: number): number {
  for (const d of STANDARD_SCALES) {
    const k = mmPerMetre(d);
    if (wM * k <= availW && hM * k <= availH) return d;
  }
  return STANDARD_SCALES[STANDARD_SCALES.length - 1]!;
}

/** A scale bar that is a sensible length at this scale (about 40–80 mm). */
function scaleBarFor(denominator: number): { mmPerM: number; cells: number; stepM: number } {
  const k = mmPerMetre(denominator);
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10];
  const stepM = steps.find((s) => s * k * 5 >= 40) ?? 10;
  return { mmPerM: k, cells: 5, stepM };
}

interface Frame {
  denom: number;
  k: number; // paper mm per metre
  px: (mx: number) => number;
  py: (my: number) => number;
}

/** Place a metric bbox centred in a paper rectangle at a chosen scale. */
function frameFor(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  area: { x: number; y: number; w: number; h: number },
  denom?: number,
): Frame {
  const wM = bbox.maxX - bbox.minX;
  const hM = bbox.maxY - bbox.minY;
  const d = denom ?? fitScale(wM, hM, area.w, area.h);
  const k = mmPerMetre(d);
  const ox = area.x + (area.w - wM * k) / 2 - bbox.minX * k;
  const oy = area.y + (area.h - hM * k) / 2 - bbox.minY * k;
  return { denom: d, k, px: (mx) => ox + mx * k, py: (my) => oy + my * k };
}

// --- Geometry helpers ----------------------------------------------------------

export function bboxOf(pts: readonly Point[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** A label point well inside a polygon — an L or a U's centroid can sit outside it. */
export function labelPoint(poly: readonly Point[]): Point {
  const b = bboxOf(poly);
  let best: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  let bestD = -1;
  const N = 24;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p: Point = [b.minX + ((b.maxX - b.minX) * i) / N, b.minY + ((b.maxY - b.minY) * j) / N];
      if (!pointInPolygon(p, poly)) continue;
      let d = Infinity;
      for (let e = 0; e < poly.length; e++) {
        d = Math.min(d, distToSegment(p, poly[e]!, poly[(e + 1) % poly.length]!));
      }
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/** Signed area (positive = clockwise in +y-down screen space). */
function signedArea(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export interface EdgeDimension {
  a: Point;
  b: Point;
  /** Rounded to whole millimetres — the printed figure. */
  mm: number;
  /** Outward unit normal, for placing the dimension line off the edge. */
  normal: Point;
}

/**
 * The straight edges of a zone worth dimensioning.
 *
 * A traced curve is stored as a run of short chords. Dimensioning each chord
 * would print a dozen meaningless figures along an edge nobody measured, so
 * short non-orthogonal edges are left out and the curve is annotated instead.
 */
export function edgeDimensions(poly: readonly Point[], minM = 0.05): EdgeDimension[] {
  const cw = signedArea(poly) > 0;
  const out: EdgeDimension[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < minM) continue;
    const orthogonal = Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6;
    if (!orthogonal && len < 0.8) continue; // a chord of a traced curve
    // Outward normal: for a clockwise ring in y-down space it is (dy, -dx).
    const nx = (cw ? dy : -dy) / len;
    const ny = (cw ? -dx : dx) / len;
    out.push({ a, b, mm: Math.round(len * 1000), normal: [nx, ny] });
  }
  return out;
}

/** True when a polygon contains a traced curve (runs of short oblique chords). */
export function hasCurve(poly: readonly Point[]): boolean {
  let run = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const oblique = Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6 && Math.hypot(dx, dy) < 0.8;
    run = oblique ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

/**
 * Minimum spanning tree over points (Prim). Deterministic: ties break on index.
 * Used for INDICATIVE cable and irrigation routes — the shortest network that
 * reaches every point, which is a sane first estimate of run length and never a
 * design.
 */
export function minimumSpanningTree(pts: readonly Point[]): { edges: [number, number][]; length_m: number } {
  const n = pts.length;
  if (n < 2) return { edges: [], length_m: 0 };
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Infinity);
  const from = new Array<number>(n).fill(-1);
  best[0] = 0;
  const edges: [number, number][] = [];
  let length = 0;
  for (let step = 0; step < n; step++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u === -1 || best[i]! < best[u]!)) u = i;
    inTree[u] = true;
    if (from[u]! >= 0) {
      edges.push([from[u]!, u]);
      length += best[u]!;
    }
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = Math.hypot(pts[u]![0] - pts[v]![0], pts[u]![1] - pts[v]![1]);
      if (d < best[v]!) {
        best[v] = d;
        from[v] = u;
      }
    }
  }
  return { edges, length_m: r2(length) };
}

/** Normalised plan point → graph metres. */
export function toMetres(graph: PlanGraph, p: [number, number]): Point {
  const u = graph.meta.unit_to_m || 1;
  const [ox, oy] = graph.meta.norm_origin;
  return [(p[0] - ox) * u, (p[1] - oy) * u];
}

// --- Styling -------------------------------------------------------------------

const ZONE_STYLE: Record<string, { fill: string; pattern: string; label: string }> = {
  paving: { fill: "#F4EFE6", pattern: "pat-paving", label: "Paving" },
  path: { fill: "#F4EFE6", pattern: "pat-paving", label: "Path" },
  artificial_grass: { fill: "#E4EBDD", pattern: "pat-grass", label: "Artificial grass" },
  planting_bed: { fill: "#E8E4D2", pattern: "pat-planting", label: "Planting" },
  deck: { fill: "#EFE3D0", pattern: "pat-deck", label: "Deck" },
  structure: { fill: "#E6E2EA", pattern: "pat-structure", label: "Structure" },
  pool: { fill: "#DDEAF0", pattern: "pat-water", label: "Pool" },
};
const zoneStyle = (type: string | null) => ZONE_STYLE[type ?? ""] ?? { fill: BONE, pattern: "", label: roomTypeLabel(type) };

const IRRIGATION_BLUE = "#2F6F9F";
const LIGHT_AMBER = "#B7791F";

function defs(): string {
  return `<defs>
    <pattern id="pat-paving" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="0.22" fill="${INK_500}"/></pattern>
    <pattern id="pat-grass" width="3.2" height="3.2" patternUnits="userSpaceOnUse"><path d="M1 2.2 L1.6 1.1 L2.2 2.2" fill="none" stroke="#5B7F4A" stroke-width="0.2"/></pattern>
    <pattern id="pat-planting" width="2.6" height="2.6" patternUnits="userSpaceOnUse"><path d="M0 2.6 L2.6 0" stroke="#7A6A3A" stroke-width="0.18"/></pattern>
    <pattern id="pat-deck" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M0 1 L2 1" stroke="#8A5A2B" stroke-width="0.15"/></pattern>
    <pattern id="pat-structure" width="2.4" height="2.4" patternUnits="userSpaceOnUse"><path d="M0 0 L2.4 2.4 M2.4 0 L0 2.4" stroke="#6B5B7A" stroke-width="0.14"/></pattern>
    <pattern id="pat-water" width="3" height="3" patternUnits="userSpaceOnUse"><path d="M0 1.5 Q0.75 0.9 1.5 1.5 T3 1.5" fill="none" stroke="#2F6F9F" stroke-width="0.16"/></pattern>
  </defs>`;
}

function polyPts(poly: readonly Point[], f: Frame): string {
  return poly.map(([x, y]) => `${f2(f.px(x))},${f2(f.py(y))}`).join(" ");
}

function zoneShape(room: Room, f: Frame, opts: { faint?: boolean; highlight?: string } = {}): string {
  const s = zoneStyle(room.type);
  const pts = polyPts(room.polygon, f);
  const fillOpacity = opts.faint ? 0.35 : 1;
  const strokeOpacity = opts.faint ? 0.35 : 1;
  const stroke = opts.highlight ?? INK_900;
  return (
    `<polygon points="${pts}" fill="${s.fill}" fill-opacity="${fillOpacity}" stroke="none"/>` +
    (s.pattern ? `<polygon points="${pts}" fill="url(#${s.pattern})" fill-opacity="${fillOpacity}" stroke="none"/>` : "") +
    `<polygon points="${pts}" fill="none" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${opts.highlight ? 0.55 : 0.3}" data-zone="${esc(room.id)}"/>`
  );
}

function wallsSvg(graph: PlanGraph, f: Frame): string {
  return graph.walls
    .map((w) => {
      const [a, b] = w.polyline;
      if (!a || !b) return "";
      const half = Math.max(0.25, ((w.thickness_mm / 1000) * f.k) / 2);
      const ax = f.px(a[0]), ay = f.py(a[1]), bx = f.px(b[0]), by = f.py(b[1]);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / len) * half;
      const ny = ((bx - ax) / len) * half;
      return `<polygon points="${f2(ax + nx)},${f2(ay + ny)} ${f2(bx + nx)},${f2(by + ny)} ${f2(bx - nx)},${f2(by - ny)} ${f2(ax - nx)},${f2(ay - ny)}" fill="${INK_700}" stroke="${INK_900}" stroke-width="0.2"/>`;
    })
    .join("");
}

function runSvg(el: LinearElement, f: Frame, withLabel = true): string {
  if (el.kind === "boundary_wall") return "";
  const meta = LINEAR_ELEMENT_META[el.kind];
  const w = Math.max(0.6, (el.width_mm / 1000) * f.k * 0.6);
  const pts = el.polyline.map(([x, y]) => `${f2(f.px(x))},${f2(f.py(y))}`).join(" ");
  const mid = el.polyline[Math.floor(el.polyline.length / 2)] ?? el.polyline[0]!;
  const label = withLabel
    ? `<text x="${f2(f.px(mid[0]) + 1.2)}" y="${f2(f.py(mid[1]) - 1.2)}" font-size="2.4" fill="${meta.color}" style="font-family:${FONT_MONO}" data-dim="run" data-mm="${Math.round(el.length_m * 1000)}">${meta.code} ${Math.round(el.length_m * 1000)}</text>`
    : "";
  return `<polyline points="${pts}" fill="none" stroke="${meta.color}" stroke-width="${f2(w)}" stroke-opacity="0.85" stroke-linecap="butt" stroke-linejoin="miter"/>${label}`;
}

const UNIT_META: Record<string, { code: string; label: string }> = {
  planter_box: { code: "PB", label: "Planter box" },
  wall_feature: { code: "WF", label: "Wall feature with bench" },
  bbq_grill: { code: "BQ", label: "Built-in BBQ grill" },
};

function unitSymbol(x: number, y: number, code: string, color = INK_900): string {
  return (
    `<rect x="${f2(x - 2.4)}" y="${f2(y - 1.7)}" width="4.8" height="3.4" rx="0.4" fill="${PAPER}" stroke="${color}" stroke-width="0.3"/>` +
    `<text x="${f2(x)}" y="${f2(y + 0.8)}" text-anchor="middle" font-size="2" fill="${color}" style="font-family:${FONT_UI};font-weight:600">${esc(code)}</text>`
  );
}

function ringSymbol(x: number, y: number, code: string, color: string, r = 1.9): string {
  return (
    `<circle cx="${f2(x)}" cy="${f2(y)}" r="${r}" fill="${PAPER}" stroke="${color}" stroke-width="0.32"/>` +
    `<text x="${f2(x)}" y="${f2(y + 0.7)}" text-anchor="middle" font-size="${code.length > 2 ? 1.5 : 1.85}" fill="${color}" style="font-family:${FONT_UI};font-weight:600">${esc(code)}</text>`
  );
}

// --- Levels (G4b) -----------------------------------------------------------------

/** "±000", "+150", "+2800", "-150" — the KAME level convention. */
export function fmtLevel(mm: number): string {
  const r = Math.round(mm);
  if (r === 0) return "±000";
  const s = String(Math.abs(r)).padStart(3, "0");
  return `${r > 0 ? "+" : "-"}${s}`;
}

/** The zone a point stands in (structure zones last, so the paving under a pergola wins). */
export function zoneAtPoint(graph: PlanGraph, p: Point): Room | null {
  const zones = gardenZones(graph);
  return zones.find((z) => z.type !== "structure" && pointInPolygon(p, z.polygon)) ?? zones.find((z) => pointInPolygon(p, z.polygon)) ?? null;
}

/** Level (mm) under a point and the data-src term that states it. */
export function levelUnder(graph: PlanGraph, p: Point): { mm: number; src: string; stated: boolean } {
  const z = zoneAtPoint(graph, p);
  if (z && z.level_mm != null) return { mm: z.level_mm, src: `room:${z.id}:level_mm`, stated: true };
  return { mm: 0, src: "k:0", stated: false };
}

/** Distinct stated levels on the plan: zones and step treads. */
function statedLevels(graph: PlanGraph): number[] {
  const set = new Set<number>();
  for (const r of graph.rooms) if (r.unroofed && r.level_mm != null) set.add(Math.round(r.level_mm));
  for (const c of graph.context) if (c.kind === "steps" && c.height_mm != null) set.add(Math.round(c.base_mm + c.height_mm));
  return [...set].sort((a, b) => a - b);
}

/** A plan level tag: quartered datum symbol + "+300 FFL". */
function planLevelTag(x: number, y: number, mm: number, code: string, src: string, color = INK_900): string {
  const r = 0.9;
  return (
    `<circle cx="${f2(x)}" cy="${f2(y)}" r="${r}" fill="${PAPER}" stroke="${color}" stroke-width="0.2"/>` +
    `<path d="M${f2(x)},${f2(y)} L${f2(x + r)},${f2(y)} A${r},${r} 0 0 0 ${f2(x)},${f2(y - r)} Z M${f2(x)},${f2(y)} L${f2(x - r)},${f2(y)} A${r},${r} 0 0 0 ${f2(x)},${f2(y + r)} Z" fill="${color}"/>` +
    `<text x="${f2(x + 1.4)}" y="${f2(y + 0.7)}" font-size="1.9" fill="${color}" style="font-family:${FONT_MONO}" data-level="${Math.round(mm)}" data-src="${esc(src)}">${fmtLevel(mm)} ${code}</text>`
  );
}

/** Existing context on a plan: buildings, boundary walls, steps, existing structures. */
function contextSvg(graph: PlanGraph, f: Frame, withLabels: boolean): string {
  let s = "";
  const order: Record<ContextVolume["kind"], number> = { existing_building: 0, boundary_wall: 1, steps: 2, existing_structure: 3 };
  for (const c of [...graph.context].sort((a, b) => order[a.kind] - order[b.kind])) {
    const pts = polyPts(c.polygon, f);
    if (c.kind === "existing_building") {
      s += `<polygon points="${pts}" fill="#E4E4E4" stroke="${INK_500}" stroke-width="0.35" data-context="${esc(c.id)}"/>`;
      if (withLabels) {
        const p = labelPoint(c.polygon);
        s += `<text x="${f2(f.px(p[0]))}" y="${f2(f.py(p[1]))}" text-anchor="middle" font-size="2.6" fill="${INK_500}" style="font-family:${FONT_UI};letter-spacing:0.04em">${esc(c.name.toUpperCase())}</text>`;
      }
    } else if (c.kind === "boundary_wall") {
      s += `<polygon points="${pts}" fill="${INK_700}" stroke="${INK_900}" stroke-width="0.15" data-context="${esc(c.id)}"/>`;
    } else if (c.kind === "steps") {
      s += `<polygon points="${pts}" fill="${PAPER}" stroke="${INK_500}" stroke-width="0.25" data-context="${esc(c.id)}"/>`;
    } else {
      s += `<polygon points="${pts}" fill="none" stroke="${INK_500}" stroke-width="0.3" stroke-dasharray="1.2 0.8" data-context="${esc(c.id)}"/>`;
      if (withLabels) {
        const p = labelPoint(c.polygon);
        s += `<text x="${f2(f.px(p[0]))}" y="${f2(f.py(p[1]))}" text-anchor="middle" font-size="2" fill="${INK_500}" style="font-family:${FONT_UI}">${esc(c.name)}</text>`;
      }
    }
  }
  return s;
}

/** Tags for step treads (only the top tread of each footprint is readable, so all are tagged). */
function stepLevelTags(graph: PlanGraph, f: Frame): string {
  return graph.context
    .filter((c) => c.kind === "steps" && c.height_mm != null)
    .map((c) => {
      const b = bboxOf(c.polygon);
      return planLevelTag(f.px(b.maxX) + 0.8, f.py((b.minY + b.maxY) / 2), c.base_mm + c.height_mm!, "FFL", `ctx:${c.id}:height_mm`, INK_700);
    })
    .join("");
}

/** Top-of-structure tags for runs, units and structure zones inside a predicate. */
function structureTopTags(graph: PlanGraph, fixtures: readonly GardenFixture[], f: Frame, include: (p: Point) => boolean): string {
  let s = "";
  for (const z of gardenZones(graph).filter((r) => r.type === "structure" && r.height_mm != null)) {
    const b = bboxOf(z.polygon);
    const p: Point = [(b.minX + b.maxX) / 2, b.minY];
    if (!include(p)) continue;
    s += planLevelTag(f.px(b.minX) + 1.5, f.py(b.minY) + 2.4, (z.level_mm ?? 0) + z.height_mm!, "TRL", `room:${z.id}:level_mm + room:${z.id}:height_mm`, BRASS);
  }
  const code: Record<string, string> = { counter_run: "CTL", bench_run: "TOS", planter_run: "TOC" };
  for (const el of graph.elements.filter((e) => e.kind !== "boundary_wall")) {
    const a = el.polyline[0]!;
    const b = el.polyline[1] ?? a;
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!include(mid)) continue;
    const lv = levelUnder(graph, mid);
    const vertical = Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1]);
    const dy = el.kind === "planter_run" ? -2.2 : 2.6;
    s += planLevelTag(f.px(mid[0]) + (vertical ? 1.6 : -4), f.py(mid[1]) + (vertical ? (el.kind === "planter_run" ? -6 : 6) : dy), lv.mm + el.height_mm, code[el.kind] ?? "TOC", `${lv.src} + el:${el.id}:height_mm`, LINEAR_ELEMENT_META[el.kind].color);
  }
  for (const u of fixtures.filter((x) => x.layer === "landscape" && typeof x.spec?.height_mm === "number")) {
    const m = toMetres(graph, u.position);
    if (!include(m)) continue;
    const lv = levelUnder(graph, m);
    s += planLevelTag(f.px(m[0]) + 3, f.py(m[1]) + 3.4, lv.mm + (u.spec!.height_mm as number), "TOC", `${lv.src} + unit:${u.id}:spec.height_mm`);
  }
  return s;
}

// --- Dimensions ------------------------------------------------------------------

const TICK = 1.1;

/** One aligned dimension, offset `off` mm off the edge along its outward normal. */
function alignedDim(d: EdgeDimension, f: Frame, off: number, kind: string): string {
  const ax = f.px(d.a[0]) + d.normal[0] * off;
  const ay = f.py(d.a[1]) + d.normal[1] * off;
  const bx = f.px(d.b[0]) + d.normal[0] * off;
  const by = f.py(d.b[1]) + d.normal[1] * off;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const tx = mx + d.normal[0] * 1.4;
  const ty = my + d.normal[1] * 1.4;
  const tick = (x: number, y: number) =>
    `<line x1="${f2(x - d.normal[1] * TICK * 0.7 - d.normal[0] * TICK * 0.7)}" y1="${f2(y + d.normal[0] * TICK * 0.7 - d.normal[1] * TICK * 0.7)}" x2="${f2(x + d.normal[1] * TICK * 0.7 + d.normal[0] * TICK * 0.7)}" y2="${f2(y - d.normal[0] * TICK * 0.7 + d.normal[1] * TICK * 0.7)}" stroke="${INK_500}" stroke-width="0.25"/>`;
  const ext = (px: number, py: number, qx: number, qy: number) =>
    `<line x1="${f2(px)}" y1="${f2(py)}" x2="${f2(qx)}" y2="${f2(qy)}" stroke="${INK_100}" stroke-width="0.18"/>`;
  return (
    ext(f.px(d.a[0]), f.py(d.a[1]), ax, ay) +
    ext(f.px(d.b[0]), f.py(d.b[1]), bx, by) +
    `<line x1="${f2(ax)}" y1="${f2(ay)}" x2="${f2(bx)}" y2="${f2(by)}" stroke="${INK_500}" stroke-width="0.25"/>` +
    tick(ax, ay) +
    tick(bx, by) +
    `<text x="${f2(tx)}" y="${f2(ty)}" text-anchor="middle" dominant-baseline="middle" font-size="2.3" fill="${INK_700}" style="font-family:${FONT_MONO}" transform="rotate(${f2(angle)} ${f2(tx)} ${f2(ty)})" data-dim="${kind}" data-mm="${d.mm}" data-ax="${d.a[0]}" data-ay="${d.a[1]}" data-bx="${d.b[0]}" data-by="${d.b[1]}">${d.mm}</text>`
  );
}

/** Horizontal/vertical extent dimension across a bbox. */
function extentDims(
  b: { minX: number; minY: number; maxX: number; maxY: number },
  f: Frame,
  off: number,
  kind: string,
): string {
  const w: EdgeDimension = {
    a: [b.minX, b.minY],
    b: [b.maxX, b.minY],
    mm: Math.round((b.maxX - b.minX) * 1000),
    normal: [0, -1],
  };
  const h: EdgeDimension = {
    a: [b.minX, b.minY],
    b: [b.minX, b.maxY],
    mm: Math.round((b.maxY - b.minY) * 1000),
    normal: [-1, 0],
  };
  return alignedDim(w, f, off, `${kind}-width`) + alignedDim(h, f, off, `${kind}-depth`);
}

// --- Side panel ------------------------------------------------------------------

const PANEL_W = 118;
function panelX(): number {
  return SHEET_W - SHEET_MARGIN - PANEL_W;
}
/** Paper area for the drawing itself, left of the side panel. */
function drawingArea(): { x: number; y: number; w: number; h: number } {
  return {
    x: SHEET_MARGIN + 14,
    y: SHEET_MARGIN + 16,
    w: panelX() - SHEET_MARGIN - 14 - 20,
    h: SHEET_H - 2 * SHEET_MARGIN - 16 - 22,
  };
}

function panelHeading(y: number, text: string): string {
  return `<text x="${panelX()}" y="${f2(y)}" font-size="3" fill="${INK_900}" style="font-family:${FONT_UI};font-weight:600;letter-spacing:0.05em">${esc(text.toUpperCase())}</text><line x1="${panelX()}" y1="${f2(y + 1.4)}" x2="${panelX() + PANEL_W}" y2="${f2(y + 1.4)}" stroke="${BONE}" stroke-width="0.35"/>`;
}

/** Wrap text to a width in characters (monospace-agnostic approximation). */
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function panelText(y: number, text: string, opts: { size?: number; color?: string; maxChars?: number; mono?: boolean } = {}): { svg: string; y: number } {
  const size = opts.size ?? 2.5;
  const lines = wrap(text, opts.maxChars ?? 78);
  const svg = lines
    .map(
      (l, i) =>
        `<text x="${panelX()}" y="${f2(y + i * size * 1.35)}" font-size="${size}" fill="${opts.color ?? INK_700}" style="font-family:${opts.mono ? FONT_MONO : FONT_UI}">${esc(l)}</text>`,
    )
    .join("");
  return { svg, y: y + lines.length * size * 1.35 };
}

/** The levels legend — what the plan states, and what it does not. */
function levelsLegend(y: number, graph?: PlanGraph): { svg: string; y: number } {
  let svg = panelHeading(y, "Levels");
  let cy = y + 5;
  for (const [code, label] of [
    ["FFL", "Finished floor level"],
    ["GL", "Ground level"],
    ["TS", "Top of soil"],
  ]) {
    svg += `<text x="${panelX()}" y="${f2(cy)}" font-size="2.5" fill="${INK_900}" style="font-family:${FONT_MONO}">${code}</text><text x="${panelX() + 12}" y="${f2(cy)}" font-size="2.5" fill="${INK_700}" style="font-family:${FONT_UI}">${label}</text>`;
    cy += 3.6;
  }
  const levels = graph ? statedLevels(graph) : [];
  if (levels.length === 0) {
    const t = panelText(cy, "No levels are carried by this plan. Confirm FFL / GL / TS on site before setting out falls or steps.", { size: 2.3, color: TERRACOTTA });
    return { svg: svg + t.svg, y: t.y + 2 };
  }
  const t1 = panelText(cy, `Datum ±000 FFL. Levels stated on the plan: ${levels.map(fmtLevel).join(", ")}. Structure tops tagged TRL / CTL / TOS / TOC.`, { size: 2.3 });
  svg += t1.svg;
  const unstated = graph!.rooms.filter((r) => r.unroofed && r.level_mm == null);
  if (unstated.length === 0) return { svg, y: t1.y + 2 };
  const t2 = panelText(t1.y + 0.8, `No level stated for: ${unstated.map((r) => r.name_en).join(", ")} (top of soil). Confirm on site.`, { size: 2.3, color: TERRACOTTA });
  return { svg: svg + t2.svg, y: t2.y + 2 };
}

function zoneRef(i: number): string {
  return `Z${String(i + 1).padStart(2, "0")}`;
}

function sheetMetaAt(meta: SheetMeta, denom: number): SheetMeta {
  return { ...meta, scale: `1:${denom}`, level: "Ground (external works)" };
}

// --- L-100 Site plan -------------------------------------------------------------

function siteBbox(graph: PlanGraph) {
  const pts: Point[] = graph.rooms.flatMap((r) => r.polygon);
  const plot = graph.meta.plot;
  if (plot) {
    const [ox, oy] = plot.origin_m;
    pts.push([ox, oy], [ox + plot.width_m, oy + plot.depth_m]);
  }
  for (const w of graph.walls) pts.push(...w.polyline);
  return bboxOf(pts);
}

export function renderSitePlan(
  graph: PlanGraph,
  fixtures: readonly GardenFixture[],
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  const b = siteBbox(graph);
  const area = drawingArea();
  const f = frameFor(b, area);
  const zones = gardenZones(graph);

  let body = defs();
  body += contextSvg(graph, f, true);
  body += graph.rooms.map((r) => zoneShape(r, f)).join("");
  body += wallsSvg(graph, f);

  // Plot outline + overall site extents.
  const plot = graph.meta.plot;
  if (plot) {
    const [ox, oy] = plot.origin_m;
    body += `<rect x="${f2(f.px(ox))}" y="${f2(f.py(oy))}" width="${f2(plot.width_m * f.k)}" height="${f2(plot.depth_m * f.k)}" fill="none" stroke="${INK_900}" stroke-width="0.35" stroke-dasharray="2 1.2"/>`;
    body += extentDims({ minX: ox, minY: oy, maxX: ox + plot.width_m, maxY: oy + plot.depth_m }, f, 9, "plot");
  }

  body += graph.elements.map((el) => runSvg(el, f)).join("");
  for (const u of fixtures.filter((x) => x.layer === "landscape")) {
    const m = toMetres(graph, u.position);
    body += unitSymbol(f.px(m[0]), f.py(m[1]), UNIT_META[u.type]?.code ?? "?");
  }

  // Zone tags, with the zone's level where the plan has more than one.
  const levelsDiffer = statedLevels(graph).length > 1;
  zones.forEach((r, i) => {
    const p = labelPoint(r.polygon);
    const x = f.px(p[0]);
    const y = f.py(p[1]);
    body += `<circle cx="${f2(x)}" cy="${f2(y)}" r="2.3" fill="${PAPER}" stroke="${BRASS}" stroke-width="0.35"/><text x="${f2(x)}" y="${f2(y + 0.8)}" text-anchor="middle" font-size="2" fill="${BRASS}" style="font-family:${FONT_MONO};font-weight:600">${zoneRef(i)}</text>`;
    if (levelsDiffer && r.level_mm != null) body += planLevelTag(x - 3.5, y + 4.4, r.level_mm, "FFL", `room:${r.id}:level_mm`);
  });
  if (levelsDiffer) body += stepLevelTags(graph, f);
  body += structureTopTags(graph, fixtures, f, () => true);

  // Side panel: zone schedule, legend, levels, notes.
  let y = SHEET_MARGIN + 8;
  body += panelHeading(y, "Zone schedule");
  y += 5.5;
  body += `<text x="${panelX()}" y="${f2(y)}" font-size="2.2" fill="${INK_500}" style="font-family:${FONT_UI}">REF</text><text x="${panelX() + 10}" y="${f2(y)}" font-size="2.2" fill="${INK_500}" style="font-family:${FONT_UI}">ZONE</text><text x="${panelX() + 70}" y="${f2(y)}" font-size="2.2" fill="${INK_500}" style="font-family:${FONT_UI}">TYPE</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.2" fill="${INK_500}" style="font-family:${FONT_UI}">AREA m²</text>`;
  y += 3.8;
  zones.forEach((r, i) => {
    const flag = r.area_derived_m2 ? "*" : "";
    body += `<text x="${panelX()}" y="${f2(y)}" font-size="2.4" fill="${BRASS}" style="font-family:${FONT_MONO}">${zoneRef(i)}</text><text x="${panelX() + 10}" y="${f2(y)}" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_UI}">${esc(r.name_en.slice(0, 32))}</text><text x="${panelX() + 70}" y="${f2(y)}" font-size="2.4" fill="${INK_700}" style="font-family:${FONT_UI}">${esc(zoneStyle(r.type).label)}</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_MONO}" data-area="${r.area_m2}">${r.area_m2.toFixed(2)}${flag}</text>`;
    y += 3.5;
  });
  const total = r2(zones.reduce((s, r) => s + r.area_m2, 0));
  body += `<text x="${panelX() + 10}" y="${f2(y + 0.6)}" font-size="2.4" fill="${INK_500}" style="font-family:${FONT_UI};font-weight:600">Total drawn zones</text><text x="${panelX() + PANEL_W}" y="${f2(y + 0.6)}" text-anchor="end" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_MONO};font-weight:700">${total.toFixed(2)}</text>`;
  y += 7;

  body += panelHeading(y, "Legend");
  y += 5;
  const kinds = [...new Set(zones.map((r) => r.type ?? ""))];
  for (const kind of kinds) {
    const s = zoneStyle(kind);
    body += `<rect x="${panelX()}" y="${f2(y - 2.4)}" width="6" height="3.2" fill="${s.fill}" stroke="${INK_500}" stroke-width="0.2"/>${s.pattern ? `<rect x="${panelX()}" y="${f2(y - 2.4)}" width="6" height="3.2" fill="url(#${s.pattern})"/>` : ""}<text x="${panelX() + 9}" y="${f2(y)}" font-size="2.4" fill="${INK_700}" style="font-family:${FONT_UI}">${esc(s.label)}</text>`;
    y += 4;
  }
  for (const el of uniqueRunKinds(graph)) {
    const m = LINEAR_ELEMENT_META[el];
    body += `<line x1="${panelX()}" y1="${f2(y - 0.9)}" x2="${panelX() + 6}" y2="${f2(y - 0.9)}" stroke="${m.color}" stroke-width="1"/><text x="${panelX() + 9}" y="${f2(y)}" font-size="2.4" fill="${INK_700}" style="font-family:${FONT_UI}">${m.code} — ${esc(m.label)} (length mm)</text>`;
    y += 4;
  }
  body += `<text x="${panelX()}" y="${f2(y)}" font-size="2.4" fill="${INK_700}" style="font-family:${FONT_UI}">All dimensions in millimetres. Plot boundary dashed.</text>`;
  y += 6;

  const lv = levelsLegend(y, graph);
  body += lv.svg;
  y = lv.y + 2;

  const derived = zones.filter((r) => r.area_derived_m2 && r.derived_note);
  if (derived.length > 0) {
    body += panelHeading(y, "Derived areas (*)");
    y += 5;
    for (const r of derived) {
      const t = panelText(y, `${r.name_en}: ${r.derived_note}`, { size: 2.2, color: INK_700 });
      body += t.svg;
      y = t.y + 1.5;
    }
  }

  return renderSheet({
    meta: sheetMetaAt(meta, f.denom),
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    body,
    showNorthScale: true,
    northDeg: graph.meta.north_deg,
    scaleBar: scaleBarFor(f.denom),
  });
}

function uniqueRunKinds(graph: PlanGraph): LinearElement["kind"][] {
  return [...new Set(graph.elements.filter((e) => e.kind !== "boundary_wall").map((e) => e.kind))];
}

/** Zones in schedule order: outdoor rooms, by position (north to south, west to east). */
export function gardenZones(graph: PlanGraph): Room[] {
  return graph.rooms
    .filter((r) => r.unroofed)
    .slice()
    .sort((a, b) => {
      const pa = bboxOf(a.polygon);
      const pb = bboxOf(b.polygon);
      return Math.round(pa.minY * 10) - Math.round(pb.minY * 10) || pa.minX - pb.minX;
    });
}

// --- L-1nn Zone sheets -----------------------------------------------------------

const ZONE_SURFACE_SPEC: Record<string, string> = {
  paving: "Porcelain paving 1200×600 R11 on PCC base, laid to falls",
  path: "Paved path on PCC base",
  artificial_grass: "Artificial grass 32 mm on compacted base, sand infill, PCC border",
  planting_bed: "Planting bed — topsoil, edging and irrigation",
  deck: "Timber / composite decking",
  structure: "Motorized louvred aluminium pergola on base slab",
  pool: "Pool — out of scope",
};

export function renderZoneSheet(
  graph: PlanGraph,
  zone: Room,
  ref: string,
  fixtures: readonly GardenFixture[],
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  const zb = bboxOf(zone.polygon);
  // Room for dimensions round the zone.
  const pad = 0.12 * Math.max(zb.maxX - zb.minX, zb.maxY - zb.minY) + 0.3;
  const view = { minX: zb.minX - pad, minY: zb.minY - pad, maxX: zb.maxX + pad, maxY: zb.maxY + pad };
  const area = drawingArea();
  const inner = { x: area.x + 12, y: area.y + 12, w: area.w - 24, h: area.h - 24 };
  const f = frameFor(view, inner);

  let body = defs();
  const clipId = `clip-${zone.id.replace(/[^a-z0-9]/gi, "")}`;
  body += `<clipPath id="${clipId}"><rect x="${f2(area.x)}" y="${f2(area.y)}" width="${f2(area.w)}" height="${f2(area.h)}"/></clipPath>`;
  body += `<g clip-path="url(#${clipId})">`;
  body += contextSvg(graph, f, false);
  body += graph.rooms.filter((r) => r.id !== zone.id).map((r) => zoneShape(r, f, { faint: true })).join("");
  body += zoneShape(zone, f, { highlight: BRASS });
  body += wallsSvg(graph, f);

  // What stands in this zone.
  const inZone = (m: Point) =>
    m[0] >= zb.minX - 0.05 && m[0] <= zb.maxX + 0.05 && m[1] >= zb.minY - 0.05 && m[1] <= zb.maxY + 0.05 && pointInPolygon(m, zone.polygon);
  const runs = graph.elements.filter((el) => el.kind !== "boundary_wall" && el.polyline.some((p) => inZone(p)));
  body += runs.map((el) => runSvg(el, f)).join("");
  const units = fixtures.filter((u) => u.layer === "landscape" && inZone(toMetres(graph, u.position)));
  for (const u of units) {
    const m = toMetres(graph, u.position);
    body += unitSymbol(f.px(m[0]), f.py(m[1]), UNIT_META[u.type]?.code ?? "?");
  }
  const lights = fixtures.filter((p) => (p.type === "garden_light" || p.type === "boundary_light") && (p.room_id === zone.id || inZone(toMetres(graph, p.position))));
  for (const p of lights) {
    const m = toMetres(graph, p.position);
    body += ringSymbol(f.px(m[0]), f.py(m[1]), p.type === "boundary_light" ? "BL" : "GL", LIGHT_AMBER, 1.5);
  }
  body += structureTopTags(graph, fixtures, f, inZone);
  body += `</g>`;

  // Every straight edge, then the overall extents one step further out.
  const dims = edgeDimensions(zone.polygon);
  body += dims.map((d) => alignedDim(d, f, 5, "edge")).join("");
  body += extentDims(zb, f, 13, "overall");

  const p = labelPoint(zone.polygon);
  body += `<text x="${f2(f.px(p[0]))}" y="${f2(f.py(p[1]) - 1)}" text-anchor="middle" font-size="3.4" fill="${INK_900}" style="font-family:${FONT_DISPLAY}">${esc(zone.name_en)}</text><text x="${f2(f.px(p[0]))}" y="${f2(f.py(p[1]) + 3)}" text-anchor="middle" font-size="2.6" fill="${INK_700}" style="font-family:${FONT_MONO}">${zone.area_m2.toFixed(2)} m²${zone.area_derived_m2 ? " *" : ""}</text>`;
  if (zone.level_mm != null && statedLevels(graph).length > 1) {
    body += planLevelTag(f.px(p[0]) - 5, f.py(p[1]) + 7, zone.level_mm, "FFL", `room:${zone.id}:level_mm`);
  }

  // Side panel.
  let y = SHEET_MARGIN + 8;
  body += `<text x="${panelX()}" y="${f2(y + 2)}" font-size="7" fill="${BRASS}" style="font-family:${FONT_MONO}">${esc(ref)}</text><text x="${panelX() + 18}" y="${f2(y + 2)}" font-size="5" fill="${INK_900}" style="font-family:${FONT_DISPLAY}">${esc(zone.name_en)}</text>`;
  y += 10;
  const perimeter = r2(zone.polygon.reduce((s, a, i) => {
    const b = zone.polygon[(i + 1) % zone.polygon.length]!;
    return s + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }, 0));
  const facts: [string, string][] = [
    ["Type", zoneStyle(zone.type).label],
    ["Surface", ZONE_SURFACE_SPEC[zone.type ?? ""] ?? roomTypeLabel(zone.type)],
    ["Area", `${zone.area_m2.toFixed(2)} m²${zone.area_derived_m2 ? " (see derived note)" : ""}`],
    ["Perimeter", `${perimeter.toFixed(2)} m`],
    ["Extents", `${Math.round((zb.maxX - zb.minX) * 1000)} × ${Math.round((zb.maxY - zb.minY) * 1000)} mm`],
    ["Open to sky", zone.unroofed ? "Yes — no wall or ceiling finish" : "No"],
    ["Level", zone.level_mm != null ? `${fmtLevel(zone.level_mm)} FFL` : "Not stated on the plan"],
  ];
  body += panelHeading(y, "Zone");
  y += 5;
  for (const [k, v] of facts) {
    body += `<text x="${panelX()}" y="${f2(y)}" font-size="2.4" fill="${INK_500}" style="font-family:${FONT_UI}">${esc(k)}</text>`;
    const t = panelText(y, v, { size: 2.4, color: INK_900, maxChars: 58 });
    body += t.svg.replaceAll(`x="${panelX()}"`, `x="${panelX() + 24}"`);
    y = Math.max(y + 3.6, t.y + 0.4);
  }
  y += 3;

  if (runs.length + units.length + lights.length > 0) {
    body += panelHeading(y, "In this zone");
    y += 5;
    for (const el of runs) {
      const m = LINEAR_ELEMENT_META[el.kind];
      body += `<text x="${panelX()}" y="${f2(y)}" font-size="2.4" fill="${m.color}" style="font-family:${FONT_MONO}">${m.code}</text><text x="${panelX() + 10}" y="${f2(y)}" font-size="2.4" fill="${INK_700}" style="font-family:${FONT_UI}">${esc(m.label)}</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_MONO}">${Math.round(el.length_m * 1000)} mm</text>`;
      y += 3.6;
    }
    for (const u of units) {
      const m = UNIT_META[u.type];
      body += `<text x="${panelX()}" y="${f2(y)}" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_MONO}">${m?.code ?? "?"}</text><text x="${panelX() + 10}" y="${f2(y)}" font-size="2.4" fill="${INK_700}" style="font-family:${FONT_UI}">${esc(m?.label ?? u.type)}</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_MONO}">1 no</text>`;
      y += 3.6;
    }
    if (lights.length > 0) {
      body += `<text x="${panelX()}" y="${f2(y)}" font-size="2.4" fill="${LIGHT_AMBER}" style="font-family:${FONT_MONO}">GL</text><text x="${panelX() + 10}" y="${f2(y)}" font-size="2.4" fill="${INK_700}" style="font-family:${FONT_UI}">Light points (as designed)</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.4" fill="${INK_900}" style="font-family:${FONT_MONO}">${lights.length} no</text>`;
      y += 3.6;
    }
    y += 3;
  }
  if (zone.type === "structure") {
    const t = panelText(y, "Its integral downlights and coating are part of the structure and are not shown as separate points.", { size: 2.3 });
    body += t.svg;
    y = t.y + 3;
  }

  if (hasCurve(zone.polygon)) {
    const t = panelText(y, "Curved edge: traced chords, not dimensioned individually. Set out the curve from its end points on site.", { size: 2.3, color: TERRACOTTA });
    body += t.svg;
    y = t.y + 2;
  }
  if (zone.area_derived_m2 && zone.derived_note) {
    body += panelHeading(y, "Derived area (*)");
    y += 5;
    const t = panelText(y, zone.derived_note, { size: 2.3, color: INK_700 });
    body += t.svg;
    y = t.y + 3;
  }
  if (zone.type === "paving" || zone.type === "structure" || zone.type === "deck" || zone.level_mm != null) {
    body += levelsLegend(y, graph).svg;
  }

  return renderSheet({
    meta: sheetMetaAt(meta, f.denom),
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    body,
    showNorthScale: true,
    northDeg: graph.meta.north_deg,
    scaleBar: scaleBarFor(f.denom),
  });
}

// --- Overlays -------------------------------------------------------------------

function overlayBase(graph: PlanGraph, f: Frame): string {
  return defs() + graph.rooms.map((r) => zoneShape(r, f, { faint: true })).join("") + wallsSvg(graph, f);
}

export function fittingCode(spec: Record<string, unknown> | null | undefined, type: string): string {
  if (type === "boundary_light") return "BL";
  const fitting = String(spec?.fitting ?? "").toLowerCase();
  if (fitting.includes("inground")) return "IG";
  if (fitting.includes("8.5")) return "S8";
  if (fitting.includes("4.5")) return "S4";
  if (fitting.includes("strip")) return "LS";
  return "GL";
}

export const FITTING_LABEL: Record<string, string> = {
  IG: "Inground uplight",
  S8: "Spike light 8.5 W",
  S4: "Spike light 4.5 W",
  LS: "LED strip (per point)",
  GL: "Garden light",
  BL: "Boundary wall light",
};

export function renderLightingOverlay(
  graph: PlanGraph,
  fixtures: readonly GardenFixture[],
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  const f = frameFor(siteBbox(graph), drawingArea());
  const lights = fixtures.filter((p) => p.type === "garden_light" || p.type === "boundary_light");
  const pts = lights.map((p) => toMetres(graph, p.position));
  const tree = minimumSpanningTree(pts);

  let body = overlayBase(graph, f);
  for (const [a, b] of tree.edges) {
    body += `<line x1="${f2(f.px(pts[a]![0]))}" y1="${f2(f.py(pts[a]![1]))}" x2="${f2(f.px(pts[b]![0]))}" y2="${f2(f.py(pts[b]![1]))}" stroke="${LIGHT_AMBER}" stroke-width="0.3" stroke-dasharray="1.2 0.8"/>`;
  }
  lights.forEach((p, i) => {
    body += ringSymbol(f.px(pts[i]![0]), f.py(pts[i]![1]), fittingCode(p.spec, p.type), LIGHT_AMBER, 1.6);
  });

  let y = SHEET_MARGIN + 8;
  body += `<rect x="${panelX() - 2}" y="${f2(y - 4)}" width="${PANEL_W + 4}" height="15" fill="#FFF7E8" stroke="${LIGHT_AMBER}" stroke-width="0.35"/>`;
  const banner = panelText(y + 0.5, LIGHTING_SOURCE_STATEMENT, { size: 2.6, color: INK_900, maxChars: 70 });
  body += banner.svg;
  y += 16;

  const counts = new Map<string, number>();
  for (const p of lights) counts.set(fittingCode(p.spec, p.type), (counts.get(fittingCode(p.spec, p.type)) ?? 0) + 1);
  body += panelHeading(y, "Lighting schedule");
  y += 5;
  for (const [code, n] of [...counts.entries()].sort()) {
    body += ringSymbol(panelX() + 2, y - 0.8, code, LIGHT_AMBER, 1.6);
    body += `<text x="${panelX() + 7}" y="${f2(y)}" font-size="2.5" fill="${INK_700}" style="font-family:${FONT_UI}">${esc(FITTING_LABEL[code] ?? code)}</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.5" fill="${INK_900}" style="font-family:${FONT_MONO}" data-count="${code}">${n}</text>`;
    y += 4.2;
  }
  body += `<text x="${panelX() + 7}" y="${f2(y)}" font-size="2.5" fill="${INK_500}" style="font-family:${FONT_UI};font-weight:600">Total points</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.5" fill="${INK_900}" style="font-family:${FONT_MONO};font-weight:700">${lights.length}</text>`;
  y += 7;

  body += panelHeading(y, "Cabling");
  y += 5;
  body += `<line x1="${panelX()}" y1="${f2(y - 0.9)}" x2="${panelX() + 6}" y2="${f2(y - 0.9)}" stroke="${LIGHT_AMBER}" stroke-width="0.35" stroke-dasharray="1.2 0.8"/><text x="${panelX() + 9}" y="${f2(y)}" font-size="2.5" fill="${INK_700}" style="font-family:${FONT_UI}">Indicative cable route</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.5" fill="${INK_900}" style="font-family:${FONT_MONO}" data-route-m="${tree.length_m}">${tree.length_m.toFixed(1)} m</text>`;
  y += 4.5;
  const t = panelText(y, "Route is the shortest network reaching every point — derived, not designed. Feed point, conduit and circuit layout to be confirmed by the electrical contractor.", { size: 2.3 });
  body += t.svg;
  y = t.y + 3;
  const structures = graph.rooms.filter((r) => r.type === "structure");
  if (structures.length > 0) {
    const s = panelText(y, `${structures.map((r) => r.name_en).join(", ")}: integral downlights are part of the structure and are not shown as points.`, { size: 2.3 });
    body += s.svg;
  }

  return renderSheet({
    meta: sheetMetaAt(meta, f.denom),
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    body,
    showNorthScale: true,
    northDeg: graph.meta.north_deg,
    scaleBar: scaleBarFor(f.denom),
  });
}

export function renderIrrigationOverlay(
  graph: PlanGraph,
  fixtures: readonly GardenFixture[],
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  const f = frameFor(siteBbox(graph), drawingArea());
  const beds = graph.rooms.filter((r) => r.type === "planting_bed");
  const planterRuns = graph.elements.filter((e) => e.kind === "planter_run");
  const planterBoxes = fixtures.filter((u) => u.layer === "landscape" && u.type === "planter_box");
  const drains = fixtures.filter((p) => p.type === "drainage_point");

  // Anchors the indicative irrigation network must reach.
  const anchors: Point[] = [
    ...beds.map((r) => labelPoint(r.polygon)),
    ...planterRuns.map((e) => e.polyline[Math.floor(e.polyline.length / 2)]!),
    ...planterBoxes.map((u) => toMetres(graph, u.position)),
  ];
  const tree = minimumSpanningTree(anchors);

  let body = overlayBase(graph, f);
  for (const r of beds) {
    body += `<polygon points="${polyPts(r.polygon, f)}" fill="${IRRIGATION_BLUE}" fill-opacity="0.18" stroke="${IRRIGATION_BLUE}" stroke-width="0.45"/>`;
  }
  for (const e of planterRuns) {
    body += `<polyline points="${e.polyline.map(([x, y]) => `${f2(f.px(x))},${f2(f.py(y))}`).join(" ")}" fill="none" stroke="${IRRIGATION_BLUE}" stroke-width="1.1" stroke-opacity="0.8"/>`;
  }
  for (const u of planterBoxes) {
    const m = toMetres(graph, u.position);
    body += ringSymbol(f.px(m[0]), f.py(m[1]), "PB", IRRIGATION_BLUE, 1.9);
  }
  for (const [a, b] of tree.edges) {
    body += `<line x1="${f2(f.px(anchors[a]![0]))}" y1="${f2(f.py(anchors[a]![1]))}" x2="${f2(f.px(anchors[b]![0]))}" y2="${f2(f.py(anchors[b]![1]))}" stroke="${IRRIGATION_BLUE}" stroke-width="0.3" stroke-dasharray="1.6 0.9"/>`;
  }
  for (const d of drains) {
    const m = toMetres(graph, d.position);
    body += ringSymbol(f.px(m[0]), f.py(m[1]), "DR", INK_900, 1.6);
  }

  let y = SHEET_MARGIN + 8;
  body += panelHeading(y, "Irrigation & drainage");
  y += 5;
  const bedArea = r2(beds.reduce((s, r) => s + r.area_m2, 0));
  const runLm = r2(planterRuns.reduce((s, e) => s + e.length_m, 0));
  const rows: [string, string, string][] = [
    ["Planting beds (drip zones)", `${beds.length}`, `${bedArea.toFixed(2)} m²`],
    ["Planter runs (drip lines)", `${planterRuns.length}`, `${runLm.toFixed(2)} m`],
    ["Planter boxes", `${planterBoxes.length}`, ""],
    ["Drainage points", `${drains.length}`, ""],
  ];
  for (const [k, n, v] of rows) {
    body += `<text x="${panelX()}" y="${f2(y)}" font-size="2.5" fill="${INK_700}" style="font-family:${FONT_UI}">${esc(k)}</text><text x="${panelX() + 80}" y="${f2(y)}" text-anchor="end" font-size="2.5" fill="${INK_900}" style="font-family:${FONT_MONO}">${n}</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.5" fill="${INK_900}" style="font-family:${FONT_MONO}">${v}</text>`;
    y += 4.2;
  }
  y += 2;
  body += `<text x="${panelX()}" y="${f2(y)}" font-size="2.5" fill="${INK_700}" style="font-family:${FONT_UI}">Indicative distribution route</text><text x="${panelX() + PANEL_W}" y="${f2(y)}" text-anchor="end" font-size="2.5" fill="${INK_900}" style="font-family:${FONT_MONO}" data-route-m="${tree.length_m}">${tree.length_m.toFixed(1)} m</text>`;
  y += 5;

  const notes = [
    "Artificial grass is not irrigated and is not shown as an irrigation zone.",
    "The distribution route is the shortest network reaching every irrigated zone — derived, not designed. Pump, valve box and station layout to be confirmed with the irrigation design.",
    drains.length === 0
      ? "No drainage points are placed on this plan. In the reference project surface drainage was absorbed into the contract price; place drainage points on the plan as designed."
      : "Drainage points are shown as placed on the plan (as designed, not surveyed).",
    "No HVAC on this sheet or in this scope.",
  ];
  for (const n of notes) {
    const t = panelText(y, n, { size: 2.3 });
    body += t.svg;
    y = t.y + 2.2;
  }

  return renderSheet({
    meta: sheetMetaAt(meta, f.denom),
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    body,
    showNorthScale: true,
    northDeg: graph.meta.north_deg,
    scaleBar: scaleBarFor(f.denom),
  });
}

// --- The set ---------------------------------------------------------------------

/** Assemble every garden sheet for a graph that has outdoor zones. */
export function buildGardenSheets(
  graph: PlanGraph,
  fixtures: readonly GardenFixture[],
  meta: SheetMeta,
): GardenSheet[] {
  const zones = gardenZones(graph);
  if (zones.length === 0) return [];
  const sheets: GardenSheet[] = [
    {
      kind: "site_plan",
      title: "Site Plan — Garden",
      sheetNumber: "L-100",
      svg: renderSitePlan(graph, fixtures, meta, { sheetNumber: "L-100", title: "Site Plan — Garden" }),
    },
  ];
  zones.forEach((z, i) => {
    const num = `L-${101 + i}`;
    sheets.push({
      kind: "zone_plan",
      title: `${zoneRef(i)} ${z.name_en}`,
      sheetNumber: num,
      zoneId: z.id,
      svg: renderZoneSheet(graph, z, zoneRef(i), fixtures, meta, { sheetNumber: num, title: `${zoneRef(i)} ${z.name_en}` }),
    });
  });
  const hasLights = fixtures.some((p) => p.type === "garden_light" || p.type === "boundary_light");
  if (hasLights) {
    sheets.push({
      kind: "lighting_overlay",
      title: "Lighting & Electrical Overlay",
      sheetNumber: "L-401",
      svg: renderLightingOverlay(graph, fixtures, meta, { sheetNumber: "L-401", title: "Lighting & Electrical Overlay" }),
    });
  }
  sheets.push({
    kind: "irrigation_overlay",
    title: "Irrigation & Drainage Overlay",
    sheetNumber: "L-402",
    svg: renderIrrigationOverlay(graph, fixtures, meta, { sheetNumber: "L-402", title: "Irrigation & Drainage Overlay" }),
  });
  return sheets;
}

/** Title-block keep-out, exported for layout tests. */
export const TITLE_BLOCK_BOX = {
  x: SHEET_W - SHEET_MARGIN - TITLE_W,
  y: SHEET_H - SHEET_MARGIN - TITLE_H,
  w: TITLE_W,
  h: TITLE_H,
};
