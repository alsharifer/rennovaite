import { describe, expect, it } from "vitest";

import {
  buildOpeningRows,
  openingAreaM2,
  renderOpeningSchedule,
  type ScheduleSourceOpening,
} from "@/lib/drawings/opening-schedule";
import type { SheetMeta } from "@/lib/drawings/sheet";

const META: SheetMeta = {
  projectNameEn: "Mudon pilot villa",
  projectNameAr: "الفاخر البسيط",
  community: "Mudon Al Naseem",
  level: "first floor",
  scale: "1:100",
  dateISO: "2026-09-02",
};

const ROOMS = new Map([
  ["r1", "Master Bedroom"],
  ["r2", "Bathroom 1"],
]);

function opening(over: Partial<ScheduleSourceOpening> = {}): ScheduleSourceOpening {
  return {
    id: "o",
    type: "door",
    room_id: "r1",
    wall_id: "wall-1",
    width_mm: 900,
    height_mm: 2100,
    sill_mm: 0,
    source: "user_drawn",
    derived: true,
    ...over,
  };
}

describe("buildOpeningRows — marks + grouping", () => {
  it("groups by kind and marks each series independently", () => {
    const rows = buildOpeningRows(
      [
        opening({ id: "a", type: "door", room_id: "r1" }),
        opening({ id: "b", type: "window", room_id: "r1" }),
        opening({ id: "c", type: "door", room_id: "r2" }),
        opening({ id: "d", type: "archway", room_id: "r1" }),
        opening({ id: "e", type: "window", room_id: "r2" }),
      ],
      ROOMS,
    );
    expect(rows.map((r) => r.mark)).toEqual([
      "D-01",
      "D-02",
      "W-01",
      "W-02",
      "A-01",
    ]);
    // Doors first, then windows, then archways.
    expect(rows.map((r) => r.kind)).toEqual([
      "door",
      "door",
      "window",
      "window",
      "archway",
    ]);
    // One group heading per kind present.
    expect(rows.filter((r) => r.groupStart).map((r) => r.groupLabel)).toEqual([
      "Doors (2)",
      "Windows (2)",
      "Archways (1)",
    ]);
  });

  it("orders deterministically so re-running the set keeps the same marks", () => {
    // All in one room, so the wall tiebreaker is what is under test.
    const input = [
      opening({ id: "a", room_id: "r1", wall_id: "wall-10" }),
      opening({ id: "b", room_id: "r1", wall_id: "wall-2" }),
      opening({ id: "c", room_id: "r1", wall_id: "wall-1" }),
    ];
    const first = buildOpeningRows(input, ROOMS);
    const shuffled = buildOpeningRows([input[2]!, input[0]!, input[1]!], ROOMS);
    expect(shuffled.map((r) => `${r.mark}:${r.room}:${r.wall}`)).toEqual(
      first.map((r) => `${r.mark}:${r.room}:${r.wall}`),
    );
    // wall-10 must sort after wall-2 (numeric), not lexically before it.
    expect(first.map((r) => r.wall)).toEqual(["wall-1", "wall-2", "wall-10"]);
  });

  it("sorts by room name before wall id", () => {
    const rows = buildOpeningRows(
      [
        opening({ id: "a", room_id: "r1", wall_id: "wall-1" }), // Master Bedroom
        opening({ id: "b", room_id: "r2", wall_id: "wall-9" }), // Bathroom 1
      ],
      ROOMS,
    );
    expect(rows.map((r) => r.room)).toEqual(["Bathroom 1", "Master Bedroom"]);
  });

  it("labels an opening with no room as Unassigned and an unsnapped wall as —", () => {
    const rows = buildOpeningRows(
      [opening({ id: "a", room_id: null, wall_id: null })],
      ROOMS,
    );
    expect(rows[0]!.room).toBe("Unassigned");
    expect(rows[0]!.wall).toBe("—");
  });

  it("returns nothing for an empty plan", () => {
    expect(buildOpeningRows([], ROOMS)).toEqual([]);
  });
});

describe("renderOpeningSchedule — sheet output", () => {
  const rows = buildOpeningRows(
    [
      opening({ id: "a", type: "door", room_id: "r1", derived: true }),
      opening({
        id: "b",
        type: "window",
        room_id: "r2",
        width_mm: 1500,
        height_mm: 1400,
        sill_mm: 900,
        source: "parsed",
        derived: false,
      }),
    ],
    ROOMS,
  );

  const svg = renderOpeningSchedule(rows, META, {
    sheetNumber: "A-202",
    title: "Door & Window Schedule",
  });

  it("is a true-size A3 SVG carrying the sheet identity", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="420mm"');
    expect(svg).toContain('height="297mm"');
    expect(svg).toContain("A-202");
  });

  it("shows every mark, room and dimension pair", () => {
    expect(svg).toContain("D-01");
    expect(svg).toContain("W-01");
    expect(svg).toContain("Master Bedroom");
    expect(svg).toContain("Bathroom 1");
    expect(svg).toContain("900 × 2100");
    expect(svg).toContain("1500 × 1400");
  });

  it("distinguishes a defaulted opening from a measured one", () => {
    expect(svg).toContain("DERIVED — default");
    expect(svg).toContain("Measured");
    expect(svg).toContain("Parsed");
    expect(svg).toContain("User drawn");
  });

  it("footers the exact area the BoQ deducts, so the two reconcile", () => {
    // 0.9×2.1 = 1.89 plus 1.5×1.4 = 2.10 → 3.99 m².
    expect(svg).toContain("3.99 m² deducted");
    expect(svg).toContain("2 openings");
    expect(svg).toContain("1 with DEFAULTED dimensions");
  });

  it("escapes room names rather than emitting raw markup", () => {
    const nasty = new Map([["r1", `Bath <script>alert(1)</script> "&'`]]);
    const out = renderOpeningSchedule(
      buildOpeningRows([opening({ id: "a", room_id: "r1" })], nasty),
      META,
      { sheetNumber: "A-202", title: "Door & Window Schedule" },
    );
    expect(out).not.toContain("<script>");
  });
});

describe("openingAreaM2", () => {
  it("converts mm dimensions to m² at 2dp", () => {
    expect(openingAreaM2({ width_mm: 900, height_mm: 2100 })).toBe(1.89);
    expect(openingAreaM2({ width_mm: 1200, height_mm: 1200 })).toBe(1.44);
  });
});
