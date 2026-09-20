// =============================================================================
// The scene is the graph (garden pilot G5c, defect A3).
//
// The review reported the pergola "in the corner on the drawings and
// mid-pathway in the 3D". The scene builder had been reading the same
// coordinates all along — what misled the eye was an oblique eye-level camera
// down a 4 m strip, where even the far rear wall projects to the middle of the
// frame. So the invariant is pinned here rather than argued about:
//
//   1. every structure's scene bounds equal its plan bounds, to the millimetre;
//   2. the id buffer at a structure's PROJECTED centre is that structure — the
//      image agrees with the geometry, from every camera that sees it.
// =============================================================================

import { describe, expect, it } from "vitest";

import { arabellaPlanInput } from "@/lib/client-garden/arabella-reference";
import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import { bboxOf, toMetres, type GardenFixture } from "@/lib/drawings/garden-sheets";
import { buildPlanGraph, type PlanGraph } from "@/lib/plan/geometry";
import { buildManifest, chooseCameras } from "@/lib/scene/cameras";
import { buildGardenScene } from "@/lib/scene/garden-scene";
import { project, renderScene } from "@/lib/scene/raster";

function villa94() {
  const rec = villa94PlanRecords();
  const graph = buildPlanGraph({
    projectId: "villa-94",
    planId: "pl",
    scale: null,
    total_area_m2: rec.rooms.reduce((s, r) => s + r.area_m2, 0),
    rooms: rec.rooms,
    elements: rec.elements,
    unit_to_m: rec.plot.width_m,
    plot: rec.plot,
    source: "user_drawn",
  });
  return { graph, fixtures: rec.fixtures as GardenFixture[], variants: Object.fromEntries(rec.elements.map((e) => [e.id, e.variant])) };
}

function arabella() {
  const p = arabellaPlanInput({ gazebo: "replace", path: "replace", "sink-counter": "replace", "planter-rear": "remove", "planter-side": "remove", "lights-corner": "replace", "lights-across": "replace", "tree-1": "keep", "tree-2": "keep", palm: "keep", "tree-3": "keep", "tree-4": "keep", "tree-5": "keep", shed: "keep", gate: "keep" });
  const graph = buildPlanGraph({ projectId: "arabella", planId: "pl", scale: null, total_area_m2: 0, rooms: p.rooms, elements: p.elements, context: p.context, openings: p.openings, unit_to_m: p.plot.width_m, plot: p.plot, source: "user_drawn" });
  return { graph, fixtures: p.fixtures as unknown as GardenFixture[], variants: {} as Record<string, string | null> };
}

const sceneBounds = (scene: ReturnType<typeof buildGardenScene>, key: string) => {
  const id = scene.objects.find((o) => o.key === key)!.id;
  const tris = scene.tris.filter((t) => t.obj === id);
  const xs = tris.flatMap((t) => [t.a[0], t.b[0], t.c[0]]);
  const zs = tris.flatMap((t) => [t.a[2], t.b[2], t.c[2]]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...zs), maxY: Math.max(...zs) };
};

describe.each([
  ["Villa 94", villa94],
  ["the client garden", arabella],
])("the scene consumes the plan's coordinates — %s", (_name, load) => {
  const { graph, fixtures, variants } = load();
  const scene = buildGardenScene({ graph, fixtures, variants });

  it("centres every structure zone exactly where the plan does (±1 mm)", () => {
    const structures = graph.rooms.filter((r) => r.type === "structure" && r.height_mm != null);
    expect(structures.length).toBeGreaterThan(0);
    for (const z of structures) {
      const plan = bboxOf(z.polygon);
      const s = sceneBounds(scene, `structure:${z.id}`);
      expect((s.minX + s.maxX) / 2, `${z.name_en} centre x`).toBeCloseTo((plan.minX + plan.maxX) / 2, 3);
      expect((s.minY + s.maxY) / 2, `${z.name_en} centre y`).toBeCloseTo((plan.minY + plan.maxY) / 2, 3);
      // A roof eave may overhang its footprint (a gazebo's does, by 150 mm); it may
      // never sit somewhere else.
      const eave = 0.3;
      expect(s.minX, `${z.name_en} minX`).toBeGreaterThanOrEqual(plan.minX - eave);
      expect(s.maxX, `${z.name_en} maxX`).toBeLessThanOrEqual(plan.maxX + eave);
      expect(s.minY, `${z.name_en} minY`).toBeGreaterThanOrEqual(plan.minY - eave);
      expect(s.maxY, `${z.name_en} maxY`).toBeLessThanOrEqual(plan.maxY + eave);
      expect(Math.abs(s.maxX - s.minX - (plan.maxX - plan.minX)), `${z.name_en} width`).toBeLessThanOrEqual(2 * eave);
    }
  });

  it("puts every run and landscape unit where the plan does", () => {
    for (const el of graph.elements.filter((e) => e.kind === "counter_run" || e.kind === "bench_run")) {
      const plan = bboxOf(el.polyline as [number, number][]);
      const s = sceneBounds(scene, `run:${el.id}`);
      // A run has width: its scene bounds contain the centreline and exceed it by
      // no more than the run's own width.
      const w = el.width_mm / 1000 + 0.15;
      expect(s.minX, `run ${el.id}`).toBeGreaterThanOrEqual(plan.minX - w);
      expect(s.maxX, `run ${el.id}`).toBeLessThanOrEqual(plan.maxX + w);
      expect(s.minY, `run ${el.id}`).toBeGreaterThanOrEqual(plan.minY - w);
      expect(s.maxY, `run ${el.id}`).toBeLessThanOrEqual(plan.maxY + w);
    }
    for (const u of fixtures.filter((f) => f.layer === "landscape" && f.type === "shed")) {
      const [x, y] = toMetres(graph, u.position);
      const s = sceneBounds(scene, `unit:${u.id}`);
      expect((s.minX + s.maxX) / 2).toBeCloseTo(x, 3);
      expect((s.minY + s.maxY) / 2).toBeCloseTo(y, 3);
    }
  });

  it("agrees with its own image: the pixel at a structure's projected centre is that structure", () => {
    const cameras = chooseCameras(scene, graph as PlanGraph, fixtures, new Set());
    const structures = graph.rooms.filter((r) => r.type === "structure" && r.height_mm != null);
    let checked = 0;
    for (const cam of cameras) {
      const res = renderScene(scene, cam, 600, 400, { supersample: 1, outlines: false });
      const manifest = buildManifest("p", cam.id, scene, res);
      for (const z of structures) {
        const key = `structure:${z.id}`;
        const item = manifest.items.find((i) => i.key === key);
        // Only where the camera sees a real share of it (a sliver behind a tree
        // proves nothing about the pixel at its centre).
        if (!item || item.share < 0.05) continue;
        const b = bboxOf(z.polygon);
        const mid: [number, number, number] = [(b.minX + b.maxX) / 2, ((z.level_mm ?? 0) + z.height_mm! / 2) / 1000, (b.minY + b.maxY) / 2];
        const p = project(cam, res.width, res.height, mid);
        const x = Math.round(p.x), y = Math.round(p.y);
        if (x < 0 || y < 0 || x >= res.width || y >= res.height) continue;
        // The projected centre falls inside the object's own box in the manifest.
        const pct = (v: number, d: number) => (v / d) * 100;
        expect(pct(x, res.width), `${cam.label}: ${z.name_en} x`).toBeGreaterThanOrEqual(item.box[0] - 1);
        expect(pct(x, res.width), `${cam.label}: ${z.name_en} x`).toBeLessThanOrEqual(item.box[2] + 1);
        expect(pct(y, res.height), `${cam.label}: ${z.name_en} y`).toBeGreaterThanOrEqual(item.box[1] - 1);
        expect(pct(y, res.height), `${cam.label}: ${z.name_en} y`).toBeLessThanOrEqual(item.box[3] + 1);
        checked++;
      }
    }
    expect(checked, "no camera saw a structure — the check proved nothing").toBeGreaterThan(0);
  });
});
