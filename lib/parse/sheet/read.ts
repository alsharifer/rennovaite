// =============================================================================
// lib/parse/sheet/read.ts — read a PDF as a CAD sheet, or decline to.
//
// One entry point, one rule: this either returns a usable reading of a vector
// sheet, or it returns null and the parse proceeds exactly as it did before. It
// never half-succeeds. A scan, a photo saved as a PDF, a page whose plan we
// cannot find, a build where the WASM will not load — all null.
// =============================================================================

import { extractRoomLabels } from "./labels";
import { extractSheet, MIN_TEXT_LAYER_CHARS, rasterizeRegion } from "./pdf";
import { detectPlanRegion } from "./region";
import { readSheetScale } from "./scale";
import type { SheetReading } from "./types";

/** A sheet with fewer tagged rooms than this is not worth re-plumbing the parse
 *  around — one stray tag is not a room schedule. */
export const MIN_ROOM_LABELS = 3;

export async function readSheet(pdf: Buffer): Promise<SheetReading | null> {
  const extract = await extractSheet(pdf);
  if (!extract) return null;

  const chars = extract.lines.reduce((n, l) => n + l.text.length, 0);
  if (chars < MIN_TEXT_LAYER_CHARS) return null; // scanned page: nothing to trust

  const labels = extractRoomLabels(extract.lines);
  if (labels.length < MIN_ROOM_LABELS) return null;

  const detection = detectPlanRegion(
    extract.segments,
    extract.page_pt,
    labels.map((l) => l.anchor_pt),
  );

  return {
    page_pt: extract.page_pt,
    region: detection.region,
    region_reject_reason: detection.reason,
    labels,
    scale: readSheetScale(extract.lines, extract.page_pt),
    stats: {
      text_lines: extract.lines.length,
      segments: extract.segments.length,
      labels_with_dims: labels.filter((l) => l.area_m2 !== null).length,
    },
  };
}

export { rasterizeRegion };
export type { SheetReading };
