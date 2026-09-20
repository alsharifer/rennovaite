// =============================================================================
// lib/scene/textures.ts — material textures for the server scene renderer
// (garden pilot G5c).
//
// A flat-shaded design model is a poor conditioning image: an image model reads a
// beige polygon as "some ground" and invents the rest, which is where paved lawns
// and shade-sail pergolas come from. The textured model shows what each surface
// IS — tile joints at the tile size, grass blades, mulch, foliage masses, louvre
// blades — so the restyle paints materials onto a surface that already reads as
// that material, at the right scale.
//
// The four building-finish recipes are the walkthrough's own
// (lib/viewer/textures.ts, F1): tile with a recessed grout line, wood boards
// with grain, stone veining, hand-trowelled plaster mottle, at the same repeat
// lengths. That module draws onto a canvas for three.js and cannot run on the
// server, so the same patterns are expressed here as pure functions of world
// metres. The garden families (grass, mulch, foliage, louvre) are added here.
//
// Everything is deterministic — the same scene renders the same pixels, which
// is what makes the conditioning image a cache key.
// =============================================================================

import type { MaterialKey } from "./mesh";

export type TextureFamily = "tile" | "wood" | "stone" | "plaster" | "grass" | "mulch" | "foliage" | "louvre" | "bark" | "none";

export interface MaterialTexture {
  family: TextureFamily;
  /** Metres per repeat along u and v. For tile: one repeat holds 2×2 tiles. */
  repeat: [number, number];
  /** Strength of the pattern, 0..1. */
  strength: number;
}

/**
 * Material → texture. Paving is large-format porcelain 1200 × 600 (the rate
 * book's tile), so one tile repeat is 2.4 × 1.2 m. Walls and buildings are
 * rendered masonry (plaster); the counter and bench are clad stone.
 */
export const MATERIAL_TEXTURE: Record<MaterialKey, MaterialTexture> = {
  ground: { family: "stone", repeat: [4, 4], strength: 0.5 },
  paving: { family: "tile", repeat: [2.4, 1.2], strength: 1 },
  grass: { family: "grass", repeat: [1, 1], strength: 1 },
  soil: { family: "mulch", repeat: [0.8, 0.8], strength: 1 },
  plant: { family: "foliage", repeat: [0.7, 0.7], strength: 1 },
  stone: { family: "stone", repeat: [2.4, 2.4], strength: 1 },
  timber: { family: "wood", repeat: [1.2, 1.2], strength: 1 },
  metal: { family: "none", repeat: [1, 1], strength: 0 },
  louvre: { family: "louvre", repeat: [0.12, 1], strength: 1 },
  wall: { family: "plaster", repeat: [1.5, 1.5], strength: 1 },
  building: { family: "plaster", repeat: [1.5, 1.5], strength: 0.8 },
  garage: { family: "plaster", repeat: [1.5, 1.5], strength: 0.8 },
  steps: { family: "tile", repeat: [1.2, 1.2], strength: 0.8 },
  grill: { family: "none", repeat: [1, 1], strength: 0 },
  trunk: { family: "bark", repeat: [0.4, 0.4], strength: 1 },
  glass: { family: "none", repeat: [1, 1], strength: 0 },
  slab: { family: "stone", repeat: [1.2, 1.2], strength: 0.6 },
  shed: { family: "louvre", repeat: [0.2, 1], strength: 0.35 },
};

/** Deterministic value hash — the walkthrough's, so both patterns agree. */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

const fract = (v: number) => v - Math.floor(v);

/** Smooth value noise in [0,1]. */
function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves = 3): number {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise(x * f, y * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return v / (1 - Math.pow(0.5, octaves));
}

/**
 * Sample a texture at world-metre coordinates (u, v): a multiplier on the base
 * colour, per channel. 1 = base colour; below darkens (grout, grain, shadowed
 * blades), above lightens.
 */
export function sampleTexture(t: MaterialTexture, u: number, v: number): [number, number, number] {
  if (t.family === "none" || t.strength <= 0) return [1, 1, 1];
  const k = t.strength;
  const pu = u / t.repeat[0], pv = v / t.repeat[1];
  let m: [number, number, number];
  switch (t.family) {
    case "tile": {
      // 2×2 tiles per repeat, recessed grout (the walkthrough: 1.2% of the repeat).
      const gu = fract(pu * 2), gv = fract(pv * 2);
      const grout = 0.012 * 2;
      const inGrout = gu < grout / 2 || gu > 1 - grout / 2 || gv < grout / 2 || gv > 1 - grout / 2;
      const tile = hash(Math.floor(pu * 2), Math.floor(pv * 2));
      const speck = (noise(u * 40, v * 40) - 0.5) * 0.05;
      const g = inGrout ? 0.72 : 1 - tile * 0.05 + speck;
      m = [g, g, g];
      break;
    }
    case "wood": {
      const board = Math.floor(pv * 4);
      const bv = fract(pv * 4);
      const seam = bv < 0.02 ? 0.82 : 1;
      const grain = Math.sin((pu + hash(board, 7)) * Math.PI * 2 * (1 + Math.floor(hash(board, 3) * 3)) + noise(u * 3, v * 30) * 2) * 0.04;
      const g = seam * (1 - hash(board, 7) * 0.06 + grain);
      m = [g, g * 0.99, g * 0.97];
      break;
    }
    case "stone": {
      const vein = Math.abs(Math.sin((pu + fbm(pu * 2, pv * 2) * 0.8) * Math.PI * 3));
      const g = 1 - (1 - vein) * 0.06 - (fbm(u * 6, v * 6) - 0.5) * 0.06;
      m = [g, g, g];
      break;
    }
    case "plaster": {
      const g = 1 - (fbm(pu * 6, pv * 6) - 0.5) * 0.08;
      m = [g, g, g];
      break;
    }
    case "grass": {
      // Fine blades, clumps, and a faint mowing stripe along u every 1.2 m.
      const blade = noise(u * 55, v * 90);
      const clump = fbm(u * 1.5, v * 1.5);
      const stripe = Math.sin((u / 1.2) * Math.PI) > 0 ? 1.03 : 0.97;
      const g = (0.82 + blade * 0.3) * (0.9 + clump * 0.2) * stripe;
      m = [g * 0.96, g, g * 0.9];
      break;
    }
    case "mulch": {
      const grain = noise(u * 38, v * 38);
      const clump = fbm(u * 3, v * 3);
      const g = 0.78 + grain * 0.32 + (clump - 0.5) * 0.15;
      m = [g, g * 0.97, g * 0.93];
      break;
    }
    case "foliage": {
      // Leaf clusters: bright tips over dark gaps, with a yellow-green shift.
      const leaf = noise(u * 22, v * 22);
      const cluster = fbm(u * 5, v * 5);
      const g = 0.65 + leaf * 0.45 + (cluster - 0.5) * 0.3;
      m = [g * (0.95 + cluster * 0.1), g, g * 0.85];
      break;
    }
    case "louvre": {
      const b = fract(pu);
      const g = b < 0.15 ? 0.7 : b > 0.85 ? 1.12 : 1;
      m = [g, g, g];
      break;
    }
    case "bark": {
      const g = 0.85 + noise(u * 8, v * 60) * 0.3;
      m = [g, g, g];
      break;
    }
  }
  return [1 + (m[0] - 1) * k, 1 + (m[1] - 1) * k, 1 + (m[2] - 1) * k];
}

/**
 * World-metre texture coordinates for a point on a triangle with normal n:
 * project on the plane the triangle most faces, so every surface tiles at true
 * scale without authored UVs (the walkthrough's metric-UV pass, per pixel).
 */
export function planarUV(p: readonly [number, number, number], n: readonly [number, number, number]): [number, number] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0], p[2]];
  if (ax >= az) return [p[2], p[1]];
  return [p[0], p[1]];
}
