// =============================================================================
// lib/parse/sheet/region.ts — find the plan drawing on a CAD sheet.
//
// A construction sheet is mostly not the plan. On the pilot's A2 first-floor
// sheet the plan is about a quarter of the page; the rest is title block, key
// plan and a six-villa cluster thumbnail. Handing the whole page to a vision
// model spends the image budget on the parts nobody asked about — measured on
// that sheet, the plan arrives roughly 400 px across with sub-pixel wall lines.
//
// Two properties separate the plan from everything else on the page, and on the
// pilot sheet either one alone is decisive:
//   - it is by far the LARGEST connected run of ink (5.6x the next region), and
//   - it is by far the SPARSEST (0.21 ink density against 1.5+ for the key
//     plan, the cluster thumbnail and the logos) — a plan is mostly white.
//
// Sheet frame and title-block rules would connect every region into one blob,
// so segments longer than a plan wall can be are dropped first.
//
// Pure: takes segments, returns a rectangle. No PDF, no I/O, no model.
// =============================================================================

import type { Region, SheetSegment } from "./types";

/** Longer than this (pt) is sheet furniture — a frame, a rule, a title-block
 *  divider. At 1:100 this is already a 8.8 m straight run of unbroken ink. */
export const FRAME_SEGMENT_PT = 250;

/** Ink is binned into square cells of this size (pt) before components are
 *  grown. Big enough that a dashed grid line stays connected, small enough to
 *  keep the title block off the plan. */
export const INK_CELL_PT = 12;

/** A cell counts as inked above this much ink length (pt) inside it. */
export const INK_CELL_THRESHOLD_PT = 1.0;

/** Plausible share of the page the plan can occupy. Outside this the detection
 *  is rejected and the caller falls back to the whole sheet. */
export const MIN_REGION_PAGE_FRACTION = 0.03;
export const MAX_REGION_PAGE_FRACTION = 0.85;

/** A drawing is never this elongated; a stray rule sometimes is. */
export const MAX_REGION_ASPECT = 12;

/** Breathing room added to the detected box (pt) so grid bubbles and the first
 *  dimension chain stay in frame. */
export const REGION_MARGIN_PT = 8;

export interface RegionCandidate {
  region: Region;
  cells: number;
  /** Ink length per square point — low means "a plan", high means "a logo". */
  density: number;
}

export interface RegionDetection {
  region: Region | null;
  reason: string | null;
  candidates: RegionCandidate[];
}

function segmentLength(s: SheetSegment): number {
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
}

/**
 * Connected components of inked cells, largest ink first.
 *
 * Exported for the unit tests and for tracing; `detectPlanRegion` is what the
 * pipeline calls.
 */
export function inkComponents(
  segments: SheetSegment[],
  pagePt: [number, number],
): RegionCandidate[] {
  const [W, H] = pagePt;
  if (!(W > 0) || !(H > 0)) return [];
  const gw = Math.ceil(W / INK_CELL_PT);
  const gh = Math.ceil(H / INK_CELL_PT);
  if (gw <= 0 || gh <= 0) return [];
  const grid = new Float64Array(gw * gh);

  for (const s of segments) {
    const len = segmentLength(s);
    if (len > FRAME_SEGMENT_PT) continue; // sheet furniture
    // Walk the segment so a long diagonal inks every cell it crosses.
    const steps = Math.max(1, Math.ceil(len / 3));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.floor((s.x1 + (s.x2 - s.x1) * t) / INK_CELL_PT);
      const cy = Math.floor((s.y1 + (s.y2 - s.y1) * t) / INK_CELL_PT);
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
      grid[cy * gw + cx] += len / steps;
    }
  }

  const seen = new Uint8Array(gw * gh);
  const out: RegionCandidate[] = [];
  for (let start = 0; start < gw * gh; start++) {
    if (seen[start] || grid[start]! <= INK_CELL_THRESHOLD_PT) continue;
    const stack = [start];
    seen[start] = 1;
    let minx = gw, miny = gh, maxx = -1, maxy = -1, cells = 0, ink = 0;
    while (stack.length > 0) {
      const c = stack.pop()!;
      const cx = c % gw;
      const cy = (c - cx) / gw;
      cells++;
      ink += grid[c]!;
      if (cx < minx) minx = cx;
      if (cx > maxx) maxx = cx;
      if (cy < miny) miny = cy;
      if (cy > maxy) maxy = cy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const ni = ny * gw + nx;
          if (seen[ni] || grid[ni]! <= INK_CELL_THRESHOLD_PT) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    const region: Region = [
      minx * INK_CELL_PT,
      miny * INK_CELL_PT,
      (maxx + 1) * INK_CELL_PT,
      (maxy + 1) * INK_CELL_PT,
    ];
    const boxArea = (region[2] - region[0]) * (region[3] - region[1]);
    out.push({ region, cells, density: boxArea > 0 ? ink / boxArea : Infinity });
  }
  return out.sort((a, b) => b.cells - a.cells);
}

/**
 * The plan drawing's rectangle on the page, or null with a reason.
 *
 * `anchorsPt` are room-label positions when the sheet has them. They are used
 * only as a VETO: a region that does not contain most of the rooms the drawing
 * names is not the plan, whatever its ink says. Passing none skips the check.
 */
export function detectPlanRegion(
  segments: SheetSegment[],
  pagePt: [number, number],
  anchorsPt: [number, number][] = [],
): RegionDetection {
  const candidates = inkComponents(segments, pagePt);
  if (candidates.length === 0) {
    return { region: null, reason: "no inked regions on the page", candidates };
  }

  const [W, H] = pagePt;
  const pageArea = W * H;
  const contains = (r: Region, p: [number, number]) =>
    p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];

  // Report why the BEST candidate was turned down, not the last one looked at.
  // Falling through to ever-smaller components and reporting "covers only 1.9%
  // of the page" hides the actual problem, which is usually the one above it.
  let firstReason: string | null = null;
  const reject = (why: string) => {
    firstReason ??= why;
  };

  for (const c of candidates) {
    const [x0, y0, x1, y1] = c.region;
    const w = x1 - x0;
    const h = y1 - y0;
    const fraction = (w * h) / pageArea;
    if (fraction < MIN_REGION_PAGE_FRACTION) {
      reject(`largest region covers only ${(fraction * 100).toFixed(1)}% of the page`);
      continue;
    }
    if (fraction > MAX_REGION_PAGE_FRACTION) {
      reject(`largest region covers ${(fraction * 100).toFixed(1)}% of the page — the frame leaked in`);
      continue;
    }
    const aspect = Math.max(w / h, h / w);
    if (!Number.isFinite(aspect) || aspect > MAX_REGION_ASPECT) {
      reject(`largest region is ${aspect.toFixed(1)}:1 — a rule, not a drawing`);
      continue;
    }
    if (anchorsPt.length > 0) {
      const inside = anchorsPt.filter((p) => contains(c.region, p)).length;
      if (inside * 2 <= anchorsPt.length) {
        reject(`region holds only ${inside}/${anchorsPt.length} of the labelled rooms`);
        continue;
      }
    }
    const region: Region = [
      Math.max(0, x0 - REGION_MARGIN_PT),
      Math.max(0, y0 - REGION_MARGIN_PT),
      Math.min(W, x1 + REGION_MARGIN_PT),
      Math.min(H, y1 + REGION_MARGIN_PT),
    ];
    return { region, reason: null, candidates };
  }
  return {
    region: null,
    reason: firstReason ?? "no candidate passed the plausibility checks",
    candidates,
  };
}

/** Map a page point into [0,1] within `region` — the space a vision model sees
 *  once the region is cropped out and handed over on its own. */
export function pointToRegionNorm(
  p: [number, number],
  region: Region,
): [number, number] {
  const w = region[2] - region[0];
  const h = region[3] - region[1];
  return [w > 0 ? (p[0] - region[0]) / w : 0, h > 0 ? (p[1] - region[1]) / h : 0];
}
