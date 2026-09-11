// =============================================================================
// Folding a drawing's printed room labels into a vision parse.
//
// The scenarios here are the ones that actually went wrong while this was being
// built, not invented edge cases: a small room's tag falling inside a
// neighbour's overstated rectangle, a verbose model name for a terse sheet one,
// and a room the model placed nowhere near its own label.
// =============================================================================

import { describe, expect, it } from "vitest";

import { LOW_CONFIDENCE_FLAG } from "@/lib/parse/constants";
import { reconcileWithSheet } from "@/lib/parse/reconcile";
import type { Region, SheetRoomLabel, SheetScale } from "@/lib/parse/sheet/types";
import type { RawParsedRoom } from "@/lib/parse/providers/types";

// A 1000 x 1000 pt region, so a page point is a thousandth of the crop.
const REGION: Region = [0, 0, 1000, 1000];
const SCALE: SheetScale = {
  scale: "1:100",
  ratio: 100,
  mm_per_pt: (25.4 / 72) * 100,
  sheet_format: "A2",
  source: "text-layer",
};

const rect = (x: number, y: number, w: number, h: number): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const room = (
  id: string,
  name_en: string,
  poly: [number, number][],
  area_m2 = 10,
  room_type = "bedroom",
): RawParsedRoom => ({
  id,
  name_en,
  name_ar: null,
  room_type,
  area_m2,
  polygon: poly,
  confidence: 0.8,
});

const label = (
  tag: string,
  name: string | null,
  at: [number, number],
  dim: [number, number] | null = null,
): SheetRoomLabel => ({
  tag,
  name,
  dim_mm: dim,
  area_m2: dim ? Math.round(((dim[0] * dim[1]) / 1e6) * 100) / 100 : null,
  anchor_pt: at,
});

describe("reconcileWithSheet", () => {
  it("gives a matched room the drawing's name and its printed area", () => {
    const rooms = [room("r1", "Central Living", rect(0.1, 0.1, 0.4, 0.4), 30, "living")];
    const { rooms: out, summary } = reconcileWithSheet(
      rooms,
      [label("F01", "FAMILY AREA", [300, 300], [3325, 3770])],
      REGION,
      SCALE,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.name_en).toBe("Family Area");
    expect(out[0]!.area_m2).toBeCloseTo(12.54, 2);
    expect(out[0]!.area_source).toBe("measured");
    expect(summary.labels_matched).toBe(1);
    expect(summary.label_area_room_ids).toEqual(["r1"]);
    expect(summary.label_only_room_ids).toEqual([]);
  });

  it("leaves the area alone when the sheet prints no dimension", () => {
    const rooms = [room("r1", "Terrace", rect(0.1, 0.1, 0.4, 0.4), 22, "terrace")];
    const { rooms: out } = reconcileWithSheet(
      rooms,
      [label("F12", "TERRACE", [300, 300])],
      REGION,
      SCALE,
    );
    expect(out[0]!.area_m2).toBe(22);
    expect(out[0]!.area_source).toBeUndefined();
  });

  it("does not let a tag inside a neighbour's rectangle steal that room", () => {
    // The toilet's tag falls inside the bedroom's overstated polygon. Matching
    // label-by-label in tag order hands the bedroom to the toilet and pushes
    // every later label off by one; scoring the whole plan does not.
    const rooms = [
      room("bedroom", "Bedroom 4", rect(0.0, 0.0, 0.9, 0.9), 30),
      room("toilet", "Toilet", rect(0.6, 0.6, 0.2, 0.2), 3, "powder"),
    ];
    const { rooms: out } = reconcileWithSheet(
      rooms,
      [
        label("F09", "TOILET", [700, 700], [2000, 1350]),
        label("F10", "BEDROOM-4", [200, 200], [4000, 4800]),
      ],
      REGION,
      SCALE,
    );
    const byId = new Map(out.map((r) => [r.id, r]));
    expect(byId.get("toilet")!.name_en).toBe("Toilet");
    expect(byId.get("toilet")!.area_m2).toBeCloseTo(2.7, 2);
    expect(byId.get("bedroom")!.name_en).toBe("Bedroom-4");
    expect(byId.get("bedroom")!.area_m2).toBeCloseTo(19.2, 2);
  });

  it("matches a terse sheet name to a verbose model one", () => {
    // "F-BALCONY" against "Front Balcony (Bedroom 4)". Scoring the overlap
    // against the longer name buried this below the floor, and a phantom
    // balcony was invented on top of a real one.
    const rooms = [
      room("b1", "F-Balcony", rect(0.0, 0.0, 0.2, 0.1), 5, "balcony"),
      room("b2", "Front Balcony (Bedroom 4)", rect(0.0, 0.8, 0.2, 0.1), 4, "balcony"),
    ];
    const { rooms: out, summary } = reconcileWithSheet(
      rooms,
      [label("F11", "F-BALCONY", [100, 850]), label("F13", "F-BALCONY", [100, 50])],
      REGION,
      SCALE,
    );
    expect(summary.labels_matched).toBe(2);
    expect(summary.label_only_room_ids).toEqual([]);
    expect(out).toHaveLength(2);
  });

  it("keeps a room the sheet never tags rather than dropping it", () => {
    const rooms = [
      room("r1", "Family Area", rect(0.1, 0.1, 0.3, 0.3), 12, "living"),
      room("stairs", "Stairs", rect(0.5, 0.5, 0.2, 0.2), 8, "stairs"),
    ];
    const { rooms: out, summary } = reconcileWithSheet(
      rooms,
      [label("F01", "FAMILY AREA", [200, 200], [3325, 3770])],
      REGION,
      SCALE,
    );
    expect(out.map((r) => r.id)).toContain("stairs");
    expect(summary.untagged_room_ids).toEqual(["stairs"]);
  });

  it("adds a room the drawing names but the model missed, and flags it", () => {
    const rooms = [room("r1", "Family Area", rect(0.0, 0.0, 0.2, 0.2), 12, "living")];
    const { rooms: out, summary } = reconcileWithSheet(
      rooms,
      [
        label("F01", "FAMILY AREA", [100, 100], [3325, 3770]),
        label("F09", "TOILET", [900, 900], [2000, 1350]),
      ],
      REGION,
      SCALE,
    );
    expect(out).toHaveLength(2);
    const added = out.find((r) => r.id !== "r1")!;
    expect(added.name_en).toBe("Toilet");
    expect(added.area_m2).toBeCloseTo(2.7, 2);
    expect(added.area_source).toBe("measured");
    // Its geometry is a placeholder, so it must not read as a confident parse.
    expect(added.confidence).toBeLessThan(LOW_CONFIDENCE_FLAG);
    expect(summary.label_only_room_ids).toEqual([added.id]);
    // Sized from the printed dimension, not a blind square: 2000 x 1350 mm at
    // 1:100 is 56.7 x 38.3 pt of a 1000 pt region.
    const xs = added.polygon.map((p) => p[0]);
    const ys = added.polygon.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.0567, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.0383, 3);
  });

  it("never lets a second label claim a room the first pass invented", () => {
    const rooms = [room("r1", "Family Area", rect(0.0, 0.0, 0.2, 0.2), 12, "living")];
    const { rooms: out, summary } = reconcileWithSheet(
      rooms,
      [
        label("F04", "BATH", [900, 880], [2585, 3400]),
        label("F08", "BATH", [900, 920], [2700, 1750]),
      ],
      REGION,
      SCALE,
    );
    // Two labels, neither matching the one real room: two additions, never one
    // addition that the other label then attaches itself to.
    expect(summary.label_only_room_ids).toHaveLength(2);
    expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
  });

  it("is deterministic", () => {
    const rooms = [
      room("a", "Bath", rect(0.0, 0.0, 0.3, 0.3), 8, "ensuite"),
      room("b", "Bath", rect(0.5, 0.5, 0.3, 0.3), 5, "bathroom"),
    ];
    const labels = [
      label("F04", "BATH", [150, 150], [2585, 3400]),
      label("F08", "BATH", [650, 650], [2700, 1750]),
    ];
    const first = reconcileWithSheet(rooms, labels, REGION, SCALE);
    const second = reconcileWithSheet(rooms, labels, REGION, SCALE);
    expect(second.rooms).toEqual(first.rooms);
    expect(second.summary).toEqual(first.summary);
    // and containment told the two same-named baths apart
    expect(first.rooms.find((r) => r.id === "a")!.area_m2).toBeCloseTo(8.79, 2);
    expect(first.rooms.find((r) => r.id === "b")!.area_m2).toBeCloseTo(4.72, 2);
  });
});
