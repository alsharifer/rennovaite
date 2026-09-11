// =============================================================================
// lib/parse/sheet/scale.ts — the drawing's scale, from the drawing.
//
// Cropping to the plan region takes the title block out of frame, so the model
// can no longer read "1:100 @ A2" off it — and should not have to. Scale is not
// an inference: the sheet states the ratio in text and the media box states the
// paper size, and together they fix millimetres per point exactly. On the pilot
// sheet that is 25.4/72 * 100 = 35.278 mm of building per point, which checks
// out against the drawing's own 180 mm and 270 mm wall thicknesses to under 1%.
//
// Pure: takes text lines and a page size, returns a scale. No PDF, no I/O.
// =============================================================================

import type { SheetScale, SheetTextLine } from "./types";

const RATIO_RE = /\b1\s*[:/]\s*(\d{1,4})\b/;

/** Architectural ratios. A bare "1:2" in a note is not a drawing scale, and a
 *  bogus ratio poisons every area downstream, so only these are believed. */
const PLAUSIBLE_RATIOS = new Set([1, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000]);

/** ISO A series, portrait, in millimetres. */
const ISO_A_MM: [string, number, number][] = [
  ["A0", 841, 1189],
  ["A1", 594, 841],
  ["A2", 420, 594],
  ["A3", 297, 420],
  ["A4", 210, 297],
];

const MM_PER_PT = 25.4 / 72;

/** The ISO A size a media box matches, either orientation, within 2 mm. */
export function sheetFormat(pagePt: [number, number]): string | null {
  const w = pagePt[0] * MM_PER_PT;
  const h = pagePt[1] * MM_PER_PT;
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  for (const [name, sMm, lMm] of ISO_A_MM) {
    if (Math.abs(short - sMm) <= 2 && Math.abs(long - lMm) <= 2) return name;
  }
  return null;
}

/**
 * Read the stated scale off the sheet.
 *
 * The ratio is taken from the MOST COMMON plausible one on the page, not the
 * first: a sheet carries its main scale in the title block and again under the
 * drawing title, while a detail callout may state a different one once.
 */
export function readSheetScale(
  lines: SheetTextLine[],
  pagePt: [number, number],
): SheetScale {
  const counts = new Map<number, number>();
  for (const line of lines) {
    const m = RATIO_RE.exec(line.text);
    if (!m) continue;
    const ratio = Number(m[1]);
    if (!PLAUSIBLE_RATIOS.has(ratio)) continue;
    counts.set(ratio, (counts.get(ratio) ?? 0) + 1);
  }
  const format = sheetFormat(pagePt);
  if (counts.size === 0) {
    return { scale: "unknown", ratio: null, mm_per_pt: null, sheet_format: format, source: "unknown" };
  }
  // Most mentions wins; ties go to the larger denominator, which is the sheet
  // scale rather than a blown-up detail.
  const ratio = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
  return {
    scale: `1:${ratio}`,
    ratio,
    mm_per_pt: MM_PER_PT * ratio,
    sheet_format: format,
    source: "text-layer",
  };
}

/** Millimetres of building → PDF points on the sheet. */
export function mmToPt(mm: number, scale: SheetScale): number | null {
  return scale.mm_per_pt && scale.mm_per_pt > 0 ? mm / scale.mm_per_pt : null;
}
