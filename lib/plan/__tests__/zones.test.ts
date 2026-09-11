import { describe, expect, it } from "vitest";

import {
  INTERIOR_ROOM_TYPES,
  OUTDOOR_ROOM_TYPES,
  defaultUnroofed,
  isKnownRoomType,
  isOutdoorType,
  isPilotScoped,
  roomTypeLabel,
  roomTypeOptions,
} from "@/lib/plan/zones";

describe("zone vocabulary", () => {
  it("keeps the interior list in step with the parser prompt", () => {
    // The parser prompt (lib/parse/providers/inhouse.ts) lists these tokens as
    // canonical. If that list moves and this one does not, the editor's picker
    // starts offering types the parser will never produce — or worse, refuses a
    // type it already wrote to the database.
    expect([...INTERIOR_ROOM_TYPES]).toEqual([
      "master_bedroom",
      "bedroom",
      "bathroom",
      "ensuite",
      "powder",
      "closet",
      "living",
      "dining",
      "kitchen",
      "majlis",
      "maid",
      "laundry",
      "foyer",
      "stairs",
      "balcony",
      "terrace",
      "storage",
      "other",
    ]);
  });

  it("treats only the garden tokens as outdoor", () => {
    for (const t of OUTDOOR_ROOM_TYPES) expect(isOutdoorType(t)).toBe(true);
    for (const t of INTERIOR_ROOM_TYPES) expect(isOutdoorType(t)).toBe(false);
  });

  it("leaves balcony and terrace as interior rooms", () => {
    // These are enclosed rooms the parser already emits and EXTERNAL_TYPES
    // already prices. Reclassifying them as outdoor zones would silently change
    // the quantities of every villa parsed before the garden pilot.
    expect(isOutdoorType("balcony")).toBe(false);
    expect(isOutdoorType("terrace")).toBe(false);
    expect(defaultUnroofed("terrace")).toBe(false);
  });

  it("defaults outdoor zones to unroofed and interior rooms to roofed", () => {
    expect(defaultUnroofed("artificial_grass")).toBe(true);
    expect(defaultUnroofed("paving")).toBe(true);
    // A pergola footprint is open to the sky too; the 3D viewer gives it an
    // explicit canopy height rather than an implied 2.9 m ceiling.
    expect(defaultUnroofed("structure")).toBe(true);
    expect(defaultUnroofed("living")).toBe(false);
    expect(defaultUnroofed("other")).toBe(false);
    expect(defaultUnroofed(null)).toBe(false);
  });

  it("marks pool as stored but not priced", () => {
    expect(isOutdoorType("pool")).toBe(true);
    expect(isPilotScoped("pool")).toBe(false);
    expect(isPilotScoped("deck")).toBe(true);
    expect(isPilotScoped("living")).toBe(false);
  });

  it("recognises every token it offers", () => {
    for (const g of roomTypeOptions(true)) {
      for (const o of g.options) expect(isKnownRoomType(o.value)).toBe(true);
    }
    expect(isKnownRoomType("courtyard")).toBe(false);
    expect(isKnownRoomType(null)).toBe(false);
  });

  it("offers outdoor zones only when the pilot is on", () => {
    const off = roomTypeOptions(false);
    expect(off).toHaveLength(1);
    expect(off[0]!.options.map((o) => o.value)).toEqual([...INTERIOR_ROOM_TYPES]);

    const on = roomTypeOptions(true);
    expect(on).toHaveLength(2);
    expect(on[1]!.options.map((o) => o.value)).toEqual([...OUTDOOR_ROOM_TYPES]);
    // The one unpriced token says so in the picker rather than looking ready.
    expect(on[1]!.options.find((o) => o.value === "pool")?.note).toBeTruthy();
    expect(on[1]!.options.find((o) => o.value === "deck")?.note).toBeUndefined();
  });

  it("labels every token", () => {
    for (const t of [...INTERIOR_ROOM_TYPES, ...OUTDOOR_ROOM_TYPES]) {
      expect(roomTypeLabel(t)).not.toBe(t);
    }
    // An unknown token falls back to itself rather than to an empty string.
    expect(roomTypeLabel("courtyard")).toBe("courtyard");
    expect(roomTypeLabel(null)).toBe("Unclassified");
  });
});
