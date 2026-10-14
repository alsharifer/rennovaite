// =============================================================================
// lib/render/similarity.ts — did an "Ask for a change" edit change anything?
// (R10a, spec §7.5). SERVER-ONLY (sharp).
//
// The walkthrough's dining room: "Move the kitchen to the left …" came back
// as the same image (SSIM 0.992, 0.0% of pixels moved more than 10%), was
// saved as a new version, and nothing told the owner. A real edit — the
// counter added on the second try — scored SSIM 0.937 with 4.4% of pixels
// changed. Both images are compared at a fixed size in greyscale:
//
//   ssim        mean structural similarity over 8×8 windows of a 256² view
//   changedPct  share of pixels (128² view) whose value moved by > 10%
//   meanDiffPct mean absolute difference, % of full scale
//
// `isUnchangedEdit` is the pure decision: near-identical = SSIM ≥ 0.985 AND
// under 0.5% of pixels changed. Both must hold — a small but real local edit
// (a lamp swapped) moves pixels even when global structure barely moves.
// =============================================================================

import sharp from "sharp";

export interface Similarity {
  ssim: number;
  changedPct: number;
  meanDiffPct: number;
}

export const UNCHANGED_SSIM = 0.985;
export const UNCHANGED_CHANGED_PCT = 0.5;

/** The owner's words when an edit came back the same. */
export const UNCHANGED_MESSAGE = "That change didn’t come through — the image is the same. Try being more specific.";

/** Pure: is this edit result the parent image again? */
export function isUnchangedEdit(s: Similarity): boolean {
  return s.ssim >= UNCHANGED_SSIM && s.changedPct < UNCHANGED_CHANGED_PCT;
}

async function grey(input: Buffer, size: number): Promise<Buffer> {
  return sharp(input).resize(size, size, { fit: "fill" }).greyscale().raw().toBuffer();
}

function windowSsim(a: Buffer, b: Buffer, w: number): number {
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  let total = 0;
  let windows = 0;
  for (let by = 0; by < w; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      let ma = 0;
      let mb = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        ma += a[(by + j) * w + bx + i]!;
        mb += b[(by + j) * w + bx + i]!;
      }
      ma /= 64;
      mb /= 64;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const da = a[(by + j) * w + bx + i]! - ma;
        const db = b[(by + j) * w + bx + i]! - mb;
        va += da * da;
        vb += db * db;
        cov += da * db;
      }
      va /= 64;
      vb /= 64;
      cov /= 64;
      total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
      windows++;
    }
  }
  return total / windows;
}

/** Compare two images (encoded bytes). */
export async function compareImages(a: Buffer, b: Buffer): Promise<Similarity> {
  const [a256, b256, a128, b128] = await Promise.all([grey(a, 256), grey(b, 256), grey(a, 128), grey(b, 128)]);
  let diff = 0;
  let changed = 0;
  for (let i = 0; i < a128.length; i++) {
    const d = Math.abs(a128[i]! - b128[i]!);
    diff += d;
    if (d > 25.5) changed++;
  }
  return {
    ssim: Math.round(windowSsim(a256, b256, 256) * 1000) / 1000,
    changedPct: Math.round((changed / a128.length) * 1000) / 10,
    meanDiffPct: Math.round((diff / a128.length / 2.55) * 10) / 10,
  };
}

/** Fetch two image URLs and compare them. Null when either cannot be read (the edit is then saved as before). */
export async function compareImageUrls(a: string, b: string): Promise<Similarity | null> {
  try {
    const [ra, rb] = await Promise.all([fetch(a), fetch(b)]);
    if (!ra.ok || !rb.ok) return null;
    return await compareImages(Buffer.from(await ra.arrayBuffer()), Buffer.from(await rb.arrayBuffer()));
  } catch {
    return null;
  }
}
