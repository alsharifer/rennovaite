import { describe, expect, it } from "vitest";

import { roomProgramme } from "@/lib/timeline/room-programme";

// The pilot bathroom's BoQ after the client's comments (19 Oct), the lines the programme reads.
const L = (rule_id: string, quantity: number, unit: string, item_key?: string) => ({ rule_id, quantity, unit, ...(item_key ? { item_key } : {}) });
const PILOT = [
  { work_section: "Demolition", lines: [L("W-04/R-03", 27.53, "m2", "demo.wall_tile_removal"), L("W-05/R-02", 7, "m2", "demo.floor_removal")] },
  { work_section: "Waterproofing", lines: [L("W-09/R-55", 8.46, "m2", "wp.membrane"), L("W-10/R-55", 4.64, "m2", "wp.membrane")] },
  { work_section: "Floor Finishes", lines: [L("P4/quantify/floor_finish", 7, "m2"), L("W-11/R-05", 7, "m2", "floor.screed_wet")] },
  { work_section: "Wall Finishes", lines: [L("P4/quantify/wet_tiling", 27.53, "m2")] },
  { work_section: "Ceilings", lines: [L("W-14/R-54", 7, "m2", "ceiling.repair")] },
  { work_section: "Joinery", lines: [L("W-28/R-69", 1, "no"), L("W-25/R-66", 1, "no")] },
  { work_section: "Aluminum & Glass", lines: [L("W-26/R-67", 1, "no"), L("W-18/R-72", 1, "no")] },
  { work_section: "Sanitaryware", lines: [L("Q-24a/R-40", 1, "no"), L("W-15/R-71", 1, "no"), L("W-29/R-70", 1, "no"), L("W-27/R-68", 1, "no")] },
  { work_section: "Electrical", lines: [L("Q-17/R-14", 2, "no"), L("Q-18/R-15", 3, "no"), L("W-19/R-60", 1, "no"), L("W-20/R-61", 1, "no")] },
  { work_section: "Plumbing & Sanitary", lines: ["wc_point", "basin_point", "shower_mixer", "floor_drain", "shattaf_point"].map((t) => L(`P2/overlay/${t}`, 1, "no")) },
];

describe("B7 1c — a one-room programme from the room's own quantities", () => {
  const p = roomProgramme(PILOT)!;
  it("the pilot bathroom: 14 working days, inside the 10–15 a bathroom takes — never the villa model's 32", () => {
    expect(p.total_days).toBe(14);
    expect(p.phases.map((ph) => [ph.label, ph.days])).toEqual([
      ["Protection & strip-out", 1],
      ["First fix — plumbing & electrical", 1],
      ["Screed to falls + cure", 2],
      ["Waterproofing + flood test", 2],
      ["Floor & wall tiling", 5],
      ["Ceiling repair & paint", 2],
      ["Fit-out — sanitaryware, vanity, glass, mirror", 2],
      ["Snagging, clean & handover", 1],
    ]);
  });
  it("every phase says how its days were derived; the ceiling runs alongside the tiling", () => {
    expect(p.phases.every((ph) => ph.basis.length > 0)).toBe(true);
    expect(p.phases.find((ph) => ph.label.startsWith("Floor & wall"))!.basis).toBe("34.53 m² ÷ 8 m²/day");
    const tiling = p.phases.find((ph) => ph.label.startsWith("Floor & wall"))!, ceiling = p.phases.find((ph) => ph.label.startsWith("Ceiling"))!;
    expect(ceiling).toMatchObject({ parallel: true, start_day: tiling.start_day });
  });
  it("no tiling on the BoQ → no programme (the page is dropped, never guessed)", () => {
    expect(roomProgramme(PILOT.filter((s) => s.work_section !== "Wall Finishes"))).toBeNull();
  });
});
