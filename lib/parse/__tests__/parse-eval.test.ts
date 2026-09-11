// =============================================================================
// The parse eval — recorded parses of the Mudon first-floor CAD sheet scored
// against the ground truth read off the drawing.
//
// Run `npx vitest run parse-eval --reporter=verbose` to see the side-by-side
// table; the assertions below pin today's numbers so an improvement has to be
// deliberate and a regression cannot be silent.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  MUDON_DIMENSIONED_AREA_M2,
  MUDON_GROUND_TRUTH,
  MUDON_SHEET,
  MUDON_UNTAGGED_SPACES,
} from "./fixtures/mudon-first-floor.ground-truth";
import {
  PARSE_1_LEGACY_PERSISTED,
  PARSE_2D_CROPPED_DIAGNOSTIC,
  PARSE_2_S4_RAW,
  PARSE_2_S4_REPAIRED,
  PARSE_3_SHEET_FIRST,
} from "./fixtures/mudon-first-floor.parses";
import { evaluateParse, formatEval } from "./parse-eval";

const score = (parse: Parameters<typeof evaluateParse>[1]) =>
  evaluateParse(MUDON_GROUND_TRUTH, parse, MUDON_UNTAGGED_SPACES);

describe("ground truth", () => {
  it("has 13 F-tagged rooms, 8 of them dimensioned on the sheet", () => {
    expect(MUDON_GROUND_TRUTH).toHaveLength(13);
    const dimensioned = MUDON_GROUND_TRUTH.filter((r) => r.area_m2 !== null);
    expect(dimensioned).toHaveLength(8);
    const sum = dimensioned.reduce((s, r) => s + r.area_m2!, 0);
    expect(sum).toBeCloseTo(MUDON_DIMENSIONED_AREA_M2, 1);
  });

  it("derives each area from the printed NNNNxNNNN label", () => {
    for (const room of MUDON_GROUND_TRUTH) {
      if (!room.dim_mm) {
        expect(room.area_m2).toBeNull();
        continue;
      }
      const [w, h] = room.dim_mm;
      expect(room.area_m2).toBeCloseTo((w * h) / 1e6, 2);
    }
  });

  it("records the sheet as A2 at 1:100, so one point is 35.278 mm of building", () => {
    expect(MUDON_SHEET.sheet_format).toBe("A2");
    expect(MUDON_SHEET.mm_per_pt).toBeCloseTo(35.278, 3);
    const [w, h] = MUDON_SHEET.page_size_mm;
    expect(w).toBeCloseTo(594.1, 1);
    expect(h).toBeCloseTo(420.2, 1);
  });

  it("places the plan on a quarter of the sheet — the rest is title block and key plans", () => {
    const [x0, y0, x1, y1] = MUDON_SHEET.plan_region_pt;
    const [pw, ph] = MUDON_SHEET.page_size_pt;
    const share = ((x1 - x0) * (y1 - y0)) / (pw * ph);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });
});

describe("fixture #1 — legacy persisted parse (pre-S4)", () => {
  const result = score(PARSE_1_LEGACY_PERSISTED);

  it("scores as recorded", () => {
    console.log("\n" + formatEval(result));
    expect(result.rooms_found).toBe(12);
    expect(result.missing_tags).toEqual(["F13"]);
    expect(result.extra_unexpected).toEqual([]);
    expect(result.area_scored).toBe(8);
  });

  it("gets the rooms it dimensions nearly right but the family area badly wrong", () => {
    const family = result.matched.find((m) => m.tag === "F01")!;
    expect(family.delta_pct).toBeGreaterThan(80); // 24.0 m² against a printed 12.54
    expect(result.area_within_3pct).toBe(5);
  });

  it("was never overlap-repaired, so rooms still double-count floor area", () => {
    expect(result.overlap_pairs_polygon).toBe(12);
    expect(result.overlap_area_pct).toBeGreaterThan(20);
    // Every room here is a plain rectangle, so all three tests agree.
    expect(result.overlap_pairs_gate).toBe(12);
    expect(result.overlap_pairs_bbox).toBe(12);
  });
});

describe("fixture #2 — current pipeline on the full A2 sheet", () => {
  const raw = score(PARSE_2_S4_RAW);
  const repaired = score(PARSE_2_S4_REPAIRED);

  it("finds 12 of 13 rooms, losing one of the two balconies", () => {
    console.log("\n" + formatEval(raw));
    console.log("\n" + formatEval(repaired));
    expect(raw.rooms_found).toBe(12);
    expect(raw.missing_tags).toEqual(["F13"]);
    expect(raw.extra_unexpected).toEqual([]);
  });

  it("still emits axis-aligned rectangles despite the N-vertex contract", () => {
    expect(PARSE_2_S4_RAW.rooms.every((r) => r.polygon.length === 4)).toBe(true);
  });

  it("reads the printed room dimensions almost exactly BEFORE repair", () => {
    expect(raw.area_exact).toBe(5);
    expect(raw.area_within_3pct).toBe(5);
    expect(raw.mean_abs_delta_pct!).toBeLessThan(15);
  });

  it("loses those areas in repair, which rescales polygons to total_area_m2", () => {
    expect(repaired.area_exact).toBe(0);
    expect(repaired.area_within_3pct).toBe(0);
    expect(repaired.mean_abs_delta_pct!).toBeGreaterThan(30);
  });

  it("repair does eliminate every real overlap", () => {
    expect(raw.overlap_pairs_polygon).toBe(7);
    expect(raw.overlap_area_pct).toBeGreaterThan(10);
    expect(repaired.overlap_pairs_polygon).toBe(0);
    expect(repaired.overlap_area_pct).toBe(0);
  });

  it("and the gate now agrees with the geometry instead of the boxes", () => {
    // Repair carves L-shapes; their bounding boxes keep intersecting. The old
    // box-based gate called that three overlaps and refused to cost a plan with
    // none. The shipped detector tests polygons, so it sees what repair did.
    expect(repaired.overlap_pairs_polygon).toBe(0);
    expect(repaired.overlap_pairs_gate).toBe(0);
    expect(repaired.overlap_pairs_bbox).toBe(3); // what it would have said before
  });
});

describe("diagnostic — same model shown only the plan region", () => {
  const cropped = score(PARSE_2D_CROPPED_DIAGNOSTIC);

  it("finds all 13 rooms and every printed dimension exactly", () => {
    console.log("\n" + formatEval(cropped));
    expect(cropped.rooms_found).toBe(13);
    expect(cropped.missing_tags).toEqual([]);
    expect(cropped.area_scored).toBe(8);
    expect(cropped.area_exact).toBe(8);
    expect(cropped.max_abs_delta_pct!).toBeLessThan(0.5);
  });

  it("and produces almost no overlap to repair", () => {
    expect(cropped.overlap_pairs_polygon).toBeLessThanOrEqual(2);
    expect(cropped.overlap_area_pct).toBeLessThan(2);
  });
});

describe("fixture #2 after the sheet-first rebuild — what ships", () => {
  const after = score(PARSE_3_SHEET_FIRST);
  const before = score(PARSE_2_S4_REPAIRED);

  it("finds every room the drawing tags", () => {
    console.log("\n" + formatEval(after));
    expect(after.rooms_found).toBe(13);
    expect(after.missing_tags).toEqual([]);
    expect(after.extra_unexpected).toEqual([]);
    expect(after.extra_expected).toEqual(["Stairs"]); // drawn, never F-tagged
  });

  it("reproduces every printed dimension exactly", () => {
    expect(after.area_scored).toBe(8);
    expect(after.area_exact).toBe(8);
    expect(after.max_abs_delta_pct!).toBeLessThan(0.5);
  });

  it("takes those areas from the sheet, not from the polygons", () => {
    const measured = PARSE_3_SHEET_FIRST.rooms.filter((r) => r.area_source === "measured");
    expect(measured).toHaveLength(8);
    // …and only those. Rooms the sheet leaves undimensioned stay estimates
    // rather than acquiring a number nobody wrote down.
    const estimated = PARSE_3_SHEET_FIRST.rooms.filter((r) => r.area_source !== "measured");
    expect(estimated.map((r) => r.name_en).sort()).toEqual([
      "F-Balcony",
      "F-Balcony",
      "Passage",
      "Stairs",
      "Terrace",
      "Terrace",
    ]);
  });

  it("leaves no overlapping geometry and passes the costing gate", () => {
    expect(after.overlap_pairs_polygon).toBe(0);
    expect(after.overlap_pairs_gate).toBe(0);
  });

  it("beats the pipeline it replaces on every metric", () => {
    expect(after.rooms_found).toBeGreaterThan(before.rooms_found);
    expect(after.missing_tags.length).toBeLessThan(before.missing_tags.length);
    expect(after.area_exact).toBeGreaterThan(before.area_exact);
    expect(after.mean_abs_delta_pct!).toBeLessThan(before.mean_abs_delta_pct!);
    expect(after.overlap_pairs_gate).toBeLessThanOrEqual(before.overlap_pairs_gate);
  });

  it("matches the control the diagnostic set", () => {
    const control = score(PARSE_2D_CROPPED_DIAGNOSTIC);
    expect(after.rooms_found).toBeGreaterThanOrEqual(control.rooms_found);
    expect(after.area_exact).toBeGreaterThanOrEqual(control.area_exact);
    expect(after.overlap_pairs_polygon).toBeLessThanOrEqual(control.overlap_pairs_polygon);
  });
});

describe("fixture #1 must not regress", () => {
  // Fixture #1 is a parse recorded before any of this existed, so nothing in
  // the rebuild can change it. These pin that: if a future change to the
  // comparator or the shared detector moves #1's numbers, it moved them for a
  // reason that has nothing to do with #1.
  const result = score(PARSE_1_LEGACY_PERSISTED);

  it("scores exactly as it did before the rebuild", () => {
    expect(result.rooms_found).toBe(12);
    expect(result.missing_tags).toEqual(["F13"]);
    expect(result.area_scored).toBe(8);
    expect(result.area_exact).toBe(4);
    expect(result.area_within_3pct).toBe(5);
    expect(result.mean_abs_delta_pct!).toBeCloseTo(17.9, 1);
    expect(result.max_abs_delta_pct!).toBeCloseTo(91.4, 1);
    expect(result.overlap_pairs_polygon).toBe(12);
    expect(result.overlap_pairs_gate).toBe(12);
  });
});
