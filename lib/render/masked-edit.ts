// =============================================================================
// lib/render/masked-edit.ts — masked per-fixture edits (bathroom pilot B10).
//
// B8: the vanity grows in every arm — the model's prior, not its inputs, so no
// prompt wording beats it reliably. A mask does: the region an edit may touch is
// a fixture's box as the placement check already reads it, the inpainting model
// (black-forest-labs/flux-fill-pro) works only inside it, and the original is
// pasted back everywhere outside — so outside the mask nothing changes, BY
// CONSTRUCTION (not by the model's good behaviour). A fixture cannot grow past
// its box; it can only change inside it.
// =============================================================================

import sharp from "sharp";

import { fetchSceneBytes, runRenderModel } from "@/lib/scene-render/pipeline";

import type { Box } from "./photo-check";

export const MASK_MODEL = "black-forest-labs/flux-fill-pro";

/** A box in % of the frame, padded by `pad` % on every side and clamped to the frame. Pure. */
export function padBox(b: Box, pad: number): Box {
  return [Math.max(0, b[0] - pad), Math.max(0, b[1] - pad), Math.min(100, b[2] + pad), Math.min(100, b[3] + pad)];
}

/**
 * A replacement's box: the old item's footprint, raised to the new item's
 * height (a 1.2 m cabinet where a 0.4 m bidet stood) — the bottom edge, the
 * width and the centre are the old item's. Pure.
 */
export function raiseBox(b: Box, heightRatio: number): Box {
  const h = b[3] - b[1];
  return [b[0], Math.max(0, b[3] - h * Math.max(1, heightRatio)), b[2], b[3]];
}

/** The mask as a PNG: white = may change, black = kept. `invert` keeps the boxes and frees the rest. */
export async function maskPng(size: { width: number; height: number }, boxes: readonly Box[], invert = false): Promise<Buffer> {
  const { width: W, height: H } = size;
  const rects = boxes.map((b) => `<rect x="${(b[0] / 100) * W}" y="${(b[1] / 100) * H}" width="${((b[2] - b[0]) / 100) * W}" height="${((b[3] - b[1]) / 100) * H}" fill="${invert ? "#000" : "#fff"}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${invert ? "#fff" : "#000"}"/>${rects}</svg>`;
  return sharp(Buffer.from(svg)).resize(W, H, { fit: "fill" }).png().toBuffer();
}

/**
 * The edited image inside the mask, the original outside it — the guarantee.
 * The edit is resized to the original's frame first; `feather` px soften only
 * the seam's inner side, so not one pixel outside the mask moves.
 */
export async function compositeInside(original: Uint8Array, edited: Uint8Array, mask: Buffer, feather = 0): Promise<Buffer> {
  const meta = await sharp(original).metadata();
  const W = meta.width!, H = meta.height!;
  const ed = await sharp(edited).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const or = await sharp(original).removeAlpha().raw().toBuffer();
  let m = await sharp(mask).resize(W, H, { fit: "fill" }).removeAlpha().greyscale().raw().toBuffer();
  if (feather > 0) {
    // Erode-then-blur keeps the softened band inside the mask: outside stays 0.
    const blurred = await sharp(m, { raw: { width: W, height: H, channels: 1 } }).blur(feather).extractChannel(0).raw().toBuffer();
    m = Buffer.from(m.map((v, i) => (v === 0 ? 0 : Math.min(v, blurred[i]!))));
  }
  const out = Buffer.alloc(or.length);
  for (let p = 0; p < W * H; p++) {
    const a = m[p]! / 255;
    for (let c = 0; c < 3; c++) out[p * 3 + c] = a === 0 ? or[p * 3 + c]! : Math.round(or[p * 3 + c]! * (1 - a) + ed[p * 3 + c]! * a);
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

/**
 * The edit model a masked change uses. "paste" (google/nano-banana) edits the
 * WHOLE image, so it sees the room and knows what the item is, and only the part
 * inside the mask is kept. "fill" (flux-fill-pro) inpaints only the mask and
 * redraws the whole item from the prompt — live, it turned the oak vanity black
 * when asked for a white top. The two arms are measured against each other in
 * docs/BATHROOM_PILOT_B10.md.
 */
export type MaskedArm = "paste" | "fill";
export const PASTE_MODEL = "google/nano-banana";
export const MASKED_ARM_MODEL: Record<MaskedArm, string> = { paste: PASTE_MODEL, fill: MASK_MODEL };

/**
 * Which arm the masked change uses: MASKED_CHANGE_MODEL = "paste" (the default,
 * measured 20 Oct: the parts of the item the request did not name kept in 5 of
 * 10 against 0 of 10) | "fill" (flux-fill-pro, the B10 first wiring, kept as an
 * option).
 */
export function maskedArm(env: Record<string, string | undefined> = process.env): MaskedArm {
  return env.MASKED_CHANGE_MODEL === "fill" ? "fill" : "paste";
}

const uri = (b: Uint8Array | Buffer, t: string) => `data:${t};base64,${Buffer.from(b).toString("base64")}`;
const typeOf = (b: Uint8Array) => (b[0] === 0x89 ? "image/png" : "image/jpeg");

/** One masked edit: inpaint inside the mask, then paste the original back outside it. */
export async function maskedEdit(image: Uint8Array, mask: Buffer, prompt: string): Promise<{ bytes: Buffer; model: string }> {
  const url = await runRenderModel(MASK_MODEL, { image: uri(image, typeOf(image)), mask: uri(mask, "image/png"), prompt, output_format: "jpg", safety_tolerance: 2 });
  const raw = await fetchSceneBytes(url);
  return { bytes: await compositeInside(image, raw, mask, 3), model: MASK_MODEL };
}

/** Edit the whole image, then keep only the part inside the mask: the original everywhere else. */
export async function editThenPaste(image: Uint8Array, mask: Buffer, prompt: string): Promise<{ bytes: Buffer; model: string }> {
  const url = await runRenderModel(PASTE_MODEL, { prompt, image_input: [uri(image, typeOf(image))], aspect_ratio: "match_input_image", output_format: "jpg" });
  const raw = await fetchSceneBytes(url);
  return { bytes: await compositeInside(image, raw, mask, 3), model: PASTE_MODEL };
}

/** The masked change on either arm. */
export function maskedChange(arm: MaskedArm, image: Uint8Array, mask: Buffer, prompt: string): Promise<{ bytes: Buffer; model: string }> {
  return arm === "paste" ? editThenPaste(image, mask, prompt) : maskedEdit(image, mask, prompt);
}

/**
 * A replacement's box raised to its STATED height, from the check's own reading:
 * the old item's box spans from its top to the floor line, and its `top` share
 * says how much of the wall's floor-to-ceiling height that is — so the wall's
 * height in the frame is the box height over that share, and the new item's top
 * sits at its own share of it (a 1.2 m cabinet on a 2.8 m wall = 0.43). A ×3
 * guess drew the cabinet 1.6–1.7 m tall: the model fills the mask it is given.
 * Pure; without a reading, the box as it is.
 */
export function raiseToTop(b: Box, readTop: number | null | undefined, targetTop: number): Box {
  if (!readTop || readTop <= 0) return b;
  const wall = (b[3] - b[1]) / readTop;
  return [b[0], Math.max(0, Math.min(b[1], b[3] - wall * targetTop)), b[2], b[3]];
}
