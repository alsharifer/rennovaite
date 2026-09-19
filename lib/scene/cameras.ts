// =============================================================================
// lib/scene/cameras.ts — where the renders are taken from, and what each sees.
//
// One camera per garden zone plus up to three whole-garden views. Cameras are
// CHOSEN, not hand-placed: candidates round each zone are scored on a small
// id-buffer render (how much of the zone is in frame, how much of what stands
// in it is visible, nothing but sky or wall filling the view), and the best
// wins. Deterministic: the same plan always yields the same cameras, which is
// what makes a camera id a cache key.
//
// The MANIFEST is what the faithfulness gate checks a render against: every
// object the camera actually sees (from the full-resolution id buffer), its
// share of the frame and where it sits in it.
//
// G5 — narrow plots. An eye-level camera in a 4–6 m strip between a house and a
// boundary wall has nowhere to stand back: the zone fills the frame, a wall or
// the house sits a metre from the lens, and the render model "fixes" the view by
// pulling back and inventing what it thinks should be there (a rehearsal gazebo
// render invented a house). That is predictable from the geometry, so it is
// decided here rather than discovered by the gate:
//   - a standpoint with less than NARROW_M of clear width is CRAMPED and is not
//     used at eye level;
//   - instead, ELEVATED three-quarter views look along the corridor axis from
//     up and back, with a wider lens;
//   - every chosen camera is checked for a CLEAN view (enough of the zone, no
//     mass against the lens, a horizon, no single object filling the frame).
//     A camera that cannot be made clean is marked so, and the pipeline ships the
//     labelled 3D design view for it without spending a render attempt.
// =============================================================================

import { runBand, runSegments } from "@/lib/drawings/garden-elevations";
import { bboxOf, gardenZones, toMetres, type GardenFixture } from "@/lib/drawings/garden-sheets";
import type { PlanGraph, Point, Room } from "@/lib/plan/geometry";

import type { Scene, SceneObject, Vec3 } from "./mesh";
import { renderScene, type Camera, type RenderResult } from "./raster";

export const RENDER_W = 1200;
export const RENDER_H = 800;
const PROBE_W = 180;
const PROBE_H = 120;
const FOV = 58;

/** Clear width (metres, across the corridor) below which a standpoint is cramped. */
export const NARROW_M = 6;
const ELEVATED_FOV = 70;

export interface GardenCamera extends Camera {
  /** "zone:<roomId>" or "garden:<slug>". */
  id: string;
  label: string;
  zoneId: string | null;
  /** Does this view get an evening render (lighting on the plan in view)? */
  lit: boolean;
  /**
   * G5: can a styled render be attempted from here? false = no clean view exists
   * (see cleanReasons); the pipeline ships the 3D design view outright.
   */
  clean: boolean;
  cleanReasons: string[];
  /** "eye" (standing in the zone), "elevated" (up and back along the corridor) or "aerial" (the whole garden from above, G5c). */
  mode: "eye" | "elevated" | "aerial";
}

export interface ManifestItem {
  key: string;
  noun: string;
  label: string;
  category: SceneObject["category"];
  zoneId: string | null;
  /** Share of the frame, 0..1. */
  share: number;
  /** Bounding box in the frame, percent: [x0, y0, x1, y1]. */
  box: [number, number, number, number];
}

export interface CameraManifest {
  projectId: string;
  cameraId: string;
  items: ManifestItem[];
  /** Structures the gate must find, grouped with counts ("square planter box" × 1). */
  counts: Record<string, number>;
}

const inside = (p: Point, poly: readonly Point[]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

const grow = (poly: readonly Point[], m: number): Point[] => {
  const b = bboxOf(poly);
  const c: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  return poly.map((p) => {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1;
    return [p[0] + ((p[0] - c[0]) / d) * m, p[1] + ((p[1] - c[1]) / d) * m];
  });
};

/** Plan footprints a camera may not stand inside (with clearance). */
function obstacles(graph: PlanGraph, fixtures: readonly GardenFixture[]): Point[][] {
  const out: Point[][] = graph.context.filter((c) => c.kind !== "steps").map((c) => grow(c.polygon, 0.35));
  for (const z of gardenZones(graph)) if (z.type === "planting_bed" || z.type === "structure") out.push(grow(z.polygon, 0.25));
  for (const el of graph.elements) {
    if (el.kind === "boundary_wall") continue;
    const [o0, o1] = runBand(el);
    for (const s of runSegments(el)) {
      const q = (t: number, o: number): Point => [s.a[0] + s.dir[0] * t + s.normal[0] * o, s.a[1] + s.dir[1] * t + s.normal[1] * o];
      out.push([q(-0.3, o0 - 0.3), q(s.len + 0.3, o0 - 0.3), q(s.len + 0.3, o1 + 0.3), q(-0.3, o1 + 0.3)]);
    }
  }
  for (const u of fixtures.filter((f) => f.layer === "landscape")) {
    const p = toMetres(graph, u.position);
    // G5c: a tree is its canopy — a lens inside the leaves sees nothing else.
    const canopy = u.type === "tree" && typeof u.spec?.canopy_mm === "number" ? (u.spec.canopy_mm as number) / 2000 + 0.3 : 0;
    const w = Math.max(canopy, ((typeof u.spec?.width_mm === "number" ? u.spec.width_mm : 1000) as number) / 2000 + 0.4);
    out.push([[p[0] - w, p[1] - w], [p[0] + w, p[1] - w], [p[0] + w, p[1] + w], [p[0] - w, p[1] + w]]);
  }
  return out;
}

/**
 * An elevated camera stands above the garden itself: anywhere inside the plot
 * clear of buildings and walls (above a bed or a lawn is fine — the lens is up
 * high), never inside a structure. G5c: never beyond the plot line — the G5
 * over-the-wall standpoints looked across empty neighbouring land and the render
 * model filled it with invented gardens.
 */
function elevatedStandpoint(graph: PlanGraph, blocked: Point[][], p: Point): boolean {
  if (openGround(graph, blocked, p)) return true;
  const plot = graph.meta.plot;
  if (!plot) return false;
  const [ox, oy] = plot.origin_m;
  const inPlot = p[0] > ox + 0.4 && p[1] > oy + 0.4 && p[0] < ox + plot.width_m - 0.4 && p[1] < oy + plot.depth_m - 0.4;
  const inStructure = gardenZones(graph).some((z) => z.type === "structure" && inside(p, z.polygon));
  return inPlot && !inStructure && clearOfBuildings(graph, p);
}

/** An elevated lens next to a two-storey wall is a close-up of the wall: keep 2.2 m off buildings. */
function clearOfBuildings(graph: PlanGraph, p: Point): boolean {
  return !graph.context.some((cx) => cx.kind !== "steps" && (inside(p, cx.polygon) || distToPolygon(p, cx.polygon) < (cx.kind === "existing_building" ? 2.2 : 0.3)));
}

function distToPolygon(p: Point, poly: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
}

function openGround(graph: PlanGraph, blocked: Point[][], p: Point): boolean {
  const plot = graph.meta.plot;
  if (plot) {
    const [ox, oy] = plot.origin_m;
    if (p[0] < ox + 0.4 || p[1] < oy + 0.4 || p[0] > ox + plot.width_m - 0.4 || p[1] > oy + plot.depth_m - 0.4) return false;
  }
  if (blocked.some((poly) => inside(p, poly))) return false;
  return gardenZones(graph).some((z) => inside(p, z.polygon));
}

/**
 * Clear extent at a standpoint along each plan axis, to the nearest existing
 * footprint (house, garage, boundary wall) or the plot edge. The narrower of the
 * two is how much room a camera has to stand back; the wider is the corridor's
 * axis — the direction a view along the plot looks.
 */
export function clearWidth(graph: PlanGraph, p: Point): { min: number; axis: Point; along: number } {
  const plot = graph.meta.plot;
  const walls = graph.context.filter((c) => c.kind !== "steps").map((c) => c.polygon);
  const blockedAt = (q: Point) => {
    if (plot) {
      const [ox, oy] = plot.origin_m;
      if (q[0] < ox || q[1] < oy || q[0] > ox + plot.width_m || q[1] > oy + plot.depth_m) return true;
    }
    return walls.some((w) => inside(q, w));
  };
  const reach = (d: Point) => {
    let t = 0;
    for (; t < 40; t += 0.1) if (blockedAt([p[0] + d[0] * t, p[1] + d[1] * t])) break;
    return t;
  };
  const wx = reach([1, 0]) + reach([-1, 0]);
  const wy = reach([0, 1]) + reach([0, -1]);
  return wx >= wy ? { min: wy, axis: [1, 0], along: wx } : { min: wx, axis: [0, 1], along: wy };
}

function objectIdsWhere(scene: Scene, pred: (o: SceneObject) => boolean): Set<number> {
  return new Set(scene.objects.filter(pred).map((o) => o.id));
}

function coverage(res: RenderResult, ids: Set<number>): number {
  let n = 0;
  for (const id of res.ids) if (ids.has(id)) n++;
  return n / res.ids.length;
}

interface ViewScore {
  score: number;
  clean: boolean;
  reasons: string[];
}

/**
 * G5: is this a view a render model can paint without reinterpreting it?
 * Thresholds are deliberately plain: the zone must be a real part of the frame,
 * nothing solid may sit against the lens, a horizon must show, and no single
 * structure may fill the frame.
 */
function cleanCheck(scene: Scene, res: RenderResult, focus: Set<number>, structures: Set<number>, blockers: Set<number>, minFocus = 0.1): string[] {
  const n = res.ids.length;
  const neighbours = objectIdsWhere(scene, (o) => o.key.startsWith("neighbour:"));
  const solid = new Set(scene.objects.filter((o) => o.category === "structure" || o.category === "context" || o.category === "planting").filter((o) => o.key !== "ground" && !o.key.startsWith("neighbour:")).map((o) => o.id));
  let focusPx = 0, sky = 0, near = 0, block = 0;
  const perStructure = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const id = res.ids[i]!;
    if (id === 0 || neighbours.has(id)) sky++;
    if (focus.has(id)) focusPx++;
    if (blockers.has(id)) block++;
    if (solid.has(id) && res.depth[i]! < 2.2) near++;
    if (structures.has(id)) perStructure.set(id, (perStructure.get(id) ?? 0) + 1);
  }
  const reasons: string[] = [];
  if (focusPx / n < minFocus) reasons.push(`zone only ${Math.round((focusPx / n) * 100)}% of frame`);
  if (near / n > 0.06) reasons.push(`solid mass within 2.2 m of the lens (${Math.round((near / n) * 100)}% of frame)`);
  if (sky / n < 0.03) reasons.push("no horizon in frame");
  if (block / n > 0.45) reasons.push(`house or walls fill ${Math.round((block / n) * 100)}% of frame`);
  const biggest = Math.max(0, ...perStructure.values()) / n;
  if (biggest > 0.4) reasons.push(`one structure fills ${Math.round(biggest * 100)}% of frame`);
  return reasons;
}

function rateView(scene: Scene, cam: Camera, focus: Set<number>, structures: Set<number>, blockers: Set<number>, minFocus = 0.1): ViewScore {
  const res = renderScene(scene, cam, PROBE_W, PROBE_H, { supersample: 1, outlines: false });
  const neighbours = objectIdsWhere(scene, (o) => o.key.startsWith("neighbour:"));
  const focusShare = coverage(res, focus);
  let structShare = 0;
  if (structures.size) structShare = coverage(res, structures);
  let sky = 0;
  let block = 0;
  const perObject = new Map<number, number>();
  for (const id of res.ids) {
    if (id === 0 || neighbours.has(id)) sky++;
    else if (blockers.has(id)) block++;
    if (id !== 0) perObject.set(id, (perObject.get(id) ?? 0) + 1);
  }
  const n = res.ids.length;
  let biggestStructure = 0;
  for (const id of structures) biggestStructure = Math.max(biggestStructure, (perObject.get(id) ?? 0) / n);
  // Aim for the zone filling a good share of the frame without the camera
  // pressed against it; reward what stands in it; penalise walls in the face
  // and a frame that is mostly sky.
  // A render model reads a view through its horizon: a frame with no sky (a
  // camera staring at the ground) or one object filling it (a close-up) gets
  // reinterpreted, so both are penalised.
  const score =
    Math.min(focusShare, 0.4) * 2 -
    Math.max(0, focusShare - 0.55) * 1.5 +
    Math.min(structShare, 0.3) * 1.5 -
    Math.max(0, biggestStructure - 0.3) * 2 -
    Math.max(0, block / n - 0.35) * 1.5 -
    Math.max(0, sky / n - 0.45) -
    (sky / n < 0.06 ? 0.5 : 0);
  const reasons = cleanCheck(scene, res, focus, structures, blockers, minFocus);
  return { score, clean: reasons.length === 0, reasons };
}

type Candidate = { cam: Camera; score: number; clean: boolean; reasons: string[]; mode: "eye" | "elevated" };

/** Clean beats unclean; then the higher score. */
function better(a: Candidate, b: Candidate | null): boolean {
  if (!b) return true;
  if (a.clean !== b.clean) return a.clean;
  return a.score > b.score + 1e-9;
}

/**
 * G5: elevated three-quarter views along the corridor. From open ground up to
 * 16 m away, looking at the target along (within 40° of) the corridor axis at
 * the standpoint, from 4.2 m or 5.6 m up with a wider lens.
 */
function elevatedCandidates(
  scene: Scene,
  graph: PlanGraph,
  blocked: Point[][],
  target: Point,
  level: number,
  targetY: number,
  focus: Set<number>,
  structures: Set<number>,
  blockers: Set<number>,
  minFocus = 0.1,
  prefer = 7,
): Candidate[] {
  const out: Candidate[] = [];
  // The corridor the TARGET sits in decides the axis a view looks along — at an
  // L-junction the standpoint alone reads wide and would point across the strip.
  const axis = clearWidth(graph, target).axis;
  const plot = graph.meta.plot;
  // Up and back may mean over the boundary: a view in over the street wall from
  // up to 3 m outside the plot line (never inside a building or wall footprint).
  const OUT = 3;
  const x0 = plot ? plot.origin_m[0] - OUT : target[0] - 16;
  const y0 = plot ? plot.origin_m[1] - OUT : target[1] - 16;
  const x1 = plot ? plot.origin_m[0] + plot.width_m + OUT : target[0] + 16;
  const y1 = plot ? plot.origin_m[1] + plot.depth_m + OUT : target[1] + 16;
  const standable = (p: Point) => elevatedStandpoint(graph, blocked, p);
  // Cheap geometric filters first, then only the 40 standpoints nearest a
  // comfortable stand-back of ~8 m are probed (probes are the expensive part).
  const spots: { p: Point; d: number }[] = [];
  for (let x = x0 + 0.5; x <= x1 - 0.5; x += 1) {
    for (let y = y0 + 0.5; y <= y1 - 0.5; y += 1) {
      const p: Point = [x, y];
      const d = Math.hypot(target[0] - x, target[1] - y);
      if (d < 3.5 || d > 16) continue;
      const dir: Point = [(target[0] - x) / d, (target[1] - y) / d];
      if (Math.abs(dir[0] * axis[0] + dir[1] * axis[1]) < Math.cos((40 * Math.PI) / 180)) continue;
      if (!standable(p) || !clearOfBuildings(graph, p)) continue;
      spots.push({ p, d });
    }
  }
  // Stage 1: a quarter-size probe of the 60 spots nearest a ~7 m stand-back.
  spots.sort((a, b) => Math.abs(a.d - prefer) - Math.abs(b.d - prefer) || a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  const screened = spots
    .slice(0, 60)
    .map(({ p }) => {
      const cam: Camera = { pos: [p[0], level + 4.8, p[1]], target: [target[0], targetY, target[1]], fovDeg: ELEVATED_FOV };
      const res = renderScene(scene, cam, PROBE_W / 2, PROBE_H / 2, { supersample: 1, outlines: false });
      const reasons = cleanCheck(scene, res, focus, structures, blockers, minFocus);
      return { p, screen: coverage(res, focus) - reasons.length * 0.1 };
    })
    .sort((a, b) => b.screen - a.screen || a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  // Stage 2: the best few, fully rated at two heights.
  for (const { p } of screened.slice(0, 6)) {
    const [x, y] = p;
    {
      for (const h of [4.2, 5.6]) {
        const cam: Camera = { pos: [x, level + h, y], target: [target[0], targetY, target[1]], fovDeg: ELEVATED_FOV };
        const r = rateView(scene, cam, focus, structures, blockers, minFocus);
        // In a corridor, up-and-back is the view we want: a small bias toward it —
        // for a clean view only; between two unclean views the one that shows more wins.
        out.push({ cam, score: r.score + (r.clean ? 0.1 : 0), clean: r.clean, reasons: r.reasons, mode: "elevated" });
      }
    }
  }
  return out;
}

function zoneCamera(scene: Scene, graph: PlanGraph, blocked: Point[][], zone: Room, lightsByZone: Set<string>): GardenCamera {
  const b = bboxOf(zone.polygon);
  const c: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const level = (zone.level_mm ?? 0) / 1000;
  const focus = objectIdsWhere(scene, (o) => o.zoneId === zone.id);
  const structures = objectIdsWhere(scene, (o) => o.category === "structure" && o.zoneId === zone.id);
  const blockers = objectIdsWhere(scene, (o) => o.category === "context" && o.noun !== "ground" && !o.key.startsWith("neighbour:"));
  // G5c: a strip under 1.5 m wide (a bed, a path) is a small part of any honest view of it.
  const minFocus = Math.min(b.maxX - b.minX, b.maxY - b.minY) < 1.5 ? 0.035 : 0.1;
  // Aim near eye level so the horizon stays in frame.
  const targetY = level + (zone.type === "structure" ? 1.4 : structures.size ? 0.9 : 0.8);

  // G5c: a structure is photographed from BACK, not from under it. A lens 3 m from
  // a pergola makes the roof the whole frame, and the render model answers by
  // pulling back and reinventing the view (the gate then fails it for exactly that).
  const dists = zone.type === "structure"
    ? [extent * 1.5 + 2, extent * 2.1 + 3, extent * 1.1 + 1.5]
    : [extent * 0.9 + 1.5, extent * 1.3 + 2.5, extent * 0.6 + 1, extent * 0.45, extent * 0.3];
  const standBack = zone.type === "structure" ? 9.5 : 7;
  let best = null as Candidate | null;
  let cramped = 0;
  const crampedSpots: { p: Point; eye: number }[] = [];
  const heights = [1.65, 2.6];
  for (const eye of heights) {
    // Large zones are best seen from within them; small ones from beside them.
    for (const dist of dists) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const p: Point = [c[0] + Math.cos(a) * dist, c[1] + Math.sin(a) * dist];
        if (!openGround(graph, blocked, p)) continue;
        // G5: no eye-level camera where there is no room to stand back.
        if (clearWidth(graph, p).min < NARROW_M) {
          cramped++;
          crampedSpots.push({ p, eye });
          continue;
        }
        const cam: Camera = { pos: [p[0], level + eye, p[1]], target: [c[0], targetY, c[1]], fovDeg: FOV };
        const r = rateView(scene, cam, focus, structures, blockers, minFocus);
        const cand: Candidate = { cam, score: r.score - (eye > 2 ? 0.05 : 0), clean: r.clean, reasons: r.reasons, mode: "eye" }; // prefer eye level
        if (better(cand, best)) best = cand;
      }
    }
    if (best && best.clean && best.score > 0.35) break;
  }
  // G5: a narrow plot, or no clean eye-level view — look along the corridor from up and back.
  const narrowZone = clearWidth(graph, c).min < NARROW_M;
  if (cramped > 0 || !best || !best.clean || narrowZone) {
    // Aim at eye height, not the ground: looking down from 4–6 m at a ground
    // target loses the horizon, and a frame with no sky is one the model reframes.
    const elevatedTargetY = level + 1.5;
    let bestElevated = null as Candidate | null;
    for (const cand of elevatedCandidates(scene, graph, blocked, c, level, elevatedTargetY, focus, structures, blockers, minFocus, standBack)) {
      if (better(cand, bestElevated)) bestElevated = cand;
    }
    // In a narrow zone a clean up-and-back view wins outright over eye level.
    if (bestElevated && ((narrowZone && bestElevated.clean) || better(bestElevated, best))) best = bestElevated;
  }
  // Nothing clean anywhere: the view is a 3D design view by choice, so it should
  // at least SHOW the zone — let the cramped eye-level spots compete on score.
  if (!best || !best.clean) {
    for (const { p, eye } of crampedSpots) {
      const cam: Camera = { pos: [p[0], level + eye, p[1]], target: [c[0], targetY, c[1]], fovDeg: FOV };
      const r = rateView(scene, cam, focus, structures, blockers, minFocus);
      const cand: Candidate = { cam, score: r.score, clean: false, reasons: r.clean ? ["cramped standpoint (under 6 m of clear width)"] : ["cramped standpoint (under 6 m of clear width)", ...r.reasons], mode: "eye" };
      if (!best || (!best.clean && cand.score > best.score + 1e-9)) best = cand;
    }
  }
  // No open ground at all: look down on it from above the nearest open point.
  if (!best) {
    const p: Point = [c[0] + extent + 2, c[1] + extent + 2];
    const cam: Camera = { pos: [p[0], level + 4, p[1]], target: [c[0], level, c[1]], fovDeg: FOV };
    const r = rateView(scene, cam, focus, structures, blockers, minFocus);
    best = { cam, score: 0, clean: false, reasons: ["no open ground to stand on", ...r.reasons], mode: "elevated" };
  }
  return { ...best.cam, id: `zone:${zone.id}`, label: zone.name_en, zoneId: zone.id, lit: lightsByZone.has(zone.id) || zone.type === "structure", clean: best.clean, cleanReasons: best.reasons, mode: best.mode };
}

/** Connected groups of zones (backyard, front garden…), largest first. */
function clusters(graph: PlanGraph): Room[][] {
  const zones = gardenZones(graph);
  const near = (a: Room, b: Room) => {
    const A = bboxOf(a.polygon), B = bboxOf(b.polygon);
    return A.minX <= B.maxX + 0.5 && B.minX <= A.maxX + 0.5 && A.minY <= B.maxY + 0.5 && B.minY <= A.maxY + 0.5;
  };
  const seen = new Set<string>();
  const out: Room[][] = [];
  for (const z of zones) {
    if (seen.has(z.id)) continue;
    const group: Room[] = [];
    const stack = [z];
    seen.add(z.id);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const o of zones) if (!seen.has(o.id) && near(cur, o)) {
        seen.add(o.id);
        stack.push(o);
      }
    }
    out.push(group);
  }
  const area = (g: Room[]) => g.reduce((s, r) => s + r.area_m2, 0);
  return out.sort((a, b) => area(b) - area(a));
}

function gardenCameras(scene: Scene, graph: PlanGraph, blocked: Point[][]): GardenCamera[] {
  const out: GardenCamera[] = [];
  const groups = clusters(graph);
  const names = ["garden", "front"];
  const blockers = objectIdsWhere(scene, (o) => o.category === "context" && o.noun !== "ground" && !o.key.startsWith("neighbour:"));
  groups.slice(0, 2).forEach((group, gi) => {
    const ids = new Set(group.map((r) => r.id));
    const focus = objectIdsWhere(scene, (o) => o.zoneId !== null && ids.has(o.zoneId));
    const structures = objectIdsWhere(scene, (o) => o.category === "structure" && o.zoneId !== null && ids.has(o.zoneId));
    // The group's main body: its largest zones, so a narrow side courtyard
    // does not drag the view into a wall.
    const body = [...group].sort((a, b) => b.area_m2 - a.area_m2).slice(0, Math.max(3, Math.ceil(group.length / 2)));
    const b = bboxOf(body.flatMap((r) => r.polygon));
    const c: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    const cands: { cam: Camera; score: number; angle: number; clean: boolean; reasons: string[]; mode: "eye" | "elevated" }[] = [];
    // G5: a garden made of narrow strips has no middle to look at — the centre
    // of an L of strips is the house. Its whole-garden views look ALONG each
    // corridor from its end, from well up.
    const samples: number[] = [];
    for (const z of body) {
      const zb = bboxOf(z.polygon);
      samples.push(clearWidth(graph, [(zb.minX + zb.maxX) / 2, (zb.minY + zb.maxY) / 2]).min);
    }
    const narrow = samples.length > 0 && [...samples].sort((m, n2) => m - n2)[Math.floor(samples.length / 2)]! < NARROW_M;
    const pad = narrow ? 3 : 0;
    for (let x = b.minX + 0.5 - pad; x <= b.maxX - 0.5 + pad; x += narrow ? 1 : 0.8) {
      for (let y = b.minY + 0.5 - pad; y <= b.maxY - 0.5 + pad; y += narrow ? 1 : 0.8) {
        const p: Point = [x, y];
        if (narrow) {
          if (!elevatedStandpoint(graph, blocked, p) || !clearOfBuildings(graph, p)) continue;
          // Standing over the boundary, the corridor axis is read just inside it.
          const inPlot = body.some((z) => inside(p, z.polygon));
          const probe: Point = inPlot ? p : [Math.min(Math.max(x, b.minX + 0.3), b.maxX - 0.3), Math.min(Math.max(y, b.minY + 0.3), b.maxY - 0.3)];
          if (!body.some((z) => inside(probe, z.polygon))) continue;
          const cwp = clearWidth(graph, probe);
          const cw = cwp;
          // Look along the corridor, into the longer side, at a point well down it.
          for (const s of [1, -1]) {
            const reachT = (() => {
              let t = 0;
              for (; t < cw.along + pad; t += 0.5) {
                const q: Point = [x + cw.axis[0] * s * t, y + cw.axis[1] * s * t];
                if (!body.some((z) => inside(q, z.polygon)) && t > pad + 1) break;
              }
              return t;
            })();
            if (reachT < 8) continue;
            const t: Point = [x + cw.axis[0] * s * reachT * 0.55, y + cw.axis[1] * s * reachT * 0.55];
            // Aim a little above the ground so the far end and a strip of sky stay in frame.
            const cam: Camera = { pos: [x, 6.5, y], target: [t[0], 2.2, t[1]], fovDeg: 72 };
            const r = rateView(scene, cam, focus, structures, blockers);
            // Keep the house a side of the frame, not its subject.
            const houseShare = coverage(renderScene(scene, cam, PROBE_W / 2, PROBE_H / 2, { supersample: 1, outlines: false }), blockers);
            cands.push({ cam, score: r.score + Math.min(reachT, 20) * 0.02 - houseShare * 0.8, angle: Math.atan2(cw.axis[1] * s, cw.axis[0] * s), clean: r.clean, reasons: r.reasons, mode: "elevated" });
          }
          continue;
        }
        if (!openGround(graph, blocked, p) || !body.some((z) => inside(p, z.polygon))) continue;
        const d = Math.hypot(c[0] - x, c[1] - y);
        if (d < Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.35) continue; // stand back from the middle
        const cam: Camera = { pos: [x, 3.6, y], target: [c[0], 0.4, c[1]], fovDeg: 64 };
        const r = rateView(scene, cam, focus, structures, blockers);
        cands.push({ cam, score: r.score, angle: Math.atan2(y - c[1], x - c[0]), clean: r.clean, reasons: r.reasons, mode: "eye" });
      }
    }
    cands.sort((a, b2) => (a.clean === b2.clean ? b2.score - a.score : a.clean ? -1 : 1));
    const want = gi === 0 ? 2 : 1;
    const chosen: typeof cands = [];
    for (const cand of cands) {
      if (chosen.length >= want) break;
      // G5: on a narrow plot the second view looks along a DIFFERENT corridor —
      // the same strip from its other end is the same picture.
      if (narrow && chosen.some((ch) => Math.abs(Math.cos(ch.angle - cand.angle)) > 0.7) && cands.some((o) => !chosen.includes(o) && chosen.every((ch) => Math.abs(Math.cos(ch.angle - o.angle)) <= 0.7))) continue;
      // A second view has to look from a genuinely different side.
      // (0.45π, not 0.55π: two strips meeting at a right angle ARE different sides.)
      if (chosen.some((ch) => Math.abs(Math.atan2(Math.sin(ch.angle - cand.angle), Math.cos(ch.angle - cand.angle))) < Math.PI * 0.45)) continue;
      chosen.push(cand);
    }
    chosen.forEach((cand, i) => {
      out.push({ ...cand.cam, id: `garden:${names[gi]}-${i + 1}`, label: gi === 0 ? `Whole garden — view ${i + 1}` : "Front garden", zoneId: null, lit: true, clean: cand.clean, cleanReasons: cand.reasons, mode: cand.mode });
    });
  });
  return out;
}

/**
 * G5c: the whole garden from above — the strongest page in a professional pack.
 * A three-quarter bird's-eye from high over the street side (or a street
 * corner), aimed at the garden's centre, chosen by how much of the garden it
 * shows past the villa's roof.
 */
export function aerialCamera(scene: Scene, graph: PlanGraph): GardenCamera | null {
  const zones = gardenZones(graph);
  if (zones.length === 0) return null;
  const plot = graph.meta.plot;
  const b = plot
    ? { minX: plot.origin_m[0], minY: plot.origin_m[1], maxX: plot.origin_m[0] + plot.width_m, maxY: plot.origin_m[1] + plot.depth_m }
    : bboxOf(zones.flatMap((z) => z.polygon));
  // Aim at the GARDEN's centre (the zones), not the plot's: on an L-shaped garden
  // round a villa the plot centre is the villa's roof.
  const zb = bboxOf(zones.flatMap((z) => z.polygon));
  const c: Point = [(zb.minX + zb.maxX) / 2, (zb.minY + zb.maxY) / 2];
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const focus = objectIdsWhere(scene, (o) => o.zoneId !== null);
  const buildings = objectIdsWhere(scene, (o) => o.category === "context" && o.noun !== "ground" && o.noun !== "boundary wall" && !o.key.startsWith("neighbour:"));
  // G5d (session comment 3): the aerial must show the garden ENTRANCE — a view that
  // hides the gate behind the villa is not the garden's overview.
  const gates = scene.objects.filter((o) => o.key.startsWith("opening:"));
  const seen = (res: ReturnType<typeof renderScene>, id: number) => {
    for (let i = 0; i < res.ids.length; i++) if (res.ids[i] === id) return true;
    return false;
  };
  let best: { cam: Camera; score: number } | null = null;
  // From each side of the plot, square to it (a plan-aligned bird's-eye reads like
  // the site plan), at two heights; the view that shows most garden past the house wins.
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
    for (const h of [0.75, 0.95]) {
      const back = (dx !== 0 ? b.maxX - b.minX : b.maxY - b.minY) * 0.5 + 2;
      const cam: Camera = { pos: [c[0] + dx * back, span * h, c[1] + dy * back], target: [c[0] - dx * 1.5, 0, c[1] - dy * 1.5], fovDeg: 58 };
      const res = renderScene(scene, cam, PROBE_W, PROBE_H, { supersample: 1, outlines: false });
      const entrance = gates.length ? gates.filter((g) => seen(res, g.id)).length / gates.length : 0;
      const score = coverage(res, focus) * 2 - coverage(res, buildings) * 0.6 + entrance * 0.25;
      if (!best || score > best.score + 1e-9) best = { cam, score };
    }
  }
  return best ? { ...best.cam, id: "garden:aerial", label: "Whole garden — aerial", zoneId: null, lit: true, clean: true, cleanReasons: [], mode: "aerial" } : null;
}

export function chooseCameras(scene: Scene, graph: PlanGraph, fixtures: readonly GardenFixture[], litZoneIds: ReadonlySet<string>): GardenCamera[] {
  const lit = new Set(litZoneIds);
  const blocked = obstacles(graph, fixtures);
  const aerial = aerialCamera(scene, graph);
  return [...gardenZones(graph).map((z) => zoneCamera(scene, graph, blocked, z, lit)), ...(aerial ? [aerial] : []), ...gardenCameras(scene, graph, blocked)];
}

/** What a camera sees, from a full-resolution id buffer. */
export function buildManifest(projectId: string, cameraId: string, scene: Scene, res: RenderResult): CameraManifest {
  const stats = new Map<number, { n: number; x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < res.height; y++) {
    for (let x = 0; x < res.width; x++) {
      const id = res.ids[y * res.width + x]!;
      if (id === 0) continue;
      const s = stats.get(id) ?? { n: 0, x0: x, y0: y, x1: x, y1: y };
      s.n++;
      if (x < s.x0) s.x0 = x;
      if (y < s.y0) s.y0 = y;
      if (x > s.x1) s.x1 = x;
      if (y > s.y1) s.y1 = y;
      stats.set(id, s);
    }
  }
  const total = res.width * res.height;
  const items: ManifestItem[] = [];
  for (const o of scene.objects) {
    const s = stats.get(o.id);
    if (!s || o.key === "ground") continue;
    const share = s.n / total;
    // G5c: a fitting is listed as soon as a handful of pixels show it (parity), never gated.
    const min = o.category === "fixture" ? 0.00001 : o.category === "structure" ? 0.002 : o.category === "planting" ? 0.01 : 0.008;
    if (share < min) continue;
    const pct = (v: number, d: number) => Math.round((v / d) * 100);
    items.push({ key: o.key, noun: o.noun, label: o.label, category: o.category, zoneId: o.zoneId, share: Math.round(share * 10000) / 10000, box: [pct(s.x0, res.width), pct(s.y0, res.height), pct(s.x1 + 1, res.width), pct(s.y1 + 1, res.height)] });
  }
  items.sort((a, b) => b.share - a.share);
  const counts: Record<string, number> = {};
  for (const it of items) if (it.category === "structure") counts[it.noun] = (counts[it.noun] ?? 0) + 1;
  return { projectId, cameraId, items, counts };
}

export type { Vec3 };
