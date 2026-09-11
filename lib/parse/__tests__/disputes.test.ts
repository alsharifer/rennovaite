import { describe, expect, it } from "vitest";

import { disputesFromParsedJson, resolveDisputes } from "@/lib/parse/disputes";
import type { AreaDispute } from "@/lib/parse/repair";

const DISPUTE: AreaDispute = {
  room_id: "bathroom-01",
  stated_area_m2: 8.79,
  geometric_area_m2: 21.4,
};

const PARSED = [
  { id: "bathroom-01", name_en: "Bath", room_type: "ensuite" },
  { id: "bathroom-02", name_en: "Bath", room_type: "bathroom" },
];

const DB = [
  { id: "uuid-a", name_en: "Bath", room_type: "ensuite", area_m2: 8.79 },
  { id: "uuid-b", name_en: "Bath", room_type: "bathroom", area_m2: 4.72 },
];

describe("resolveDisputes", () => {
  it("re-addresses a dispute from the provider's slug to the database row", () => {
    // The parse writes "bathroom-01"; the database hands back a uuid. Without
    // this the flag reaches the editor addressed to a room that does not exist.
    expect(resolveDisputes([DISPUTE], PARSED, DB)).toEqual([
      { room_id: "uuid-a", stated_area_m2: 8.79, geometric_area_m2: 21.4 },
    ]);
  });

  it("tells two rooms of the same name apart by type and area", () => {
    const both = resolveDisputes(
      [DISPUTE, { room_id: "bathroom-02", stated_area_m2: 4.72, geometric_area_m2: 19 }],
      PARSED,
      DB,
    );
    expect(both.map((d) => d.room_id)).toEqual(["uuid-a", "uuid-b"]);
  });

  it("pairs genuinely indistinguishable rooms in order rather than guessing", () => {
    const twins = [
      { id: "t1", name_en: "Terrace", room_type: "terrace" },
      { id: "t2", name_en: "Terrace", room_type: "terrace" },
    ];
    const rows = [
      { id: "uuid-1", name_en: "Terrace", room_type: "terrace", area_m2: 16 },
      { id: "uuid-2", name_en: "Terrace", room_type: "terrace", area_m2: 16 },
    ];
    const out = resolveDisputes(
      [
        { room_id: "t1", stated_area_m2: 16, geometric_area_m2: 40 },
        { room_id: "t2", stated_area_m2: 16, geometric_area_m2: 41 },
      ],
      twins,
      rows,
    );
    expect(out.map((d) => d.room_id)).toEqual(["uuid-1", "uuid-2"]);
  });

  it("drops a dispute it cannot place rather than pointing at the wrong room", () => {
    // Someone already resolved this one by editing: the area no longer matches
    // what the dispute was raised against, so the key stops matching and the
    // issue is gone. Showing a contradiction about the wrong room is worse than
    // showing none.
    const edited = [{ id: "uuid-a", name_en: "Bath", room_type: "ensuite", area_m2: 21.4 }];
    expect(resolveDisputes([DISPUTE], PARSED, edited)).toEqual([]);
    expect(resolveDisputes([DISPUTE], [], DB)).toEqual([]);
  });

  it("does nothing when there is nothing to do", () => {
    expect(resolveDisputes([], PARSED, DB)).toEqual([]);
  });
});

describe("disputesFromParsedJson", () => {
  const good = {
    rooms: PARSED,
    parse: { disputes: [DISPUTE] },
  };

  it("reads disputes and the rooms needed to address them", () => {
    const out = disputesFromParsedJson(good);
    expect(out.disputes).toEqual([DISPUTE]);
    expect(out.rooms).toHaveLength(2);
  });

  it("returns nothing for every plan parsed before disputes existed", () => {
    // Every one of these is a real shape in the table: plans from before the
    // field, plans that simply had no dispute, and a null column.
    for (const shape of [
      null,
      undefined,
      {},
      { rooms: PARSED },
      { rooms: PARSED, parse: {} },
      { rooms: PARSED, parse: { disputes: [] } },
      { rooms: PARSED, parse: { disputed_area_room_ids: ["bathroom-01"] } },
      "not an object",
    ]) {
      expect(disputesFromParsedJson(shape).disputes).toEqual([]);
    }
  });

  it("skips malformed entries instead of throwing on someone's plan page", () => {
    const out = disputesFromParsedJson({
      rooms: PARSED,
      parse: { disputes: [{ room_id: "bathroom-01" }, null, DISPUTE] },
    });
    expect(out.disputes).toEqual([DISPUTE]);
  });
});
