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

export interface GardenCamera extends Camera {
  /** "zone:<roomId>" or "garden:<slug>". */
  id: string;
  label: string;
  zoneId: string | null;
  /** Does this view get an evening render (lighting on the plan in view)? */
  lit: boolean;
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
    const w = ((typeof u.spec?.width_mm === "number" ? u.spec.width_mm : 1000) as number) / 2000 + 0.4;
    out.push([[p[0] - w, p[1] - w], [p[0] + w, p[1] - w], [p[0] + w, p[1] + w], [p[0] - w, p[1] + w]]);
  }
  return out;
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

function objectIdsWhere(scene: Scene, pred: (o: SceneObject) => boolean): Set<number> {
  return new Set(scene.objects.filter(pred).map((o) => o.id));
}

function coverage(res: RenderResult, ids: Set<number>): number {
  let n = 0;
  for (const id of res.ids) if (ids.has(id)) n++;
  return n / res.ids.length;
}

function scoreView(scene: Scene, cam: Camera, focus: Set<number>, structures: Set<number>, blockers: Set<number>): number {
  const res = renderScene(scene, cam, PROBE_W, PROBE_H, { supersample: 1, outlines: false });
  const focusShare = coverage(res, focus);
  let structShare = 0;
  if (structures.size) structShare = coverage(res, structures);
  let sky = 0;
  let block = 0;
  const perObject = new Map<number, number>();
  for (const id of res.ids) {
    if (id === 0) sky++;
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
  return (
    Math.min(focusShare, 0.4) * 2 -
    Math.max(0, focusShare - 0.55) * 1.5 +
    Math.min(structShare, 0.3) * 1.5 -
    Math.max(0, biggestStructure - 0.3) * 2 -
    Math.max(0, block / n - 0.35) * 1.5 -
    Math.max(0, sky / n - 0.45) -
    (sky / n < 0.06 ? 0.5 : 0)
  );
}

function zoneCamera(scene: Scene, graph: PlanGraph, blocked: Point[][], zone: Room, lightsByZone: Set<string>): GardenCamera {
  const b = bboxOf(zone.polygon);
  const c: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const level = (zone.level_mm ?? 0) / 1000;
  const focus = objectIdsWhere(scene, (o) => o.zoneId === zone.id);
  const structures = objectIdsWhere(scene, (o) => o.category === "structure" && o.zoneId === zone.id);
  const blockers = objectIdsWhere(scene, (o) => o.category === "context" && o.noun !== "ground");
  // Aim near eye level so the horizon stays in frame.
  const targetY = level + (zone.type === "structure" ? 1.4 : structures.size ? 0.9 : 0.8);

  let best = null as { cam: Camera; score: number } | null;
  const heights = [1.65, 2.6];
  for (const eye of heights) {
    // Large zones are best seen from within them; small ones from beside them.
    for (const dist of [extent * 0.9 + 1.5, extent * 1.3 + 2.5, extent * 0.6 + 1, extent * 0.45, extent * 0.3]) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const p: Point = [c[0] + Math.cos(a) * dist, c[1] + Math.sin(a) * dist];
        if (!openGround(graph, blocked, p)) continue;
        const cam: Camera = { pos: [p[0], level + eye, p[1]], target: [c[0], targetY, c[1]], fovDeg: FOV };
        const score = scoreView(scene, cam, focus, structures, blockers) - (eye > 2 ? 0.05 : 0); // prefer eye level
        if (!best || score > best.score + 1e-9) best = { cam, score };
      }
    }
    if (best && best.score > 0.35) break;
  }
  // No open ground round a tiny strip: look down on it from above the nearest open point.
  if (!best) {
    const p: Point = [c[0] + extent + 2, c[1] + extent + 2];
    best = { cam: { pos: [p[0], level + 4, p[1]], target: [c[0], level, c[1]], fovDeg: FOV }, score: 0 };
  }
  return { ...best.cam, id: `zone:${zone.id}`, label: zone.name_en, zoneId: zone.id, lit: lightsByZone.has(zone.id) || zone.type === "structure" };
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
  const blockers = objectIdsWhere(scene, (o) => o.category === "context" && o.noun !== "ground");
  groups.slice(0, 2).forEach((group, gi) => {
    const ids = new Set(group.map((r) => r.id));
    const focus = objectIdsWhere(scene, (o) => o.zoneId !== null && ids.has(o.zoneId));
    const structures = objectIdsWhere(scene, (o) => o.category === "structure" && o.zoneId !== null && ids.has(o.zoneId));
    // The group's main body: its largest zones, so a narrow side courtyard
    // does not drag the view into a wall.
    const body = [...group].sort((a, b) => b.area_m2 - a.area_m2).slice(0, Math.max(3, Math.ceil(group.length / 2)));
    const b = bboxOf(body.flatMap((r) => r.polygon));
    const c: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    const cands: { cam: Camera; score: number; angle: number }[] = [];
    for (let x = b.minX + 0.5; x <= b.maxX - 0.5; x += 0.8) {
      for (let y = b.minY + 0.5; y <= b.maxY - 0.5; y += 0.8) {
        const p: Point = [x, y];
        if (!openGround(graph, blocked, p) || !body.some((z) => inside(p, z.polygon))) continue;
        const d = Math.hypot(c[0] - x, c[1] - y);
        if (d < Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.35) continue; // stand back from the middle
        const cam: Camera = { pos: [x, 3.6, y], target: [c[0], 0.4, c[1]], fovDeg: 64 };
        cands.push({ cam, score: scoreView(scene, cam, focus, structures, blockers), angle: Math.atan2(y - c[1], x - c[0]) });
      }
    }
    cands.sort((a, b2) => b2.score - a.score);
    const want = gi === 0 ? 2 : 1;
    const chosen: typeof cands = [];
    for (const cand of cands) {
      if (chosen.length >= want) break;
      // A second view has to look from a genuinely different side.
      if (chosen.some((ch) => Math.abs(Math.atan2(Math.sin(ch.angle - cand.angle), Math.cos(ch.angle - cand.angle))) < Math.PI * 0.55)) continue;
      chosen.push(cand);
    }
    chosen.forEach((cand, i) => {
      out.push({ ...cand.cam, id: `garden:${names[gi]}-${i + 1}`, label: gi === 0 ? `Whole garden — view ${i + 1}` : "Front garden", zoneId: null, lit: true });
    });
  });
  return out;
}

export function chooseCameras(scene: Scene, graph: PlanGraph, fixtures: readonly GardenFixture[], litZoneIds: ReadonlySet<string>): GardenCamera[] {
  const lit = new Set(litZoneIds);
  const blocked = obstacles(graph, fixtures);
  return [...gardenZones(graph).map((z) => zoneCamera(scene, graph, blocked, z, lit)), ...gardenCameras(scene, graph, blocked)];
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
    const min = o.category === "structure" ? 0.002 : o.category === "planting" ? 0.01 : 0.008;
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
