import polygonClipping from "polygon-clipping";
import { describe, expect, it } from "vitest";

import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";
import { SYNTHETIC_FIXTURES } from "@/lib/plan/__tests__/synthetic.fixtures";
import { polygonArea, type Pt } from "@/lib/plan/polygon";
import { LOW_CONFIDENCE_FLAG, SLIVER_AREA_M2 } from "@/lib/parse/constants";
import { repairOverlaps, type RepairInputRoom } from "@/lib/parse/repair";

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

  it("keeps the total within ±2% of 178.5 m²", () => {
    const total = MUDON_FIXTURE.total_area_m2 ?? 178.5;
    expect(Math.abs(summary.area_sum_m2 - total) / total).toBeLessThan(0.02);
  });
});
