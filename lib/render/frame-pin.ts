// =============================================================================
// lib/render/frame-pin.ts — keep google/nano-banana-pro inside the photo's frame
// (bathroom pilot B2b).
//
// nano-banana-pro offers no custom output size — only an aspect enum, and the
// phone photo (946 × 2048, 1 : 2.16) is narrower than any of them. Asked to
// "match the input image" it snapped to 9 : 16 (1536 × 2752) and RECOMPOSED the
// room to fill it: zoomed in, the door gone from P2's wall, the WC and bidet
// enlarged. Layout 2/5 while its style was 5/5 (docs/BATHROOM_PILOT_B2.md).
//
// So the frame is pinned instead of accepted:
//   1. `padToAspect` — the photo is padded to exactly 9 : 16 with mirrored
//      edges, so the model receives a frame it has no reason to recompose;
//   2. the output is mapped back by the pad geometry (`geometricMap`) and, where
//      at least two fixtures are found in both, refined by them (`fitMap` — a
//      uniform scale + offset, least squares over the boxes' edges, accepted
//      only near the geometry: a real recomposition is NOT absorbed, it fails
//      the check);
//   3. `cropToFrame` cuts the photo's frame out of the output; the after boxes
//      are carried into the photo's frame (`toPhotoBoxes`) and the placement
//      check runs there.
// Pure, except the two sharp calls.
// =============================================================================

import sharp from "sharp";

import type { Box, Located } from "./photo-check";

/** nano-banana-pro's nearest portrait aspect to a phone photo. */
export const PRO_ASPECT = 9 / 16;

export interface PadPlan {
  /** The photo, px. */
  w: number;
  h: number;
  /** The padded frame, px. */
  W: number;
  H: number;
  padL: number;
  padT: number;
}

/** How much to pad a w × h photo to reach `aspect` (width / height). */
export function padPlan(w: number, h: number, aspect = PRO_ASPECT): PadPlan {
  if (w / h < aspect) {
    const W = Math.round(h * aspect);
    return { w, h, W, H: h, padL: Math.floor((W - w) / 2), padT: 0 };
  }
  const H = Math.round(w / aspect);
  return { w, h, W: w, H, padL: 0, padT: Math.floor((H - h) / 2) };
}

/** The photo padded to the aspect with mirrored edges (JPEG). */
export async function padToAspect(photo: Uint8Array, aspect = PRO_ASPECT): Promise<{ bytes: Buffer; plan: PadPlan }> {
  const meta = await sharp(Buffer.from(photo)).metadata();
  const plan = padPlan(meta.width!, meta.height!, aspect);
  const bytes = await sharp(Buffer.from(photo))
    .extend({ left: plan.padL, right: plan.W - plan.w - plan.padL, top: plan.padT, bottom: plan.H - plan.h - plan.padT, extendWith: "mirror" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { bytes, plan };
}

/** Photo px → output px: x_o = k·x_p + ox, y_o = k·y_p + oy. */
export interface FrameMap {
  k: number;
  ox: number;
  oy: number;
  /** "fixtures" when refined from matched boxes, else "geometry". */
  source: "geometry" | "fixtures";
  /** Mean distance (output px) of the fitted edges, for the record. */
  residual_px: number | null;
}

/** Where the photo sits in the output if the model kept the padded frame exactly. */
export function geometricMap(plan: PadPlan, out: { width: number; height: number }): FrameMap {
  const k = (out.width / plan.W + out.height / plan.H) / 2;
  return { k, ox: plan.padL * (out.width / plan.W), oy: plan.padT * (out.height / plan.H), source: "geometry", residual_px: null };
}

/** How far a fitted map may sit from the geometry before it is a recomposition, not a frame. */
export const FIT_BOUNDS = { scale: 0.15, offset: 0.1 } as const;

/**
 * Refine the map from the fixtures found in both the photo and the output:
 * least squares on every box edge (x edges for k·x + ox, y edges for k·y + oy,
 * one shared k). Needs two items; returns the geometry otherwise, or when the
 * fit strays past FIT_BOUNDS (a model that zoomed or re-composed must fail the
 * check, not be cropped into passing it).
 */
export function fitMap(before: readonly Located[], afterOut: readonly Located[], photo: { width: number; height: number }, out: { width: number; height: number }, geo: FrameMap): FrameMap {
  const A = new Map(afterOut.filter((l) => l.present && l.box).map((l) => [l.ref, l.box!]));
  const pairs = before.filter((l) => l.present && l.box && A.has(l.ref)).map((l) => ({ p: l.box!, o: A.get(l.ref)! }));
  if (pairs.length < 2) return geo;
  // Points: (photo px, output px) per edge and axis.
  const xs: [number, number][] = [], ys: [number, number][] = [];
  for (const { p, o } of pairs) {
    xs.push([(p[0] / 100) * photo.width, (o[0] / 100) * out.width], [(p[2] / 100) * photo.width, (o[2] / 100) * out.width]);
    ys.push([(p[1] / 100) * photo.height, (o[1] / 100) * out.height], [(p[3] / 100) * photo.height, (o[3] / 100) * out.height]);
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mxp = mean(xs.map((v) => v[0])), mxo = mean(xs.map((v) => v[1])), myp = mean(ys.map((v) => v[0])), myo = mean(ys.map((v) => v[1]));
  let num = 0, den = 0;
  for (const [p, o] of xs) { num += (p - mxp) * (o - mxo); den += (p - mxp) ** 2; }
  for (const [p, o] of ys) { num += (p - myp) * (o - myo); den += (p - myp) ** 2; }
  if (den <= 0) return geo;
  const k = num / den;
  const ox = mxo - k * mxp, oy = myo - k * myp;
  const off = (v: number, g: number, size: number) => Math.abs(v - g) / size;
  if (Math.abs(k - geo.k) / geo.k > FIT_BOUNDS.scale || off(ox, geo.ox, out.width) > FIT_BOUNDS.offset || off(oy, geo.oy, out.height) > FIT_BOUNDS.offset) return geo;
  const res = mean([...xs.map(([p, o]) => Math.abs(k * p + ox - o)), ...ys.map(([p, o]) => Math.abs(k * p + oy - o))]);
  return { k, ox, oy, source: "fixtures", residual_px: Math.round(res * 10) / 10 };
}

/** The photo's frame inside the output, px, clamped to the output. */
export function frameRect(map: FrameMap, photo: { width: number; height: number }, out: { width: number; height: number }): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.round(map.ox)), top = Math.max(0, Math.round(map.oy));
  const width = Math.max(1, Math.min(out.width - left, Math.round(map.k * photo.width)));
  const height = Math.max(1, Math.min(out.height - top, Math.round(map.k * photo.height)));
  return { left, top, width, height };
}

export async function cropToFrame(output: Uint8Array, rect: { left: number; top: number; width: number; height: number }): Promise<Buffer> {
  return sharp(Buffer.from(output)).extract(rect).jpeg({ quality: 92 }).toBuffer();
}

/** After boxes read on the full output (% of the output) → % of the photo's frame. */
export function toPhotoBoxes(afterOut: readonly Located[], map: FrameMap, photo: { width: number; height: number }, out: { width: number; height: number }): Located[] {
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  return afterOut.map((l) => {
    if (!l.present || !l.box) return { ...l, box: null };
    const b = l.box;
    const px = (o: number, axis: "x" | "y") => (axis === "x" ? ((o / 100) * out.width - map.ox) / map.k / photo.width : ((o / 100) * out.height - map.oy) / map.k / photo.height) * 100;
    const box: Box = [clamp(px(b[0], "x")), clamp(px(b[1], "y")), clamp(px(b[2], "x")), clamp(px(b[3], "y"))];
    const visible = box[2] - box[0] >= 0.5 && box[3] - box[1] >= 0.5;
    return { ...l, present: visible, box: visible ? box : null };
  });
}
