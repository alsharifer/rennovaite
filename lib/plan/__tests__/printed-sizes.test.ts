import { describe, expect, it } from "vitest";

import {
  matchPrintedSizes,
  planM2PerUnit2,
  PRINTED_TOLERANCE,
  printedSizeCheck,
  printedSizeSentence,
  printedSizesFromParsedJson,
} from "../printed-sizes";

const rect = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

describe("printed sizes (15 Oct)", () => {
  const parsed = {
    rooms: [
      { id: "master-bedroom", name_en: "Master Bedroom", room_type: "bedroom", area_m2: 19.93, area_source: "measured" },
      { id: "dress", name_en: "Dress", room_type: "closet", area_m2: 4.65, area_source: "measured" },
      { id: "bath-1", name_en: "Bath", room_type: "bathroom", area_m2: 5.2, area_source: "measured" },
      { id: "bath-2", name_en: "Bath", room_type: "bathroom", area_m2: 4.8, area_source: "measured" },
      { id: "passage", name_en: "Passage", room_type: "corridor", area_m2: 9, area_source: "estimated" },
    ],
  };

  it("reads only the sizes the sheet printed", () => {
    expect(printedSizesFromParsedJson(parsed).map((p) => p.name)).toEqual(["Master Bedroom", "Dress", "Bath", "Bath"]);
    expect(printedSizesFromParsedJson(null)).toEqual([]);
    expect(printedSizesFromParsedJson({ rooms: "x" })).toEqual([]);
  });

  it("matches by name; a name printed twice, a renamed room or a different type gets no printed size", () => {
    const rooms = [
      { id: "a", name_en: "master bedroom ", room_type: "bedroom" },
      { id: "b", name_en: "Dress", room_type: "bedroom" }, // type disagrees
      { id: "c", name_en: "Bath", room_type: "bathroom" }, // printed twice
      { id: "d", name_en: "Guest Suite", room_type: "bedroom" }, // renamed
    ];
    expect([...matchPrintedSizes(rooms, printedSizesFromParsedJson(parsed))]).toEqual([["a", 19.93]]);
  });

  it("flags a room whose outline is more than 10% off its printed size, at the plan's own scale", () => {
    // 1 unit = 1 m (total 20 + 12 over 32 units²). Master 20 m² drawn vs 16 printed (+25%), Dress 12 vs 11.5 (+4%).
    const rooms = [
      { id: "m", name_en: "Master Bedroom", polygon: rect(0, 0, 5, 4), area_m2: 16 },
      { id: "d", name_en: "Dress", polygon: rect(5, 0, 3, 4), area_m2: 11.5 },
    ];
    const k = planM2PerUnit2(rooms, 32);
    expect(k).toBe(1);
    const flags = printedSizeCheck(rooms, new Map([["m", 16], ["d", 11.5]]), k);
    expect(flags.map((f) => f.id)).toEqual(["m"]);
    expect(printedSizeSentence(flags[0]!)).toBe("Master Bedroom is drawn at 20.0 m² — the sheet prints 16.0 m² (25% over).");
  });

  it("10% exactly is not flagged; under is said as under", () => {
    const rooms = [
      { id: "x", name_en: "X", polygon: rect(0, 0, 11, 1) },
      { id: "y", name_en: "Y", polygon: rect(0, 1, 7, 1) },
    ];
    const flags = printedSizeCheck(rooms, new Map([["x", 10], ["y", 10]]), 1);
    expect(PRINTED_TOLERANCE).toBe(0.1);
    expect(flags.map((f) => f.id)).toEqual(["y"]);
    expect(printedSizeSentence(flags[0]!)).toMatch(/30% under/);
  });

  it("no scale, no flags", () => {
    expect(printedSizeCheck([{ id: "x", polygon: rect(0, 0, 1, 1) }], new Map([["x", 5]]), null)).toEqual([]);
    expect(planM2PerUnit2([], null)).toBeNull();
  });
});
