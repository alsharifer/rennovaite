// =============================================================================
// The pure half of reading a CAD sheet: where the plan is on the page, what
// rooms the drawing names, and what scale it states. No PDF is opened here —
// that is the point of keeping lib/parse/sheet/pdf.ts as the only module that
// touches WASM.
// =============================================================================

import { describe, expect, it } from "vitest";

import { extractRoomLabels, titleCaseRoomName } from "@/lib/parse/sheet/labels";
import {
  detectPlanRegion,
  inkComponents,
  pointToRegionNorm,
  FRAME_SEGMENT_PT,
} from "@/lib/parse/sheet/region";
import { readSheetScale, sheetFormat, mmToPt } from "@/lib/parse/sheet/scale";
import type { SheetSegment, SheetTextLine } from "@/lib/parse/sheet/types";

const A2: [number, number] = [1684, 1191];

const text = (t: string, x: number, y: number, w = 40, h = 8): SheetTextLine => ({
  text: t,
  x,
  y,
  w,
  h,
});

/**
 * Fill a rectangle with continuous horizontal lines `step` points apart, drawn
 * in sub-frame-length chunks — a stand-in for a drawing's worth of ink.
 *
 * The lines are CONTINUOUS on purpose. Ink binned into cells has to reach from
 * one cell to the next for the region to come out as one component, which real
 * walls and grid lines do. A drawing sparse enough to fragment falls back to
 * the whole sheet, which is pinned separately below.
 */
function inkRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number,
): SheetSegment[] {
  const out: SheetSegment[] = [];
  const chunk = 100; // < FRAME_SEGMENT_PT, so nothing here is mistaken for a rule
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x < x1; x += chunk) {
      out.push({ x1: x, y1: y, x2: Math.min(x + chunk, x1), y2: y, lw: 0.5 });
    }
  }
  return out;
}

describe("sheet scale", () => {
  it("recognises the ISO size from the media box, either orientation", () => {
    expect(sheetFormat(A2)).toBe("A2");
    expect(sheetFormat([1191, 1684])).toBe("A2");
    expect(sheetFormat([1684, 2384])).toBe("A1");
    expect(sheetFormat([500, 500])).toBeNull();
  });

  it("reads the stated ratio and converts points to millimetres of building", () => {
    const s = readSheetScale([text("Scale(s):", 10, 10), text("1:100 @ A2", 10, 30)], A2);
    expect(s.scale).toBe("1:100");
    expect(s.ratio).toBe(100);
    expect(s.mm_per_pt).toBeCloseTo(35.278, 3);
    expect(s.sheet_format).toBe("A2");
    expect(s.source).toBe("text-layer");
    // The pilot sheet's own 180 mm wall should come back about 5.1 pt wide.
    expect(mmToPt(180, s)).toBeCloseTo(5.1, 1);
  });

  it("takes the sheet scale, not a one-off detail callout", () => {
    const s = readSheetScale(
      [text("1:100", 0, 0), text("1:100", 0, 20), text("DETAIL 1:20", 0, 40)],
      A2,
    );
    expect(s.ratio).toBe(100);
  });

  it("refuses an implausible ratio rather than poisoning every area", () => {
    const s = readSheetScale([text("see note 1:3 mix", 0, 0)], A2);
    expect(s.scale).toBe("unknown");
    expect(s.mm_per_pt).toBeNull();
    expect(s.source).toBe("unknown");
    expect(s.sheet_format).toBe("A2"); // the media box still tells us the paper
  });
});

describe("room labels", () => {
  // A tag box with the name under it and the dimension under that — how every
  // room on the pilot sheet is drawn.
  const room = (tag: string, name: string, dim: string | null, x: number, y: number) => [
    text(tag, x, y, 16, 9),
    text(name, x - 8, y + 13, 40, 7),
    ...(dim ? [text(dim, x - 8, y + 22, 40, 7)] : []),
  ];

  it("reads tag, name, printed dimension and position", () => {
    const rooms = extractRoomLabels([
      ...room("F 01", "FAMILY AREA", "3325X3770", 700, 600),
      ...room("F 02", "MASTER BEDROOM", "3985X5000", 570, 515),
      ...room("F 07", "TERRACE", null, 810, 400),
    ]);
    expect(rooms.map((r) => r.tag)).toEqual(["F01", "F02", "F07"]);
    const family = rooms[0]!;
    expect(family.name).toBe("FAMILY AREA");
    expect(family.dim_mm).toEqual([3325, 3770]);
    expect(family.area_m2).toBeCloseTo(12.54, 2);
    // A room the sheet does not dimension has no area — never a guessed one.
    expect(rooms[2]!.dim_mm).toBeNull();
    expect(rooms[2]!.area_m2).toBeNull();
  });

  it("sorts by tag so re-extraction cannot reshuffle a fixture", () => {
    const forwards = extractRoomLabels([
      ...room("F 03", "DRESS", "2585X1800", 570, 630),
      ...room("F 01", "FAMILY AREA", "3325X3770", 700, 600),
    ]);
    const backwards = extractRoomLabels([
      ...room("F 01", "FAMILY AREA", "3325X3770", 700, 600),
      ...room("F 03", "DRESS", "2585X1800", 570, 630),
    ]);
    expect(forwards).toEqual(backwards);
    expect(forwards.map((r) => r.tag)).toEqual(["F01", "F03"]);
  });

  it("ignores door and window tags and keeps the room series", () => {
    // A sheet carries D2/W4 tags in the same shape as F01. The room series is
    // the populous one; picking the wrong letter would parse the door schedule.
    const rooms = extractRoomLabels([
      ...room("F 01", "FAMILY AREA", "3325X3770", 700, 600),
      ...room("F 02", "MASTER BEDROOM", "3985X5000", 570, 515),
      ...room("F 03", "DRESS", "2585X1800", 570, 630),
      text("D 02", 640, 700, 16, 9),
      text("W 08", 660, 720, 16, 9),
    ]);
    expect(rooms.map((r) => r.tag)).toEqual(["F01", "F02", "F03"]);
  });

  it("does not mistake a level marker for a room name", () => {
    const rooms = extractRoomLabels([
      text("F 06", 810, 450, 16, 9),
      text("BEDROOM 3", 800, 463, 40, 7),
      text("4000X4200", 800, 472, 40, 7),
      text("+3.90", 800, 480, 24, 7),
      text("F.F.L", 800, 487, 24, 7),
    ]);
    expect(rooms[0]!.name).toBe("BEDROOM 3");
  });

  it("returns nothing when the page has no room tags at all", () => {
    expect(extractRoomLabels([text("REVISIONS / ISSUE", 100, 100)])).toEqual([]);
  });

  it("title-cases a CAD name without mangling its hyphens", () => {
    expect(titleCaseRoomName("MASTER BEDROOM")).toBe("Master Bedroom");
    expect(titleCaseRoomName("BEDROOM-4")).toBe("Bedroom-4");
    expect(titleCaseRoomName("F-BALCONY")).toBe("F-Balcony");
  });
});

describe("plan region", () => {
  // A sheet shaped like the pilot's: a big sparse plan on the left, a small
  // dense cluster thumbnail top-centre, a dense key plan top-right.
  const sheet: SheetSegment[] = [
    ...inkRect(400, 150, 880, 1050, 10), // the plan — large, sparse
    ...inkRect(950, 110, 1300, 210, 2), // cluster thumbnail — small, dense
    ...inkRect(1420, 20, 1660, 230, 2), // key plan — small, dense
  ];
  // The sheet frame: four rules long enough to connect everything if kept.
  const frame: SheetSegment[] = [
    { x1: 10, y1: 10, x2: 1674, y2: 10, lw: 1 },
    { x1: 10, y1: 1181, x2: 1674, y2: 1181, lw: 1 },
    { x1: 10, y1: 10, x2: 10, y2: 1181, lw: 1 },
    { x1: 1674, y1: 10, x2: 1674, y2: 1181, lw: 1 },
  ];

  it("picks the plan, not the key plan or the thumbnail", () => {
    const { region, reason } = detectPlanRegion([...sheet, ...frame], A2);
    expect(reason).toBeNull();
    expect(region).not.toBeNull();
    const [x0, y0, x1, y1] = region!;
    expect(x0).toBeLessThan(410);
    expect(y0).toBeLessThan(160);
    expect(x1).toBeGreaterThan(870);
    expect(y1).toBeGreaterThan(1040);
    // and it did NOT swallow the title-block side of the sheet
    expect(x1).toBeLessThan(1400);
  });

  it("is why the frame is dropped: kept, it fuses the whole page into one", () => {
    const longest = Math.max(
      ...frame.map((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)),
    );
    expect(longest).toBeGreaterThan(FRAME_SEGMENT_PT);
    const withFrameKept = inkComponents(
      [...sheet, ...frame].map((s) => ({ ...s })),
      A2,
    );
    // Sanity: the plan is the biggest component by cell count and the sparsest.
    const biggest = withFrameKept[0]!;
    expect(biggest.cells).toBeGreaterThan(withFrameKept[1]!.cells);
    expect(biggest.density).toBeLessThan(withFrameKept[1]!.density);
  });

  it("declines rather than guessing when there is no drawing", () => {
    const { region, reason } = detectPlanRegion([], A2);
    expect(region).toBeNull();
    expect(reason).toMatch(/no inked regions/);
  });

  it("declines when the only candidate is a rule, not a drawing", () => {
    const rule = inkRect(100, 600, 1600, 606, 3); // 1500 x 6 pt
    const { region, reason } = detectPlanRegion(rule, A2);
    expect(region).toBeNull();
    expect(reason).toMatch(/covers only|:1/);
  });

  it("declines when a drawing is too sparse to connect, so the caller falls back", () => {
    // Ink on a lattice coarser than the bin size never joins up, so the plan
    // arrives as a stack of strips and no single one is big enough. Declining
    // is the right answer: the provider then hands the whole sheet over exactly
    // as it did before, which is worse but never wrong.
    const scattered: SheetSegment[] = [];
    for (let y = 150; y <= 1050; y += 60) {
      for (let x = 400; x <= 880; x += 60) {
        scattered.push({ x1: x, y1: y, x2: x + 2, y2: y, lw: 0.5 });
      }
    }
    const { region, reason } = detectPlanRegion(scattered, A2);
    expect(region).toBeNull();
    expect(reason).toBeTruthy();
  });

  it("declines when the region holds none of the rooms the sheet names", () => {
    // Anchors over on the right: whatever this ink is, it is not their plan.
    const anchors: [number, number][] = [
      [1500, 500],
      [1520, 600],
      [1540, 700],
    ];
    const { region, reason } = detectPlanRegion([...sheet, ...frame], A2, anchors);
    expect(region).toBeNull();
    expect(reason).toMatch(/labelled rooms/);
  });

  it("accepts when the rooms it names are inside it", () => {
    const anchors: [number, number][] = [
      [600, 500],
      [700, 600],
      [800, 700],
    ];
    const { region } = detectPlanRegion([...sheet, ...frame], A2, anchors);
    expect(region).not.toBeNull();
  });

  it("maps a page point into the cropped image's own [0,1] space", () => {
    expect(pointToRegionNorm([376, 100], [376, 100, 908, 1100])).toEqual([0, 0]);
    expect(pointToRegionNorm([908, 1100], [376, 100, 908, 1100])).toEqual([1, 1]);
    const [x, y] = pointToRegionNorm([573, 520.5], [376, 100, 908, 1100]);
    expect(x).toBeCloseTo(0.37, 2);
    expect(y).toBeCloseTo(0.42, 2);
  });
});
