// =============================================================================
// lib/viewer/textures.ts — the curated texture set for the walkthrough (F1).
//
// CLIENT ONLY (needs a canvas). One tileable texture per finish FAMILY, drawn
// procedurally at module scope and cached — never per project, never per room,
// never fetched. Six families means at most six textures for the whole scene,
// whatever the villa contains.
//
// Drawn rather than shipped as image files for three reasons: no binary assets
// in the repo, no network request that can fail mid-walkthrough, and the tile
// is seamless by construction because the drawing wraps by design.
//
// These are grain and grout hints under a flat base colour, not photographic
// materials. The viewer stays a clay model with finishes read onto it — it is
// not pretending to be a render, and the render pipeline remains the place a
// photoreal answer comes from.
// =============================================================================

import * as THREE from "three";

import type { FinishFamily } from "./materials";

/** Texture resolution. 512² × ~6 families ≈ 6 MB of VRAM with mipmaps — a
 *  rounding error next to one render, and sharp enough at walking distance. */
const SIZE = 512;

/** World metres covered by one texture repeat, per family. */
const REPEAT_M: Record<FinishFamily, number> = {
  tile: 0.6,
  wood: 1.2,
  stone: 2.4,
  plaster: 1.5,
  paint: 1,
};

function canvas(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d")!;
  return { c, ctx };
}

/** Deterministic value noise — same texture every load, no Math.random. */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function drawTile(ctx: CanvasRenderingContext2D): void {
  // 2×2 tiles per repeat with a recessed grout line. Drawing the grout at the
  // canvas edges as half-width keeps the repeat seamless.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const grout = Math.max(2, Math.round(SIZE * 0.012));
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  for (const p of [0, SIZE / 2]) {
    ctx.fillRect(p - grout / 2, 0, grout, SIZE);
    ctx.fillRect(0, p - grout / 2, SIZE, grout);
  }
  // Faint per-tile tonal variation so a wall of tile is not a flat field.
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const v = hash(i, j);
      ctx.fillStyle = `rgba(0,0,0,${(v * 0.035).toFixed(3)})`;
      ctx.fillRect(i * (SIZE / 2) + grout, j * (SIZE / 2) + grout, SIZE / 2 - grout * 2, SIZE / 2 - grout * 2);
    }
  }
}

function drawWood(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Four board runs with a seam between them, grain along the board.
  const boards = 4;
  const bh = SIZE / boards;
  for (let b = 0; b < boards; b++) {
    const y0 = b * bh;
    ctx.fillStyle = `rgba(0,0,0,${(0.02 + hash(b, 7) * 0.045).toFixed(3)})`;
    ctx.fillRect(0, y0, SIZE, bh);
    ctx.strokeStyle = "rgba(0,0,0,0.14)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y0 + 0.5);
    ctx.lineTo(SIZE, y0 + 0.5);
    ctx.stroke();
    // Grain: low-amplitude sine streaks that start and end at the same phase,
    // so the left and right edges match.
    for (let g = 0; g < 14; g++) {
      const gy = y0 + ((g + 0.5) / 14) * bh;
      const amp = 1 + hash(b, g) * 2.2;
      const cycles = 1 + Math.floor(hash(g, b) * 3);
      ctx.strokeStyle = `rgba(0,0,0,${(0.03 + hash(g, b + 3) * 0.05).toFixed(3)})`;
      ctx.lineWidth = 0.8 + hash(b + g, 1) * 0.9;
      ctx.beginPath();
      for (let x = 0; x <= SIZE; x += 4) {
        const y = gy + Math.sin((x / SIZE) * Math.PI * 2 * cycles) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

function drawStone(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Soft veining: wrapped sine bands, low contrast — book-matched slab reads as
  // large and calm, so the repeat is long (2.4 m) and the marks are faint.
  for (let v = 0; v < 9; v++) {
    const cycles = 1 + Math.floor(hash(v, 11) * 2);
    const off = hash(v, 5) * SIZE;
    const amp = 12 + hash(v, 2) * 26;
    ctx.strokeStyle = `rgba(0,0,0,${(0.018 + hash(v, 9) * 0.03).toFixed(3)})`;
    ctx.lineWidth = 1 + hash(v, 4) * 3.5;
    ctx.beginPath();
    for (let x = 0; x <= SIZE; x += 6) {
      const y = (off + Math.sin((x / SIZE) * Math.PI * 2 * cycles) * amp + SIZE) % SIZE;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawPlaster(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Hand-trowelled mottle: overlapping soft blobs on a wrapped grid.
  const step = 32;
  for (let y = 0; y < SIZE; y += step) {
    for (let x = 0; x < SIZE; x += step) {
      const v = hash(x, y);
      const r = step * (0.5 + v * 0.9);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.012 + v * 0.03;
      g.addColorStop(0, `rgba(0,0,0,${a.toFixed(3)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}

const DRAW: Record<FinishFamily, ((ctx: CanvasRenderingContext2D) => void) | null> = {
  tile: drawTile,
  wood: drawWood,
  stone: drawStone,
  plaster: drawPlaster,
  paint: null, // flat emulsion has no texture — a noise map would be a lie
};

const cache = new Map<FinishFamily, THREE.CanvasTexture | null>();

/**
 * The tileable texture for a family, or null for families that are genuinely
 * flat. Cached process-wide: every room sharing a family shares one GPU upload.
 */
export function familyTexture(family: FinishFamily): THREE.CanvasTexture | null {
  if (cache.has(family)) return cache.get(family)!;
  const draw = DRAW[family];
  if (!draw || typeof document === "undefined") {
    cache.set(family, null);
    return null;
  }
  const { c, ctx } = canvas();
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4; // capped deliberately — 16 costs fill rate for little gain
  cache.set(family, tex);
  return tex;
}

/** World metres per texture repeat, for the metric-UV pass below. */
export function repeatMetres(family: FinishFamily): number {
  return REPEAT_M[family] || 1;
}

/**
 * Rewrite a geometry UV set so one texture repeat covers `metres` of WORLD
 * space, whatever the surface size.
 *
 * This is why there is exactly one texture per family and no per-mesh clones:
 * tiling lives in the vertex data, not in `texture.repeat`, so every tiled
 * surface in the villa shares a single GPU upload. It also fixes the thing that
 * looks wrong immediately if you skip it — a small bathroom and a large majlis
 * showing different-sized tiles, which reads as a bug rather than a finish.
 *
 * Per vertex, the two axes least aligned with the surface normal become u and
 * v. That handles box faces and floor polygons with the same code, and keeps
 * grout lines continuous across a wall corner.
 */
export function applyMetricUVs(geom: THREE.BufferGeometry, metres: number): void {
  const pos = geom.attributes.position;
  const nrm = geom.attributes.normal;
  if (!pos || !nrm) return;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = z; v = y; }        // facing X -> ZY
    else if (ay >= ax && ay >= az) { u = x; v = z; }   // facing Y -> XZ (floors)
    else { u = x; v = y; }                             // facing Z -> XY
    uv[i * 2] = u / metres;
    uv[i * 2 + 1] = v / metres;
  }
  geom.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** Free every cached texture. Called when the walkthrough unmounts. */
export function disposeTextures(): void {
  for (const t of cache.values()) t?.dispose();
  cache.clear();
}
