import polygonClipping from "polygon-clipping";
import { describe, expect, it } from "vitest";

import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";
import { SYNTHETIC_FIXTURES } from "@/lib/plan/__tests__/synthetic.fixtures";
import { polygonArea, type Pt } from "@/lib/plan/polygon";
import { LOW_CONFIDENCE_FLAG, SLIVER_AREA_M2 } from "@/lib/parse/constants";
import { repairOverlaps, toRepairInput, type RepairInputRoom } from "@/lib/parse/repair";

// Normalised overlap area between two rooms (should be ~0 after repair).
function overlapAreaNorm(a: Pt[], b: Pt[]): number {
  const ra = [...a.map((p) => [p[0], p[1]]), [a[0]![0], a[0]![1]]];
  const rb = [...b.map((p) => [p[0], p[1]]), [b[0]![0], b[0]![1]]];
  const inter = polygonClipping.intersection([ra] as never, [rb] as never) as number[][][][];
  let area = 0;
  for (const poly of inter) {
    const outer = poly[0];
    if (outer) area += polygonArea(outer.map((p) => [p[0]!, p[1]!]) as Pt[]);
  }
  return area;
}

describe("repairOverlaps — synthetic fixtures", () => {
  for (const fx of SYNTHETIC_FIXTURES) {
    describe(fx.planId, () => {
      const { rooms, summary } = repairOverlaps(fx.rooms, {
        totalAreaM2: fx.total_area_m2,
      });

      it("keeps the expected rooms (no unexpected drops)", () => {
        expect(rooms.map((r) => r.id).sort()).toEqual(
          Object.keys(fx.expected).sort(),
        );
        expect(summary.dropped_room_ids).toEqual([]);
      });

      it("has zero pairwise overlap", () => {
        for (let i = 0; i < rooms.length; i++) {
          for (let j = i + 1; j < rooms.length; j++) {
            const ov = overlapAreaNorm(rooms[i]!.polygon, rooms[j]!.polygon);
            expect(ov).toBeLessThan(1e-6);
          }
        }
      });

      it("has per-room areas within ±2% of expected", () => {
        for (const r of rooms) {
          const exp = fx.expected[r.id]!;
          expect(Math.abs(r.area_m2 - exp) / exp).toBeLessThan(0.02);
        }
      });

      it("sums area to total_area_m2 (scale recompute) and has no slivers", () => {
        expect(Math.abs(summary.area_sum_m2 - fx.total_area_m2)).toBeLessThan(0.5);
        for (const r of rooms) expect(r.area_m2).toBeGreaterThan(SLIVER_AREA_M2);
      });

      it("downgrades confidence of heavily-carved rooms", () => {
        for (const id of fx.expectedDowngraded ?? []) {
          const r = rooms.find((x) => x.id === id)!;
          expect(r.confidence).toBeLessThan(LOW_CONFIDENCE_FLAG);
        }
      });

      it("is deterministic (stable across runs)", () => {
        const again = repairOverlaps(fx.rooms, { totalAreaM2: fx.total_area_m2 });
        expect(again.rooms).toEqual(rooms);
      });
    });
  }
});

describe("repairOverlaps — Mudon regression", () => {
  const rooms: RepairInputRoom[] = MUDON_FIXTURE.rooms.map((r) => ({
    id: r.id,
    polygon: r.polygon as Pt[],
    area_m2: r.area_m2,
  }));
  const { rooms: out, summary } = repairOverlaps(rooms, {
    totalAreaM2: MUDON_FIXTURE.total_area_m2 ?? 178.5,
  });

  it("keeps all 13 rooms (none consumed)", () => {
    expect(out).toHaveLength(13);
    expect(summary.dropped_room_ids).toEqual([]);
  });

  it("eliminates any overlaps between the real rooms", () => {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(overlapAreaNorm(out[i]!.polygon, out[j]!.polygon)).toBeLessThan(1e-6);
      }
    }
  });

  it("keeps the stated room areas instead of rescaling them to the plan total", () => {
    // The plan's total_area_m2 (178.5) is the model's guess at the whole floor
    // and is LARGER than the rooms beneath it. Repair used to close that gap by
    // inflating every room; it now leaves the stated areas alone.
    for (const r of out) {
      if (r.area_derived) continue;
      const stated = MUDON_FIXTURE.rooms.find((x) => x.id === r.id)!.area_m2 ?? 0;
      expect(r.area_m2).toBeCloseTo(stated, 2);
    }
    expect(summary.stated_area_room_ids).toHaveLength(12);
  });

  it("overrides the one area this legacy parse got badly wrong, and flags it", () => {
    // "Family Area" was recorded as 24 m². The sheet prints 3325x3770 = 12.54,
    // and after its overlap with the passage is carved away the polygon is
    // worth about 8.9 — more than 2x from the claim, so the claim loses.
    expect(summary.derived_area_room_ids).toEqual(["family-01"]);
    const family = out.find((r) => r.id === "family-01")!;
    expect(family.area_derived).toBe(true);
    expect(family.area_m2).toBeLessThan(24);
    expect(family.confidence).toBeLessThan(LOW_CONFIDENCE_FLAG);
  });
});

describe("repairOverlaps — stated vs derived area", () => {
  // Two rooms, the right one carved to [0.6,1]. total 100 m² over the unit
  // square, so geometry says 60 and 40.
  const geometry: RepairInputRoom[] = [
    { id: "a", polygon: [[0, 0], [0.6, 0], [0.6, 1], [0, 1]], confidence: 0.8 },
    { id: "b", polygon: [[0.4, 0], [1, 0], [1, 1], [0.4, 1]], confidence: 0.8 },
  ];

  it("derives an area when the provider states none", () => {
    const { rooms, summary } = repairOverlaps(geometry, { totalAreaM2: 100 });
    expect(rooms.map((r) => r.area_m2)).toEqual([60, 40]);
    expect(rooms.every((r) => r.area_derived)).toBe(true);
    // Nothing was overridden — there was nothing to override.
    expect(summary.derived_area_room_ids).toEqual([]);
  });

  it("keeps a stated area the geometry merely approximates", () => {
    const { rooms, summary } = repairOverlaps(
      geometry.map((r, i) => ({ ...r, area_m2: [55, 45][i]! })),
      { totalAreaM2: 100 },
    );
    expect(rooms.map((r) => r.area_m2)).toEqual([55, 45]);
    expect(rooms.every((r) => r.area_derived)).toBe(false);
    expect(summary.derived_area_room_ids).toEqual([]);
    expect(summary.stated_area_room_ids).toEqual(["a", "b"]);
  });

  it("overrides a stated area the geometry contradicts, and flags the room", () => {
    // "b" claims 4 m² of a room the drawing gives ~40. Something is wrong with
    // the label, not with the wall it sits in.
    const { rooms, summary } = repairOverlaps(
      geometry.map((r, i) => ({ ...r, area_m2: [55, 4][i]! })),
      { totalAreaM2: 100 },
    );
    const b = rooms.find((r) => r.id === "b")!;
    expect(b.area_m2).not.toBe(4);
    expect(b.area_derived).toBe(true);
    expect(b.confidence).toBeLessThan(LOW_CONFIDENCE_FLAG);
    expect(summary.derived_area_room_ids).toEqual(["b"]);
    expect(summary.stated_area_room_ids).toEqual(["a"]);
  });

  it("scales a room with no stated area against the rooms that have one", () => {
    // "a" states 55 for 0.6 of the unit square → 91.67 m² per unit². "b" holds
    // 0.4 after the carve, so it should come out near 36.7 — NOT the 40 that
    // total_area_m2 would have given.
    const { rooms } = repairOverlaps(
      [{ ...geometry[0]!, area_m2: 55 }, geometry[1]!],
      { totalAreaM2: 100 },
    );
    const b = rooms.find((r) => r.id === "b")!;
    expect(b.area_m2).toBeCloseTo(36.67, 1);
    expect(b.area_derived).toBe(true);
  });
});

describe("repairOverlaps — the editor's coordinate space", () => {
  // The plan editor works and saves in viewBox units (1000 x 600), not the
  // normalised [0,1] the parse produces, while areas stay in m². update-plan
  // runs repair on exactly that, so the thresholds inside must be derived from
  // the input rather than assuming either space.
  const viewBox: RepairInputRoom[] = [
    { id: "a", polygon: [[0, 0], [600, 0], [600, 600], [0, 600]], area_m2: 36, confidence: 0.8 },
    { id: "b", polygon: [[400, 0], [1000, 0], [1000, 600], [400, 600]], area_m2: 36, confidence: 0.8 },
  ];

  it("carves the overlap and leaves the stated areas alone", () => {
    const { rooms, summary } = repairOverlaps(viewBox, { totalAreaM2: 72 });
    expect(summary.dropped_room_ids).toEqual([]);
    expect(rooms.map((r) => r.area_m2)).toEqual([36, 36]);
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        expect(overlapAreaNorm(rooms[i]!.polygon, rooms[j]!.polygon)).toBeLessThan(1e-6);
      }
    }
    // "b" lost a third of itself, so it is carved and flagged even though its
    // stated area survives — the geometry changed, and someone should see that.
    expect(summary.carved_room_ids).toEqual(["b"]);
  });

  it("does not shred a viewBox plan into slivers", () => {
    // The sliver threshold is in m² and the coordinates are in viewBox units;
    // getting that conversion backwards would drop every room as too small.
    const { rooms, summary } = repairOverlaps(viewBox, { totalAreaM2: 72 });
    expect(rooms).toHaveLength(2);
    expect(summary.sliver_parts_dropped).toBe(0);
  });
});

describe("repairOverlaps — a printed dimension outranks the geometry", () => {
  // Same two rooms as above: "b" holds 0.4 of the unit square after the carve,
  // which at "a"'s stated scale is worth about 36.7 m².
  const geometry: RepairInputRoom[] = [
    { id: "a", polygon: [[0, 0], [0.6, 0], [0.6, 1], [0, 1]], confidence: 0.8, area_m2: 55 },
    { id: "b", polygon: [[0.4, 0], [1, 0], [1, 1], [0.4, 1]], confidence: 0.8, area_m2: 4 },
  ];

  it("keeps a MEASURED area the geometry contradicts, and records both numbers", () => {
    // The drawing prints 4 m² for this room and the outline says ~37. One of
    // them is wrong, and it is not automatically the architect.
    const { rooms, summary } = repairOverlaps(
      geometry.map((r) => (r.id === "b" ? { ...r, area_source: "measured" as const } : r)),
      { totalAreaM2: 100 },
    );
    const b = rooms.find((r) => r.id === "b")!;
    expect(b.area_m2).toBe(4);
    expect(b.area_derived).toBe(false);
    expect(summary.derived_area_room_ids).toEqual([]);
    expect(summary.stated_area_room_ids).toEqual(["a", "b"]);

    // …but it is flagged, and the flag carries the two figures the question is
    // about, so a person can be asked which to believe.
    expect(b.confidence).toBeLessThan(LOW_CONFIDENCE_FLAG);
    expect(summary.disputes).toHaveLength(1);
    const [dispute] = summary.disputes;
    expect(dispute!.room_id).toBe("b");
    expect(dispute!.stated_area_m2).toBe(4);
    // 23.6, not the 36.67 the same outline is worth in the test above, because
    // a kept area is part of the scale the geometry is measured against — the
    // disputed 4 is in the kernel too. A suspect number skewing the ruler used
    // to judge it is a real wrinkle; with one bad room among a dozen it moves
    // the figure a little and the verdict not at all.
    expect(dispute!.geometric_area_m2).toBeCloseTo(23.6, 1);
  });

  it("still overrides an ESTIMATED area the geometry contradicts", () => {
    // Same numbers, no printed dimension behind them. Nothing to defer to, so
    // geometry wins and there is no question to ask anyone.
    const { rooms, summary } = repairOverlaps(geometry, { totalAreaM2: 100 });
    const b = rooms.find((r) => r.id === "b")!;
    expect(b.area_derived).toBe(true);
    expect(summary.derived_area_room_ids).toEqual(["b"]);
    expect(summary.disputes).toEqual([]);
  });

  it("raises no dispute when a measured area and its outline merely differ", () => {
    const { rooms, summary } = repairOverlaps(
      geometry.map((r) => ({ ...r, area_source: "measured" as const, area_m2: r.id === "a" ? 55 : 45 })),
      { totalAreaM2: 100 },
    );
    expect(summary.disputes).toEqual([]);
    // Both areas stand as stated. (Confidence still drops on "b" — the carve
    // took a third of it — but that is the carve rule, not a dispute.)
    expect(rooms.every((r) => !r.area_derived)).toBe(true);
    expect(rooms.map((r) => r.area_m2)).toEqual([55, 45]);
  });
});

describe("toRepairInput", () => {
  // Regression: the parse route built this object by hand and listed six
  // properties. `area_source` was added to both sides of the boundary and the
  // literal between them was not, so in production every area arrived as an
  // estimate and the never-overwrite rule could never fire. Nothing threw.
  it("carries the area provenance a hand-written literal dropped", () => {
    const room = {
      id: "bathroom-01",
      name_en: "Bath",
      room_type: "ensuite",
      area_m2: 8.79,
      area_source: "measured" as const,
      confidence: 0.82,
      polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][],
    };
    expect(toRepairInput(room).area_source).toBe("measured");
    // …and everything the caller put on the room survives for the DB write.
    expect(toRepairInput(room).name_en).toBe("Bath");
  });

  it("defaults a room with no provenance to the overridable branch", () => {
    const room = {
      id: "x",
      area_m2: 10,
      confidence: 0.5,
      polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][],
    };
    expect(toRepairInput(room).area_source).toBeNull();
  });
});
