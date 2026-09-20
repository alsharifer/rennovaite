import { describe, expect, it } from "vitest";

import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import { buildPlanGraph } from "@/lib/plan/geometry";
import { chooseCameras } from "@/lib/scene/cameras";
import { buildGardenScene } from "@/lib/scene/garden-scene";
import { MATERIAL_TEXTURE, planarUV, sampleTexture } from "@/lib/scene/textures";
import { renderScene } from "@/lib/scene/raster";

const rec = villa94PlanRecords();
const graph = buildPlanGraph({
  projectId: "p",
  planId: "pl",
  scale: null,
  total_area_m2: rec.rooms.reduce((s, r) => s + r.area_m2, 0),
  rooms: rec.rooms,
  elements: rec.elements,
  unit_to_m: rec.plot.width_m,
  plot: rec.plot,
  source: "user_drawn",
});
const scene = buildGardenScene({ graph, fixtures: rec.fixtures, variants: Object.fromEntries(rec.elements.map((e) => [e.id, e.variant])) });

describe("material textures (G5c)", () => {
  it("tiles paving at the tile size the BoQ prices — 1200 × 600 porcelain", () => {
    // One repeat holds 2×2 tiles, so the repeat is twice the tile: 2.4 × 1.2 m.
    expect(MATERIAL_TEXTURE.paving.repeat).toEqual([2.4, 1.2]);
    const grout = sampleTexture(MATERIAL_TEXTURE.paving, 0, 0);
    const field = sampleTexture(MATERIAL_TEXTURE.paving, 0.6, 0.3);
    // The joint is darker than the tile face, and both stay near the base colour.
    expect(grout[0]).toBeLessThan(field[0]);
    expect(field[0]).toBeGreaterThan(0.85);
    expect(field[0]).toBeLessThan(1.15);
    // A tile face repeats: one tile over (1.2 m) lands on a face again, not a joint.
    expect(sampleTexture(MATERIAL_TEXTURE.paving, 1.8, 0.9)[0]).toBeGreaterThan(grout[0]);
  });

  it("is deterministic and bounded for every material", () => {
    for (const [key, t] of Object.entries(MATERIAL_TEXTURE)) {
      for (const [u, v] of [[0, 0], [0.37, 1.61], [12.5, -3.2]] as [number, number][]) {
        const a = sampleTexture(t, u, v);
        const b = sampleTexture(t, u, v);
        expect(a, key).toEqual(b);
        for (const ch of a) {
          expect(ch, `${key} at ${u},${v}`).toBeGreaterThan(0.3);
          expect(ch, `${key} at ${u},${v}`).toBeLessThan(1.7);
        }
      }
    }
    // Metal and glass are flat by design: a noise map on them would be a lie.
    expect(sampleTexture(MATERIAL_TEXTURE.metal, 3, 4)).toEqual([1, 1, 1]);
  });

  it("maps world metres onto the plane a surface faces, so scale is true everywhere", () => {
    expect(planarUV([2, 0.02, 5], [0, 1, 0])).toEqual([2, 5]); // floor: x, z
    expect(planarUV([2, 1.5, 5], [1, 0, 0])).toEqual([5, 1.5]); // wall facing x: z, y
    expect(planarUV([2, 1.5, 5], [0, 0, -1])).toEqual([2, 1.5]); // wall facing z: x, y
  });
});

describe("the textured conditioning image (G5c)", () => {
  const cam = chooseCameras(scene, graph, rec.fixtures, new Set()).find((c) => c.id === "zone:z-pergola")!;
  const flat = renderScene(scene, cam, 200, 140, { supersample: 1 });
  const textured = renderScene(scene, cam, 200, 140, { supersample: 1, textured: true });

  it("keeps the geometry authority: identical object ids and depth, per pixel", () => {
    expect([...textured.ids]).toEqual([...flat.ids]);
    expect([...textured.depth]).toEqual([...flat.depth]);
  });

  it("shows material and sunlight where the flat model shows one colour per surface", () => {
    const spread = (img: Uint8Array, ids: Int32Array, id: number) => {
      const vals: number[] = [];
      for (let i = 0; i < ids.length; i++) if (ids[i] === id) vals.push(img[i * 3]!);
      return vals.length > 20 ? Math.max(...vals) - Math.min(...vals) : null;
    };
    const paved = scene.objects.find((o) => o.category === "surface" && o.noun === "paving")!;
    const flatSpread = spread(flat.rgb, flat.ids, paved.id);
    const texSpread = spread(textured.rgb, textured.ids, paved.id);
    expect(texSpread).not.toBeNull();
    expect(texSpread!).toBeGreaterThan((flatSpread ?? 0) + 8);
  });

  it("renders the same bytes every time", () => {
    const again = renderScene(scene, cam, 200, 140, { supersample: 1, textured: true });
    expect(Buffer.from(again.rgb).equals(Buffer.from(textured.rgb))).toBe(true);
  });
});
