import { describe, expect, it } from "vitest";

import {
  findComponentDuplicates,
  findNewComponentDuplicates,
  COMPONENT_OWNERS,
  type DedupeLine,
} from "../component-dedupe";
import {
  ledStripAllowance,
  mirrorCount,
  showerGlassCount,
  socketSwitchCounts,
  spotlightCount,
  vanitySlabCount,
  waterHeaterCount,
  SPOTLIGHT_AREA_DIVISOR_M2,
  SOCKET_AREA_STEP_M2,
  type ComponentRoom,
} from "../scope-components";

// Mudon Villa 94, first floor — the rooms these rules were written against.
const MUDON: ComponentRoom[] = [
  { id: "bath", type: "bathroom", area_m2: 10 },
  { id: "bed3", type: "bedroom", area_m2: 20 },
  { id: "bed4", type: "bedroom", area_m2: 16 },
  { id: "dress", type: "closet", area_m2: 5 },
  { id: "family", type: "living", area_m2: 14 },
  { id: "balcony", type: "balcony", area_m2: 9 },
  { id: "mbath", type: "ensuite", area_m2: 5 },
  { id: "mbed", type: "master_bedroom", area_m2: 18 },
  { id: "passage", type: "foyer", area_m2: 18 },
  { id: "stairs", type: "stairs", area_m2: 13 },
  { id: "terrace", type: "terrace", area_m2: 11 },
  { id: "terrace2", type: "terrace", area_m2: 22 },
  { id: "toilet", type: "powder", area_m2: 5 },
];

describe("spotlightCount (S6-01, G10)", () => {
  it("uses the stated divisor and counts interior rooms only", () => {
    const r = spotlightCount(MUDON);
    // Interior = 13 rooms less balcony + 2 terraces = 10.
    const expected = MUDON.filter((x) => !["balcony", "terrace"].includes(x.type!)).reduce(
      (s, x) => s + Math.ceil(x.area_m2 / SPOTLIGHT_AREA_DIVISOR_M2),
      0,
    );
    expect(r.quantity).toBe(expected);
    expect(r.measurement).toContain(String(SPOTLIGHT_AREA_DIVISOR_M2));
  });

  it("is always flagged derived — no drawing has been counted", () => {
    expect(spotlightCount(MUDON).derived).toBe(true);
  });

  it("excludes terraces and balconies", () => {
    const outdoorOnly = MUDON.filter((r) => ["balcony", "terrace"].includes(r.type!));
    expect(spotlightCount(outdoorOnly).quantity).toBe(0);
  });
});

describe("ledStripAllowance (S6-02, G10)", () => {
  it("covers living/dining/majlis/master only", () => {
    const r = ledStripAllowance(MUDON);
    // family (living) + mbed (master) — bedrooms 3/4 and wet rooms excluded.
    const solo = ledStripAllowance([
      { id: "a", type: "living", area_m2: 14 },
      { id: "b", type: "master_bedroom", area_m2: 18 },
    ]);
    expect(r.quantity).toBeCloseTo(solo.quantity, 6);
  });

  it("gives a bathroom or a corridor no cove at all", () => {
    expect(
      ledStripAllowance([
        { id: "b", type: "bathroom", area_m2: 10 },
        { id: "p", type: "passage", area_m2: 18 },
      ]).quantity,
    ).toBe(0);
  });

  it("returns linear metres, and a bigger room gets a longer run", () => {
    const small = ledStripAllowance([{ id: "a", type: "living", area_m2: 9 }]);
    const big = ledStripAllowance([{ id: "a", type: "living", area_m2: 36 }]);
    expect(small.unit).toBe("lm");
    expect(big.quantity).toBeGreaterThan(small.quantity);
  });
});

describe("waterHeaterCount (S6-03, G12)", () => {
  it("is one per wet-room cluster", () => {
    // bathroom + ensuite + powder = 3, matching what R-17 already assumes.
    expect(waterHeaterCount(MUDON).quantity).toBe(3);
  });

  it("excludes kitchens — they run off the nearest bathroom heater", () => {
    const withKitchen = [...MUDON, { id: "k", type: "kitchen", area_m2: 12 }];
    expect(waterHeaterCount(withKitchen).quantity).toBe(3);
  });

  it("counts nothing in a villa with no wet rooms", () => {
    expect(waterHeaterCount([{ id: "a", type: "living", area_m2: 20 }]).quantity).toBe(0);
  });
});

describe("socketSwitchCounts (S6-04, G13)", () => {
  it("scales sockets with area for rooms whose type scales", () => {
    const small = socketSwitchCounts([{ id: "a", type: "bedroom", area_m2: 5 }]);
    const large = socketSwitchCounts([{ id: "a", type: "bedroom", area_m2: 30 }]);
    expect(large.sockets.quantity).toBeGreaterThan(small.sockets.quantity);
    // base 3 + floor(30/6) = 3 + 5 = 8
    expect(large.sockets.quantity).toBe(3 + Math.floor(30 / SOCKET_AREA_STEP_M2));
  });

  it("does NOT scale sockets in wet rooms — a bigger bathroom wants the same shaver point", () => {
    const small = socketSwitchCounts([{ id: "a", type: "bathroom", area_m2: 4 }]);
    const large = socketSwitchCounts([{ id: "a", type: "bathroom", area_m2: 40 }]);
    expect(large.sockets.quantity).toBe(small.sockets.quantity);
  });

  it("gives two-way switching to stairs and bedrooms, single elsewhere", () => {
    expect(socketSwitchCounts([{ id: "s", type: "stairs", area_m2: 13 }]).switches.quantity).toBe(2);
    expect(socketSwitchCounts([{ id: "b", type: "bedroom", area_m2: 16 }]).switches.quantity).toBe(2);
    expect(socketSwitchCounts([{ id: "m", type: "master_bedroom", area_m2: 18 }]).switches.quantity).toBe(2);
    expect(socketSwitchCounts([{ id: "l", type: "living", area_m2: 14 }]).switches.quantity).toBe(1);
  });

  it("ignores exterior rooms entirely", () => {
    const r = socketSwitchCounts([{ id: "t", type: "terrace", area_m2: 22 }]);
    expect(r.sockets.quantity).toBe(0);
    expect(r.switches.quantity).toBe(0);
  });

  it("states the rule in the measurement so a QS can re-derive it", () => {
    const r = socketSwitchCounts(MUDON);
    expect(r.sockets.measurement).toContain(String(SOCKET_AREA_STEP_M2));
    expect(r.switches.measurement).toContain("two-way");
  });
});

describe("vanitySlabCount (S6-05, G19)", () => {
  it("is driven by vanity units, not by room count", () => {
    expect(vanitySlabCount(3).quantity).toBe(3);
    expect(vanitySlabCount(0).quantity).toBe(0);
  });

  it("never returns a negative or fractional slab", () => {
    expect(vanitySlabCount(-2).quantity).toBe(0);
    expect(vanitySlabCount(2.7).quantity).toBe(2);
  });
});

describe("showerGlassCount / mirrorCount (S6-06/07, G21)", () => {
  it("gives glass to bathrooms and ensuites but not to a powder room", () => {
    expect(showerGlassCount(MUDON).quantity).toBe(2); // bath + mbath, not toilet
  });

  it("gives every wet room a mirror, including the powder room", () => {
    expect(mirrorCount(MUDON, 3).quantity).toBe(3);
  });

  it("follows the joinery scope when it carries more vanities than wet rooms", () => {
    expect(mirrorCount(MUDON, 5).quantity).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Dedupe — the invariant that matters most here. A component priced twice is
// money the client is charged twice.
// ---------------------------------------------------------------------------

const line = (o: Partial<DedupeLine>): DedupeLine => ({
  work_section: "Electrical",
  description: "x",
  ...o,
});

describe("component dedupe", () => {
  it("passes a BoQ where each component is priced once", () => {
    const lines = [
      line({ item_key: "elec.downlight" }),
      line({ item_key: "light.led_strip" }),
      line({ item_key: "plumb.water_heater" }),
      line({ item_key: "join.vanity_slab" }),
      line({ item_key: "alum.shower_glass" }),
      line({ item_key: "alum.mirror" }),
    ];
    expect(findComponentDuplicates(lines)).toEqual([]);
  });

  it("does not report the fitting and its wiring allowance as a duplicate", () => {
    const found = findComponentDuplicates([
      line({ item_key: "elec.downlight", description: "LED downlights" }),
      line({ rule_id: "P2/overlay/light_point", description: "Ceiling light point", total_aed: 1870 }),
    ]);
    expect(found).toEqual([]);
  });

  it("catches the same component priced by a rule AND an overlay", () => {
    const lines = [
      line({ item_key: "elec.point", description: "Power sockets and switches" }),
      line({ rule_id: "P2/overlay/socket_13a", description: "13A twin socket", total_aed: 2640 }),
    ];
    const found = findComponentDuplicates(lines);
    expect(found).toHaveLength(1);
    expect(found[0]!.component).toBe("socket");
    expect(found[0]!.duplicate_mechanism).toBe("overlay");
    expect(found[0]!.duplicate_total_aed).toBe(2640);
  });

  it("catches the water heater duplicate even while its rate is zero", () => {
    // The overlay line currently prices at 0/needs_qs, so the double-count is
    // free today. It must still be reported — the defect is the second line
    // existing, not the money it happens to carry right now.
    const found = findComponentDuplicates([
      line({ item_key: "plumb.water_heater" }),
      line({ rule_id: "P2/overlay/water_heater", total_aed: 0 }),
    ]);
    expect(found.map((f) => f.component)).toContain("water_heater");
  });

  it("reports nothing when the owner line is absent", () => {
    // An overlay socket line with no R-15 line is not a duplicate, it is the
    // only one. Reporting it would train people to ignore the check.
    expect(findComponentDuplicates([line({ rule_id: "P2/overlay/socket_13a" })])).toEqual([]);
  });

  it("keeps the S6 components clean of duplicates independently", () => {
    // A pre-existing legacy conflict must never mask a new one, so the S6
    // filter is asserted separately from the full scan.
    const lines = [
      line({ item_key: "elec.point" }),
      line({ rule_id: "P2/overlay/socket_13a" }), // legacy conflict, present
      line({ item_key: "light.led_strip" }),
      line({ item_key: "join.vanity_slab" }),
      line({ item_key: "alum.shower_glass" }),
      line({ item_key: "alum.mirror" }),
    ];
    expect(findComponentDuplicates(lines).length).toBeGreaterThan(0);
    expect(findNewComponentDuplicates(lines)).toEqual([]);
  });

  it("names exactly one owner per component", () => {
    const keys = COMPONENT_OWNERS.map((c) => c.component);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of COMPONENT_OWNERS) {
      expect(c.conflicts.every((x) => x.key !== c.owner_key), c.component).toBe(true);
    }
  });

  it("asserts the staircase carries labour and tile in separate places (G15)", () => {
    const owner = COMPONENT_OWNERS.find((c) => c.component === "stair_tile")!;
    expect(owner.owner_key).toBe("floor.stair_tile");
    expect(owner.conflicts.map((c) => c.key)).toContain("stairs.renovation");
    // Both present is the double-count G15 warns about.
    const found = findComponentDuplicates([
      line({ item_key: "floor.stair_tile" }),
      line({ item_key: "stairs.renovation" }),
    ]);
    expect(found.map((f) => f.component)).toContain("stair_tile");
  });
});

describe("dedupe against a STORED BoQ (rule_id only, no item_key)", () => {
  // A persisted BoQ line carries no item_key — only "Q-18/R-15". Matching on
  // item_key alone found the owner in a freshly built take-off and never in a
  // stored one, so the notice silently never rendered. These pin the shape the
  // BoQ actually stores.
  const storedLine = (rule_id: string, work_section: string, total_aed = 0): DedupeLine => ({
    work_section,
    description: rule_id,
    rule_id,
    total_aed,
  });

  it("finds the socket duplicate from stored rule ids", () => {
    const found = findComponentDuplicates([
      storedLine("Q-18/R-15", "Electrical", 12760),
      storedLine("P2/overlay/socket_13a", "Electrical Installations", 2640),
    ]);
    expect(found.map((f) => f.component)).toContain("socket");
  });

  it("finds the water-heater duplicate from stored rule ids", () => {
    const found = findComponentDuplicates([
      storedLine("Q-20/R-17", "Plumbing", 15000),
      storedLine("P2/overlay/water_heater", "Plumbing & Sanitary", 0),
    ]);
    expect(found.map((f) => f.component)).toContain("water_heater");
  });

  it("reports both pairs together, as the live Mudon BoQ contains them", () => {
    const found = findComponentDuplicates([
      storedLine("Q-17/R-14", "Electrical", 12000),
      storedLine("Q-18/R-15", "Electrical", 12760),
      storedLine("Q-20/R-17", "Plumbing", 15000),
      storedLine("P2/overlay/socket_13a", "Electrical Installations", 2640),
      storedLine("P2/overlay/switch_1g", "Electrical Installations", 810),
      storedLine("P2/overlay/switch_2way", "Electrical Installations", 1300),
      storedLine("P2/overlay/light_point", "Electrical Installations", 1870),
      storedLine("P2/overlay/water_heater", "Plumbing & Sanitary", 0),
    ]);
    const components = new Set(found.map((f) => f.component));
    expect(components).toContain("socket");
    expect(components).toContain("water_heater");
    // Spotlights are NOT a duplicate: R-14 prices the fitting, the overlay
    // light_point line is the wiring allowance feeding it. Reporting that pair
    // would put a false claim in front of the QS.
    expect(components).not.toContain("spotlight");
    // Sockets duplicate across three overlay keys; the money is the sum.
    const socketExposure = found
      .filter((f) => f.component === "socket")
      .reduce((s, f) => s + f.duplicate_total_aed, 0);
    expect(socketExposure).toBe(2640 + 810 + 1300);
  });
});
