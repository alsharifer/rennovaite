// =============================================================================
// lib/scene/raster.ts — a deterministic software rasteriser for garden scenes.
//
// Perspective camera, near-plane clipping, z-buffer, flat two-sided Lambert
// shading, object-id buffer, silhouette/crease outlines, 2× supersampling. No
// GPU, no DOM: the same scene and camera always produce the same bytes, which
// is what lets a scene image be a cache key and a geometry authority.
// =============================================================================

import type { LightPoint, MaterialKey, Scene, Vec3 } from "./mesh";
import { MATERIAL_TEXTURE, planarUV, sampleTexture } from "./textures";

export interface Camera {
  pos: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fovDeg: number;
}

export type Lighting = "day" | "evening";

export interface RenderResult {
  width: number;
  height: number;
  /** RGB, row-major. */
  rgb: Uint8Array;
  /** Object id per pixel (0 = sky). */
  ids: Int32Array;
  /** Camera-space depth per pixel, metres (Infinity = sky). */
  depth: Float32Array;
}

const DAY: Record<MaterialKey, [number, number, number]> = {
  ground: [192, 189, 181],
  paving: [227, 216, 198],
  grass: [120, 160, 79],
  soil: [107, 85, 64],
  plant: [94, 127, 67],
  stone: [234, 227, 214],
  timber: [154, 116, 83],
  metal: [78, 75, 71],
  louvre: [122, 90, 64],
  wall: [214, 206, 191],
  building: [242, 237, 228],
  garage: [237, 230, 218],
  steps: [225, 214, 196],
  grill: [46, 46, 46],
  trunk: [106, 79, 55],
  glass: [62, 56, 50],
  slab: [206, 204, 197],
  shed: [150, 153, 156],
};

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

const SUN: V = norm([-0.55, 0.62, 0.56]);
const NEAR = 0.05;

export function cameraBasis(cam: Camera) {
  const f = norm(sub(cam.target, cam.pos));
  let r = cross(f, [0, 1, 0]);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  const u = cross(r, f);
  return { f, r, u };
}

/** Project a world point: screen x/y in pixels and camera depth (metres). */
export function project(cam: Camera, width: number, height: number, p: Vec3): { x: number; y: number; z: number } {
  const { f, r, u } = cameraBasis(cam);
  const v = sub(p, cam.pos);
  const zc = dot(v, f);
  const fpx = height / 2 / Math.tan((cam.fovDeg * Math.PI) / 360);
  return { x: width / 2 + (dot(v, r) / zc) * fpx, y: height / 2 - (dot(v, u) / zc) * fpx, z: zc };
}

export function renderScene(
  scene: Scene,
  cam: Camera,
  width: number,
  height: number,
  opts: { lighting?: Lighting; supersample?: 1 | 2; outlines?: boolean; textured?: boolean } = {},
): RenderResult {
  if (opts.textured) return renderTextured(scene, cam, width, height, opts);
  const ss = opts.supersample ?? 2;
  const W = width * ss;
  const H = height * ss;
  const evening = opts.lighting === "evening";
  const col = new Uint8Array(W * H * 3);
  const zbuf = new Float32Array(W * H); // 1/z, 0 = empty
  const idb = new Int32Array(W * H);

  // Sky.
  const skyTop: V = evening ? [14, 24, 48] : [128, 166, 201];
  const skyLow: V = evening ? [46, 58, 88] : [222, 231, 236];
  for (let y = 0; y < H; y++) {
    const t = Math.min(1, y / (H * 0.6));
    const c: V = [skyTop[0] + (skyLow[0] - skyTop[0]) * t, skyTop[1] + (skyLow[1] - skyTop[1]) * t, skyTop[2] + (skyLow[2] - skyTop[2]) * t];
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      col[i] = c[0];
      col[i + 1] = c[1];
      col[i + 2] = c[2];
    }
  }

  const { f, r, u } = cameraBasis(cam);
  const fpx = H / 2 / Math.tan((cam.fovDeg * Math.PI) / 360);
  const toCam = (p: Vec3): V => {
    const v = sub(p, cam.pos);
    return [dot(v, r), dot(v, u), dot(v, f)];
  };

  for (const t of scene.tris) {
    const ca = toCam(t.a), cb = toCam(t.b), cc = toCam(t.c);
    if (ca[2] < NEAR && cb[2] < NEAR && cc[2] < NEAR) continue;

    // Shade (flat, two-sided).
    let n = norm(cross(sub(t.b, t.a), sub(t.c, t.a)));
    const centre: V = [(t.a[0] + t.b[0] + t.c[0]) / 3, (t.a[1] + t.b[1] + t.c[1]) / 3, (t.a[2] + t.b[2] + t.c[2]) / 3];
    if (dot(n, sub(cam.pos, centre)) < 0) n = [-n[0], -n[1], -n[2]];
    const base = DAY[t.mat];
    const lambert = Math.max(0, dot(n, SUN));
    const k = evening ? 0.16 + 0.08 * lambert : 0.7 + 0.38 * lambert;
    const tint: V = evening ? [0.8, 0.88, 1.15] : [1, 1, 1];
    const shade: V = [Math.min(255, base[0] * k * tint[0]), Math.min(255, base[1] * k * tint[1]), Math.min(255, base[2] * k * tint[2])];

    // Near-plane clip (Sutherland–Hodgman against z >= NEAR).
    const input = [ca, cb, cc];
    const poly: V[] = [];
    for (let i = 0; i < 3; i++) {
      const p = input[i]!, q = input[(i + 1) % 3]!;
      const pin = p[2] >= NEAR, qin = q[2] >= NEAR;
      if (pin) poly.push(p);
      if (pin !== qin) {
        const s = (NEAR - p[2]) / (q[2] - p[2]);
        poly.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, NEAR]);
      }
    }
    const scr = poly.map((p) => [W / 2 + (p[0] / p[2]) * fpx, H / 2 - (p[1] / p[2]) * fpx, 1 / p[2]] as V);
    for (let i = 1; i + 1 < scr.length; i++) rasterTri(scr[0]!, scr[i]!, scr[i + 1]!, shade, t.obj, W, H, col, zbuf, idb);
  }

  if (opts.outlines !== false) outlinePass(W, H, col, zbuf, idb, evening);
  if (evening) glowPass(scene.lights, cam, W, H, fpx, col, zbuf);

  // Downsample.
  const rgb = new Uint8Array(width * height * 3);
  const ids = new Int32Array(width * height);
  const depth = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rr = 0, gg = 0, bb = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * W + (x * ss + sx)) * 3;
          rr += col[i]!;
          gg += col[i + 1]!;
          bb += col[i + 2]!;
        }
      }
      const n2 = ss * ss;
      const o = (y * width + x) * 3;
      rgb[o] = Math.round(rr / n2);
      rgb[o + 1] = Math.round(gg / n2);
      rgb[o + 2] = Math.round(bb / n2);
      const si = (y * ss) * W + x * ss;
      ids[y * width + x] = idb[si]!;
      depth[y * width + x] = zbuf[si]! > 0 ? 1 / zbuf[si]! : Infinity;
    }
  }
  return { width, height, rgb, ids, depth };
}

function rasterTri(a: V, b: V, c: V, shade: V, obj: number, W: number, H: number, col: Uint8Array, zbuf: Float32Array, idb: Int32Array): void {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  if (minX > maxX || minY > maxY) return;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) * inv;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
      const iz = w0 * a[2] + w1 * b[2] + w2 * c[2];
      const idx = y * W + x;
      if (iz <= zbuf[idx]!) continue;
      zbuf[idx] = iz;
      idb[idx] = obj;
      const ci = idx * 3;
      col[ci] = shade[0];
      col[ci + 1] = shade[1];
      col[ci + 2] = shade[2];
    }
  }
}

/** Ink outlines where the object changes or depth jumps — reads as a design model. */
function outlinePass(W: number, H: number, col: Uint8Array, zbuf: Float32Array, idb: Int32Array, evening: boolean): void {
  const mark = new Uint8Array(W * H);
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      const id = idb[i]!;
      for (const j of [i + 1, i + W]) {
        const jd = idb[j]!;
        if (id === 0 && jd === 0) continue;
        const za = zbuf[i]!, zb = zbuf[j]!;
        const jump = za > 0 && zb > 0 ? Math.abs(za - zb) / Math.max(za, zb) > 0.06 : true;
        if (id !== jd || jump) {
          // Mark the nearer pixel so outlines sit on the object in front.
          mark[za >= zb ? i : j] = 1;
        }
      }
    }
  }
  const k = evening ? 0.55 : 0.5;
  for (let i = 0; i < W * H; i++) {
    if (!mark[i]) continue;
    const ci = i * 3;
    col[ci] = col[ci]! * k;
    col[ci + 1] = col[ci + 1]! * k;
    col[ci + 2] = col[ci + 2]! * k;
  }
}

/** Warm glows at the designed light positions that the camera can see. */
function glowPass(lights: readonly LightPoint[], cam: Camera, W: number, H: number, fpx: number, col: Uint8Array, zbuf: Float32Array): void {
  const { f, r, u } = cameraBasis(cam);
  for (const l of lights) {
    const v = sub(l.pos, cam.pos);
    const zc = dot(v, f);
    if (zc < NEAR) continue;
    const sx = W / 2 + (dot(v, r) / zc) * fpx;
    const sy = H / 2 - (dot(v, u) / zc) * fpx;
    if (sx < -200 || sy < -200 || sx > W + 200 || sy > H + 200) continue;
    const cx = Math.round(sx), cy = Math.round(sy);
    // Visible if nothing solid sits clearly in front of the light point.
    if (cx >= 0 && cy >= 0 && cx < W && cy < H) {
      const z = zbuf[cy * W + cx]!;
      if (z > 0 && 1 / z < zc - 0.25) continue;
    }
    const rad = Math.max(6, (l.radius * fpx) / zc) * (l.kind === "downlight" ? 0.7 : 1);
    const warm: V = l.kind === "downlight" ? [255, 214, 160] : [255, 190, 120];
    for (let y = Math.max(0, Math.floor(sy - rad)); y < Math.min(H, Math.ceil(sy + rad)); y++) {
      for (let x = Math.max(0, Math.floor(sx - rad)); x < Math.min(W, Math.ceil(sx + rad)); x++) {
        const d = Math.hypot(x - sx, y - sy) / rad;
        if (d >= 1) continue;
        const a = (1 - d) * (1 - d) * 0.85;
        const ci = (y * W + x) * 3;
        col[ci] = Math.min(255, col[ci]! + warm[0] * a);
        col[ci + 1] = Math.min(255, col[ci + 1]! + warm[1] * a);
        col[ci + 2] = Math.min(255, col[ci + 2]! + warm[2] * a);
      }
    }
  }
}

/** Depth as an 8-bit image, near = white (the convention depth-conditioned models expect). */
export function depthImage(res: RenderResult): Uint8Array {
  let min = Infinity, max = 0;
  for (const d of res.depth) {
    if (!Number.isFinite(d)) continue;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const out = new Uint8Array(res.width * res.height);
  const lo = 1 / Math.max(max, 1e-3), hi = 1 / Math.max(min, 1e-3);
  for (let i = 0; i < out.length; i++) {
    const d = res.depth[i]!;
    out[i] = Number.isFinite(d) ? Math.round(((1 / d - lo) / (hi - lo || 1)) * 235 + 20) : 0;
  }
  return out;
}

// --- Textured mode (G5c) ---------------------------------------------------------
//
// The conditioning image for a styled render: the same geometry and camera as
// the design model, but every surface textured as the material it is (see
// lib/scene/textures.ts), lit by a sun with cast shadows and a sky term, and no
// ink outlines. Object ids and depth are identical to the flat render's, so the
// manifest, the gate and the camera choice are unchanged by it.

/** Sun shadow map: orthographic, over the scene's casters (the ground never casts). */
interface ShadowMap {
  res: number;
  r: V;
  u: V;
  minU: number;
  minV: number;
  scale: number;
  depth: Float32Array;
}

function buildShadowMap(scene: Scene, res = 2048): ShadowMap | null {
  const ground = scene.objects.find((o) => o.key === "ground")?.id ?? -1;
  let r = cross(SUN, [0, 1, 0]);
  r = norm(r);
  const u = norm(cross(r, SUN));
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const casters = scene.tris.filter((t) => t.obj !== ground);
  for (const t of casters) {
    for (const q of [t.a, t.b, t.c]) {
      const a = dot(q, r), b = dot(q, u);
      if (a < minU) minU = a;
      if (a > maxU) maxU = a;
      if (b < minV) minV = b;
      if (b > maxV) maxV = b;
    }
  }
  if (!Number.isFinite(minU)) return null;
  const span = Math.max(maxU - minU, maxV - minV) + 1;
  const scale = res / span;
  const depth = new Float32Array(res * res).fill(-Infinity);
  for (const t of casters) {
    const pts = [t.a, t.b, t.c].map((q) => [(dot(q, r) - minU + 0.5) * scale, (dot(q, u) - minV + 0.5) * scale, dot(q, SUN)] as V);
    const [a, b, c] = pts as [V, V, V];
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(res - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(res - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const d = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const i = y * res + x;
        if (d > depth[i]!) depth[i] = d;
      }
    }
  }
  return { res, r, u, minU, minV, scale, depth };
}

/** 0 = fully shadowed, 1 = sunlit. 3×3 percentage-closer filter. */
function sunlit(sm: ShadowMap | null, p: V, n: V): number {
  if (!sm) return 1;
  // Offset along the normal: a surface never shadows itself.
  const q: V = [p[0] + n[0] * 0.03, p[1] + n[1] * 0.03, p[2] + n[2] * 0.03];
  const x = (dot(q, sm.r) - sm.minU + 0.5) * sm.scale;
  const y = (dot(q, sm.u) - sm.minV + 0.5) * sm.scale;
  const d = dot(q, SUN);
  let lit = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = Math.floor(x) + dx, iy = Math.floor(y) + dy;
      if (ix < 0 || iy < 0 || ix >= sm.res || iy >= sm.res) { lit++; continue; }
      if (sm.depth[iy * sm.res + ix]! <= d + 0.04) lit++;
    }
  }
  return lit / 9;
}

function renderTextured(
  scene: Scene,
  cam: Camera,
  width: number,
  height: number,
  opts: { lighting?: Lighting; supersample?: 1 | 2 },
): RenderResult {
  const ss = opts.supersample ?? 2;
  const W = width * ss;
  const H = height * ss;
  const evening = opts.lighting === "evening";
  const col = new Uint8Array(W * H * 3);
  const zbuf = new Float32Array(W * H);
  const idb = new Int32Array(W * H);
  // Per-pixel attributes resolved after visibility: triangle index + world position.
  const triOf = new Int32Array(W * H).fill(-1);
  const wx = new Float32Array(W * H), wy = new Float32Array(W * H), wz = new Float32Array(W * H);

  // Sky.
  const skyTop: V = evening ? [14, 24, 48] : [110, 156, 204];
  const skyLow: V = evening ? [46, 58, 88] : [214, 228, 238];
  for (let y = 0; y < H; y++) {
    const t = Math.min(1, y / (H * 0.6));
    const c: V = [skyTop[0] + (skyLow[0] - skyTop[0]) * t, skyTop[1] + (skyLow[1] - skyTop[1]) * t, skyTop[2] + (skyLow[2] - skyTop[2]) * t];
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      col[i] = c[0];
      col[i + 1] = c[1];
      col[i + 2] = c[2];
    }
  }

  const { f, r, u } = cameraBasis(cam);
  const fpx = H / 2 / Math.tan((cam.fovDeg * Math.PI) / 360);
  const toCam = (q: Vec3): V => {
    const v = sub(q, cam.pos);
    return [dot(v, r), dot(v, u), dot(v, f)];
  };
  const normals: V[] = new Array(scene.tris.length);

  scene.tris.forEach((t, ti) => {
    const ca = toCam(t.a), cb = toCam(t.b), cc = toCam(t.c);
    if (ca[2] < NEAR && cb[2] < NEAR && cc[2] < NEAR) return;
    let n = norm(cross(sub(t.b, t.a), sub(t.c, t.a)));
    const centre: V = [(t.a[0] + t.b[0] + t.c[0]) / 3, (t.a[1] + t.b[1] + t.c[1]) / 3, (t.a[2] + t.b[2] + t.c[2]) / 3];
    if (dot(n, sub(cam.pos, centre)) < 0) n = [-n[0], -n[1], -n[2]];
    normals[ti] = n;
    const input = [ca, cb, cc];
    const poly: V[] = [];
    for (let i = 0; i < 3; i++) {
      const p = input[i]!, q = input[(i + 1) % 3]!;
      const pin = p[2] >= NEAR, qin = q[2] >= NEAR;
      if (pin) poly.push(p);
      if (pin !== qin) {
        const k = (NEAR - p[2]) / (q[2] - p[2]);
        poly.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, NEAR]);
      }
    }
    // Screen x, y, 1/z, and world position / z for perspective-correct interpolation.
    const scr = poly.map((p) => {
      const w: V = [cam.pos[0] + r[0] * p[0] + u[0] * p[1] + f[0] * p[2], cam.pos[1] + r[1] * p[0] + u[1] * p[1] + f[1] * p[2], cam.pos[2] + r[2] * p[0] + u[2] * p[1] + f[2] * p[2]];
      return [W / 2 + (p[0] / p[2]) * fpx, H / 2 - (p[1] / p[2]) * fpx, 1 / p[2], w[0] / p[2], w[1] / p[2], w[2] / p[2]];
    });
    for (let i = 1; i + 1 < scr.length; i++) {
      const a = scr[0]!, b = scr[i]!, c = scr[i + 1]!;
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      if (minX > maxX || minY > maxY) continue;
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;
      const inv = 1 / area;
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) * inv;
          const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
          const iz = w0 * a[2] + w1 * b[2] + w2 * c[2];
          const idx = y * W + x;
          if (iz <= zbuf[idx]!) continue;
          zbuf[idx] = iz;
          idb[idx] = t.obj;
          triOf[idx] = ti;
          wx[idx] = (w0 * a[3] + w1 * b[3] + w2 * c[3]) / iz;
          wy[idx] = (w0 * a[4] + w1 * b[4] + w2 * c[4]) / iz;
          wz[idx] = (w0 * a[5] + w1 * b[5] + w2 * c[5]) / iz;
        }
      }
    }
  });

  // Shade visible pixels once: base colour × texture × (sky + sun × shadow).
  const sm = evening ? null : buildShadowMap(scene);
  for (let idx = 0; idx < W * H; idx++) {
    const ti = triOf[idx]!;
    if (ti < 0) continue;
    const t = scene.tris[ti]!;
    const n = normals[ti]!;
    const p: V = [wx[idx]!, wy[idx]!, wz[idx]!];
    const base = DAY[t.mat];
    const [tu, tv] = planarUV(p, n);
    const tex = sampleTexture(MATERIAL_TEXTURE[t.mat], tu, tv);
    const lambert = Math.max(0, dot(n, SUN));
    const k = evening ? 0.14 + 0.06 * lambert : 0.52 + 0.62 * lambert * sunlit(sm, p, n) + 0.08 * Math.max(0, n[1]);
    const tint: V = evening ? [0.78, 0.86, 1.15] : [1.02, 1, 0.97];
    const ci = idx * 3;
    col[ci] = Math.min(255, base[0] * tex[0] * k * tint[0]);
    col[ci + 1] = Math.min(255, base[1] * tex[1] * k * tint[1]);
    col[ci + 2] = Math.min(255, base[2] * tex[2] * k * tint[2]);
  }
  if (evening) glowPass(scene.lights, cam, W, H, fpx, col, zbuf);

  const rgb = new Uint8Array(width * height * 3);
  const ids = new Int32Array(width * height);
  const depth = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rr = 0, gg = 0, bb = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * W + (x * ss + sx)) * 3;
          rr += col[i]!;
          gg += col[i + 1]!;
          bb += col[i + 2]!;
        }
      }
      const n2 = ss * ss;
      const o = (y * width + x) * 3;
      rgb[o] = Math.round(rr / n2);
      rgb[o + 1] = Math.round(gg / n2);
      rgb[o + 2] = Math.round(bb / n2);
      const si = (y * ss) * W + x * ss;
      ids[y * width + x] = idb[si]!;
      depth[y * width + x] = zbuf[si]! > 0 ? 1 / zbuf[si]! : Infinity;
    }
  }
  return { width, height, rgb, ids, depth };
}
