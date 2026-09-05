import { describe, expect, it } from "vitest";

import {
  DERIVED_WALL_OPACITY,
  floorFinishForRoom,
  materialCacheKey,
  surfaceMaterialSpec,
  wallFinishForRoom,
  type MaterialSpecInput,
  type Quality,
} from "../materials";

// These pin the appearance rules that CARRY MEANING, as opposed to the ones
// that are only taste.
//
// The derived-wall opacity is the reason this file exists. It was dropped
// during F1 and unsurveyed walls rendered solid — silently claiming to have
// been measured — and nothing failed, because the value lived inside a React
// hook where no test could see it. A viewer that overstates its own certainty
// is worse than one that looks plain.

const base = (over: Partial<MaterialSpecInput> = {}): MaterialSpecInput => ({
  finish: null,
  clayColor: "#F4EFE6",
  kind: "wall",
  highlight: "none",
  quality: "textured",
  ...over,
});

const QUALITIES: Quality[] = ["textured", "flat"];

describe("derived walls render translucent", () => {
  it("is translucent with the flag OFF (no finish, either quality)", () => {
    for (const quality of QUALITIES) {
      const spec = surfaceMaterialSpec(base({ derived: true, quality }));
      expect(spec.transparent, quality).toBe(true);
      expect(spec.opacity, quality).toBe(DERIVED_WALL_OPACITY);
      expect(spec.opacity, quality).toBeLessThan(1);
    }
  });

  it("is translucent with the flag ON, for every finish it can carry", () => {
    // A tiled surface is not evidence that anybody measured the wall under it,
    // so a finish must never buy a derived wall its opacity back.
    const finishes = [
      wallFinishForRoom("luxe-minimal", "bedroom"),
      wallFinishForRoom("luxe-minimal", "bathroom"),
      wallFinishForRoom("modern-hijazi", "bedroom"),
      wallFinishForRoom("andalusian-heritage", "living"),
    ];
    for (const finish of finishes) {
      expect(finish).not.toBeNull();
      for (const quality of QUALITIES) {
        const spec = surfaceMaterialSpec(base({ derived: true, finish, quality }));
        expect(spec.transparent, `${finish!.family}/${quality}`).toBe(true);
        expect(spec.opacity, `${finish!.family}/${quality}`).toBe(DERIVED_WALL_OPACITY);
      }
    }
  });

  it("stays translucent while selected or hovered", () => {
    for (const highlight of ["none", "hover", "selected"] as const) {
      const spec = surfaceMaterialSpec(base({ derived: true, highlight }));
      expect(spec.opacity, highlight).toBe(DERIVED_WALL_OPACITY);
    }
  });

  it("leaves surveyed walls fully opaque", () => {
    for (const quality of QUALITIES) {
      const spec = surfaceMaterialSpec(base({ derived: false, quality }));
      expect(spec.transparent, quality).toBe(false);
      expect(spec.opacity, quality).toBe(1);
    }
  });

  it("gives a derived wall a different material than a surveyed one", () => {
    // If the cache key ignored `derived`, one would silently reuse the other's
    // material and the distinction would vanish at render time.
    const derived = materialCacheKey(surfaceMaterialSpec(base({ derived: true })));
    const surveyed = materialCacheKey(surfaceMaterialSpec(base({ derived: false })));
    expect(derived).not.toBe(surveyed);
  });
});

describe("flag-off reproduces the pre-F1 clay material exactly", () => {
  // Values read off the P3 viewer before F1 touched it. If a future change
  // drifts them, flag-off stops being "the viewer people already know".
  it("floors: roughness 0.95, double-sided, glow 0 / 0.15 / 0.35", () => {
    const floor = (highlight: MaterialSpecInput["highlight"]) =>
      surfaceMaterialSpec(base({ kind: "floor", clayColor: "#EDE6D8", highlight }));
    expect(floor("none").roughness).toBe(0.95);
    expect(floor("none").doubleSided).toBe(true);
    expect(floor("none").color).toBe("#EDE6D8");
    expect(floor("none").emissiveIntensity).toBe(0);
    expect(floor("hover").emissiveIntensity).toBe(0.15);
    expect(floor("selected").emissiveIntensity).toBe(0.35);
  });

  it("walls: roughness 0.9, single-sided, glow 0 / 0.12 / 0.3", () => {
    const wall = (highlight: MaterialSpecInput["highlight"]) =>
      surfaceMaterialSpec(base({ kind: "wall", highlight }));
    expect(wall("none").roughness).toBe(0.9);
    expect(wall("none").doubleSided).toBe(false);
    expect(wall("none").emissiveIntensity).toBe(0);
    expect(wall("hover").emissiveIntensity).toBe(0.12);
    expect(wall("selected").emissiveIntensity).toBe(0.3);
  });

  it("never maps a texture when there is no finish, at either quality", () => {
    for (const quality of QUALITIES) {
      for (const kind of ["floor", "wall"] as const) {
        expect(surfaceMaterialSpec(base({ kind, quality })).textureFamily, `${kind}/${quality}`).toBeNull();
      }
    }
  });
});

describe("quality toggle", () => {
  it("drops the texture but keeps the colour", () => {
    const finish = floorFinishForRoom("modern-hijazi", "bedroom")!;
    const textured = surfaceMaterialSpec(base({ kind: "floor", finish, quality: "textured" }));
    const flat = surfaceMaterialSpec(base({ kind: "floor", finish, quality: "flat" }));
    expect(textured.textureFamily).toBe("wood");
    expect(flat.textureFamily).toBeNull();
    expect(flat.color).toBe(textured.color);
  });

  it("keys the two qualities apart so one cannot reuse the other's material", () => {
    const finish = floorFinishForRoom("modern-hijazi", "bedroom")!;
    const a = materialCacheKey(surfaceMaterialSpec(base({ kind: "floor", finish, quality: "textured" })));
    const b = materialCacheKey(surfaceMaterialSpec(base({ kind: "floor", finish, quality: "flat" })));
    expect(a).not.toBe(b);
  });

  it("shares one material between surfaces that look identical", () => {
    const finish = wallFinishForRoom("luxe-minimal", "bathroom");
    const a = materialCacheKey(surfaceMaterialSpec(base({ finish, derived: true })));
    const b = materialCacheKey(surfaceMaterialSpec(base({ finish, derived: true })));
    expect(a).toBe(b);
  });

  it("keys highlight states apart so selecting one surface cannot light another", () => {
    const none = materialCacheKey(surfaceMaterialSpec(base({ highlight: "none" })));
    const sel = materialCacheKey(surfaceMaterialSpec(base({ highlight: "selected" })));
    expect(none).not.toBe(sel);
  });
});
