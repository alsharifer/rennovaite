import { describe, expect, it } from "vitest";

import {
  computeGardenTakeoff,
  findDoubleCounts,
  priceGardenTakeoff,
  type GardenTakeoffInput,
} from "@/lib/boq/garden-takeoff";
import { LANDSCAPE_TYPES, SECTION_ORDER } from "@/lib/boq/rules";
import { computeTakeoff } from "@/lib/boq/takeoff";
import { buildGardenSections } from "@/lib/boq/garden-boq-feed";
import { POMI_SECTIONS } from "@/lib/boq/schema";
import {
  ABSORBED_SCOPE,
  CONTRACT_LINES,
  GARDEN_RATES,
  INCLUSIVE_SCOPE,
  INTERNAL_REF,
  NET_FACTOR,
  PERGOLA_INCLUDED_DOWNLIGHTS,
  PUBLIC_SOURCE_LABEL,
  QUANTITY_INCLUSIONS,
  TOTALS,
  getGardenRate,
  netRate,
  ratesAreConsistent,
} from "@/lib/ground-truth/villa94-garden";

// ---------------------------------------------------------------------------
// The reference garden, rebuilt from the contract's own quantities.
// ---------------------------------------------------------------------------

const VILLA94: GardenTakeoffInput = {
  zones: [
    // D1.2 front 27 m² + D1.3 back 60 m² of paving install.
    { id: "front", name: "Front yard", kind: "paving", area_m2: 27 },
    { id: "back", name: "Backyard", kind: "paving", area_m2: 60 },
    // G1.1 artificial grass, 71 m².
    { id: "lawn", name: "Lawn", kind: "artificial_grass", area_m2: 71 },
    // E1.1 pergola, 12.25 m² plan.
    { id: "pergola", name: "Pergola", kind: "structure", area_m2: 12.25 },
  ],
  runs: [
    { id: "bbq", kind: "counter_run", length_m: 3.0, variant: "bbq" }, // D1.4
    { id: "bar", kind: "counter_run", length_m: 3.4, variant: "bar" }, // D1.5
    { id: "bench", kind: "bench_run", length_m: 7.5 }, // D1.8
    { id: "planter", kind: "planter_run", length_m: 7.8 }, // D1.9
  ],
  units: [
    { id: "olive", kind: "planter_box" }, // D1.6
    { id: "arch", kind: "wall_feature" }, // D1.7
    { id: "grill", kind: "bbq_grill" }, // client-supplied
  ],
  points: [
    // I.1/I.2: 28 lighting points. Eight of them are the pergola's own
    // downlights, which E1.1's m²-plan rate already carries.
    ...Array.from({ length: 8 }, (_, i) => ({ id: `pg${i}`, type: "garden_light", zone_id: "pergola" })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, type: "garden_light", zone_id: "back" })),
    // The variation: 9 boundary wall lights.
    ...Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, type: "boundary_light", zone_id: null })),
  ],
};

const takeoff = computeGardenTakeoff(VILLA94);
const priced = priceGardenTakeoff(takeoff.items);
const line = (key: string) => priced.find((l) => l.item_key === key);
const has = (key: string) => takeoff.items.some((i) => i.item_key === key);

// ---------------------------------------------------------------------------

describe("Villa 94 rate transcription", () => {
  it("carries all twenty work items", () => {
    expect(GARDEN_RATES).toHaveLength(20);
    expect(new Set(GARDEN_RATES.map((g) => g.item_key)).size).toBe(20);
  });

  it("never re-applies the discount to a rate that is already net", () => {
    // Three rows arrive net for their own reasons: the tile is a client
    // purchase at its own 39%, the boundary lights were a variation priced net,
    // and the grill is equipment. Discounting those again would understate every
    // future garden by 12% on exactly the lines a client pays directly.
    expect(ratesAreConsistent()).toEqual([]);
    for (const key of ["garden.tile_supply", "garden.boundary_light", "garden.bbq_grill"]) {
      const g = getGardenRate(key)!;
      expect(g.already_net, key).toBe(true);
      expect(g.net_rate, key).toBe(g.list_rate);
    }
    // And the rest genuinely are discounted.
    const pcc = getGardenRate("garden.pcc_base")!;
    expect(pcc.already_net).toBe(false);
    expect(pcc.net_rate).toBe(netRate(120));
    expect(pcc.net_rate).toBe(105.6);
  });

  it("reconciles to the signed contract and the project total", () => {
    const quoted = CONTRACT_LINES.reduce((s, l) => s + l.amount, 0);
    expect(quoted).toBe(TOTALS.subtotal_pre_discount);
    expect(Math.round(quoted * (1 - NET_FACTOR) * 100) / 100).toBe(TOTALS.discount_aed);
    expect(Math.round((quoted - TOTALS.discount_aed) * 100) / 100).toBe(TOTALS.contract_excl_vat);
    expect(
      Math.round((TOTALS.contract_excl_vat + TOTALS.variation_boundary_lights) * 100) / 100,
    ).toBe(TOTALS.contractor_total);
    expect(
      Math.round(
        (TOTALS.client_supplied.outdoor_tile + TOTALS.client_supplied.bbq_grill) * 100,
      ) / 100,
    ).toBe(TOTALS.client_supplied.subtotal);
    expect(
      Math.round((TOTALS.contractor_total + TOTALS.client_supplied.subtotal) * 100) / 100,
    ).toBe(TOTALS.project_total);
  });

  it("records the boundary-light variation at its stated unit price", () => {
    expect(getGardenRate("garden.boundary_light")!.net_rate * 9).toBe(
      TOTALS.variation_boundary_lights,
    );
  });

  it("keeps the contractor's identity out of everything that renders", () => {
    // The one place the name may appear is INTERNAL_REF. Nothing a client sees
    // may carry it — these are one firm's negotiated prices, shared in
    // confidence, and the client they would reach is not theirs.
    expect(INTERNAL_REF).toMatch(/KAME/);
    expect(PUBLIC_SOURCE_LABEL).not.toMatch(/KAME/i);
    for (const l of priced) {
      expect(l.vendor_or_source, l.item_key).toBe(PUBLIC_SOURCE_LABEL);
      expect(`${l.description} ${l.measurement}`).not.toMatch(/KAME/i);
    }
    for (const g of GARDEN_RATES) {
      expect(`${g.label} ${g.note ?? ""}`, g.item_key).not.toMatch(/KAME/i);
    }
  });
});

describe("garden take-off — quantities", () => {
  it("measures hardscape, softscape and structures off the drawn zones", () => {
    expect(takeoff.summary.pavedAreaM2).toBe(87); // 27 + 60
    expect(takeoff.summary.grassAreaM2).toBe(71);
    expect(takeoff.summary.structurePlanAreaM2).toBe(12.25);
    expect(line("garden.grass_supply")!.quantity).toBe(71);
    expect(line("garden.grass_install")!.quantity).toBe(71);
    expect(line("garden.pergola")!.quantity).toBe(12.25);
  });

  it("paves the ground under a structure, because the structure did not remove it", () => {
    // A pergola stands ON a terrace. The slab is still poured and the tile is
    // still laid beneath it; only the superstructure is in the pergola's all-in
    // rate. Measuring "paved zones minus structures" under-measured every
    // hardscape line by the footprint — caught by the calibration dry-run.
    const surface = 87 + 12.25;
    expect(line("garden.pcc_base")!.quantity).toBe(surface);
    expect(line("garden.paving_install")!.quantity).toBe(surface);
    expect(line("garden.tile_supply")!.quantity).toBe(surface);
    expect(line("garden.pcc_base")!.measurement).toMatch(/under structures/);
    // The pergola is still priced once, as a structure.
    expect(line("garden.pergola")!.quantity).toBe(12.25);
  });

  it("prices each run at its own rate, with counters split by variant", () => {
    // A BBQ counter and a bar counter are both counter_run on the plan and
    // differ by AED 968/lm, because one carries a sink, water and sockets.
    expect(line("garden.counter_bbq")!.quantity).toBe(3);
    expect(line("garden.counter_bar")!.quantity).toBe(3.4);
    expect(line("garden.counter_bbq")!.rate_aed).toBe(5280);
    expect(line("garden.counter_bar")!.rate_aed).toBe(4312);
    expect(line("garden.bench_run")!.quantity).toBe(7.5);
    expect(line("garden.planter_bench_run")!.quantity).toBe(7.8);
  });

  it("defaults an undescribed counter to the bar rate, never the BBQ one", () => {
    const t = computeGardenTakeoff({
      zones: [],
      runs: [{ id: "c", kind: "counter_run", length_m: 2 }],
    });
    expect(t.items.some((i) => i.item_key === "garden.counter_bar")).toBe(true);
    expect(t.items.some((i) => i.item_key === "garden.counter_bbq")).toBe(false);
  });

  it("flags tile supply for site assessment rather than pricing drawn area as bought", () => {
    // The reference order covered all paving AND cladding from 66.24 m² against
    // 87 m² of quoted paving. Drawn area is an upper bound on what gets bought.
    const tile = line("garden.tile_supply")!;
    expect(tile.rate_status).toBe("site_assessment");
    expect(tile.rate_aed).toBe(128.1);
  });

  it("prices no hardscape at all when there is only a lawn", () => {
    const t = computeGardenTakeoff({
      zones: [{ id: "g", name: "Lawn", kind: "artificial_grass", area_m2: 40 }],
    });
    for (const key of ["garden.pcc_base", "garden.paving_install", "garden.tile_supply"]) {
      expect(t.items.some((i) => i.item_key === key), key).toBe(false);
    }
  });

  it("prices irrigation as a banded allowance, never a per-metre formula", () => {
    // One comparable project cannot support a driver that scales. Presenting it
    // as one would make the line look measured, so it stays a lump at three
    // coarse sizes and says both things about itself: the rate needs confirming
    // on site, and the size band is inferred.
    const irr = line("garden.irrigation")!;
    expect(irr.qty_derived).toBe(true);
    expect(irr.rate_status).toBe("site_assessment");
    expect(irr.unit).toBe("lump");
    expect(irr.quantity).toBe(1); // the reference garden sits in the middle band
    expect(irr.rate_aed).toBe(11_000);
    expect(irr.measurement).toMatch(/NOT measured/);

    const big = computeGardenTakeoff({
      zones: [{ id: "p", name: "Beds", kind: "planting_bed", area_m2: 400 }],
      runs: [{ id: "r", kind: "planter_run", length_m: 60 }],
    });
    const scaled = big.items.find((i) => i.item_key === "garden.irrigation")!;
    // G5c: one allowance line — quantity 1, the band in the rate — never "1.6 lump".
    expect(scaled.quantity).toBe(1);
    expect(scaled.rate_factor).toBe(1.6); // the large band, not 59×
    expect(scaled.measurement).toContain("large band = 1.6 × the reference irrigation lump (AED 11,000) = AED 17,600");
    const [priced] = priceGardenTakeoff([scaled]);
    expect([priced!.quantity, priced!.rate_aed, priced!.total_aed]).toEqual([1, 17_600, 17_600]);

    const small = computeGardenTakeoff({
      zones: [{ id: "p", name: "Bed", kind: "planting_bed", area_m2: 2 }],
    });
    const smallIrr = small.items.find((i) => i.item_key === "garden.irrigation")!;
    expect([smallIrr.quantity, smallIrr.rate_factor]).toEqual([1, 0.6]);
  });

  it("flags an untyped counter instead of silently pricing it as a bar", () => {
    // A bar counter and a BBQ counter are both counter_run and differ by AED
    // 968/lm. Defaulting is right; defaulting SILENTLY is not.
    const t = computeGardenTakeoff({
      zones: [],
      runs: [
        { id: "a", kind: "counter_run", length_m: 2 },
        { id: "b", kind: "counter_run", length_m: 3, variant: "bar" },
      ],
    });
    const bar = t.items.find((i) => i.item_key === "garden.counter_bar")!;
    expect(bar.quantity).toBe(5); // both, totalled once
    expect(bar.rate_status).toBe("needs_selection");
    expect(bar.measurement).toMatch(/not yet typed/);

    // Once every counter is typed the flag clears.
    const typed = computeGardenTakeoff({
      zones: [],
      runs: [{ id: "b", kind: "counter_run", length_m: 3, variant: "bar" }],
    });
    expect(typed.items.find((i) => i.item_key === "garden.counter_bar")!.rate_status).toBeUndefined();
  });

  it("emits no irrigation when there is nothing to irrigate", () => {
    const t = computeGardenTakeoff({
      zones: [{ id: "p", name: "Patio", kind: "paving", area_m2: 20 }],
    });
    expect(t.items.some((i) => i.item_key === "garden.irrigation")).toBe(false);
  });

  it("prices a `path` zone as hardscape and leaves `pool` unpriced", () => {
    const t = computeGardenTakeoff({
      zones: [
        { id: "a", name: "Path", kind: "path", area_m2: 10 },
        { id: "b", name: "Pool", kind: "pool", area_m2: 30 },
      ],
    });
    expect(t.summary.pavedAreaM2).toBe(10);
    // Pool is stored but out of pilot scope: no rate exists, so no line does.
    expect(t.items.every((i) => i.quantity > 0)).toBe(true);
    expect(t.summary.grassAreaM2).toBe(0);
  });

  it("returns nothing at all for an empty garden", () => {
    expect(computeGardenTakeoff({ zones: [] }).items).toEqual([]);
  });
});

describe("anti-double-count invariants", () => {
  it("the reference take-off is clean", () => {
    expect(findDoubleCounts(takeoff.items)).toEqual([]);
  });

  it("BBQ counter is inclusive of its MEP and sockets", () => {
    expect(has("garden.counter_bbq")).toBe(true);
    for (const child of INCLUSIVE_SCOPE["garden.counter_bbq"]!) {
      expect(has(child), `${child} must not be a separate line`).toBe(false);
    }
    // And the guard actually catches it if someone adds one later.
    const bad = findDoubleCounts([
      ...takeoff.items,
      { rule_id: "X", work_section: "Plumbing", item_key: "garden.mep_point", description: "MEP point", quantity: 1, unit: "no", measurement: "" },
    ]);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.kind).toBe("inclusive");
    expect(bad[0]!.parent).toBe("garden.counter_bbq");
    expect(bad[0]!.offender).toBe("garden.mep_point");
  });

  it("pergola is inclusive of its eight downlights", () => {
    // 28 points on site, 8 of them inside the pergola. The pergola's m²-plan
    // rate already carries those, so only 20 reach the lighting lines.
    expect(takeoff.summary.lightingPointsIncludedInStructures).toBe(
      PERGOLA_INCLUDED_DOWNLIGHTS,
    );
    expect(takeoff.summary.lightingPoints).toBe(20);
    expect(line("garden.light_cabling")!.quantity).toBe(20);
    expect(line("garden.light_fitting")!.quantity).toBe(20);
    expect(line("garden.light_cabling")!.measurement).toMatch(/less 8 carried by the structure rate/);
  });

  it("prices pergola lights beyond the included eight", () => {
    const t = computeGardenTakeoff({
      zones: [{ id: "pg", name: "Pergola", kind: "structure", area_m2: 12 }],
      points: Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, type: "garden_light", zone_id: "pg" })),
    });
    // Eight are included; the three somebody added on top are real extras.
    expect(t.summary.lightingPoints).toBe(3);
  });

  it("grass install is inclusive of base, sand and borders", () => {
    expect(has("garden.grass_install")).toBe(true);
    for (const child of INCLUSIVE_SCOPE["garden.grass_install"]!) {
      expect(has(child), `${child} must not be a separate line`).toBe(false);
    }
  });

  it("emits no line for scope the contract absorbed", () => {
    // Manhole covers, drainage points, sweet soil, edging and fertilizer were
    // all quoted at zero and absorbed. A line for any of them invents a cost.
    for (const key of ABSORBED_SCOPE) {
      expect(has(key), key).toBe(false);
    }
    const bad = findDoubleCounts([
      ...takeoff.items,
      { rule_id: "X", work_section: "Hardscape & Structures", item_key: "garden.manhole_cover", description: "Manhole covers", quantity: 2, unit: "no", measurement: "" },
    ]);
    expect(bad.some((v) => v.kind === "absorbed" && v.offender === "garden.manhole_cover")).toBe(true);
  });

  it("never prices a drainage point, which is both absorbed and BBQ-inclusive", () => {
    const t = computeGardenTakeoff({
      zones: [{ id: "p", name: "Patio", kind: "paving", area_m2: 30 }],
      runs: [{ id: "c", kind: "counter_run", length_m: 3, variant: "bbq" }],
      points: Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, type: "drainage_point", zone_id: "p" })),
    });
    expect(t.items.some((i) => i.item_key === "garden.drainage_point")).toBe(false);
    expect(findDoubleCounts(t.items)).toEqual([]);
  });
});

describe("nothing interior moves", () => {
  it("adds landscape sections without touching the interior order", () => {
    // The first fourteen entries are the interior order, unchanged. A section
    // with no lines is filtered out before rendering, so their existence cannot
    // change an interior BoQ.
    expect(SECTION_ORDER.slice(0, 14)).toEqual([
      "Demolition",
      "Blockwork",
      "Plaster",
      "Floor Finishes",
      "Wall Finishes",
      "Ceilings",
      "Decoration & Painting",
      "Joinery & Carpentry",
      "Electrical",
      "Plumbing",
      "Sanitaryware",
      "MEP / HVAC",
      "Lighting",
      "Preliminaries",
    ]);
    expect(SECTION_ORDER.slice(14)).toEqual([
      "Hardscape & Structures",
      "Soft Landscaping",
      "Irrigation",
      "Electrical & Lighting",
    ]);
    for (const s of SECTION_ORDER) expect(POMI_SECTIONS).toContain(s);
  });

  it("keeps every garden item_key out of the interior rate rules", () => {
    // Garden rates live in the rate book, not in RATE_RULES. If a key ever
    // appeared in both, the interior resolver would start answering for it.
    for (const g of GARDEN_RATES) expect(g.item_key.startsWith("garden.")).toBe(true);
  });

  it("prices only zone kinds the interior engine already refuses to touch", () => {
    const priceable = new Set(["paving", "path", "artificial_grass", "planting_bed", "structure", "pool", "deck"]);
    for (const k of priceable) expect(LANDSCAPE_TYPES.has(k)).toBe(true);
  });
});

describe("quantity inclusions are declared, not hard-coded", () => {
  it("keeps a pergola from zeroing every garden light", () => {
    // The failure this pins: listing the lighting keys as line-level inclusions
    // made a garden with a pergola price no lighting at all. The lighting line
    // must survive a pergola and simply lose eight points per structure.
    expect(INCLUSIVE_SCOPE["garden.pergola"]).not.toContain("garden.light_cabling");
    expect(QUANTITY_INCLUSIONS["garden.pergola"]!.map((q) => q.item_key).sort()).toEqual([
      "garden.light_cabling",
      "garden.light_fitting",
    ]);
    for (const q of QUANTITY_INCLUSIONS["garden.pergola"]!) {
      expect(q.qty_per_unit).toBe(PERGOLA_INCLUDED_DOWNLIGHTS);
    }
  });
});

describe("per-element breakdown", () => {
  it("splits every area and length rule back to the zone or run that produced it", () => {
    // This is what makes a garden line traceable: the aggregated quantity is
    // the SUM of these rows, so a zone can be asked what it costs.
    const byKey = new Map<string, number>();
    for (const e of takeoff.elements) {
      byKey.set(e.item_key, Math.round(((byKey.get(e.item_key) ?? 0) + e.qty) * 100) / 100);
    }
    for (const [key, total] of byKey) {
      const line = takeoff.items.find((i) => i.item_key === key)!;
      expect(total, `Σ elements for ${key}`).toBeCloseTo(line.quantity, 2);
    }
    // Paving splits across both paved zones, not one lumped row.
    // Two paved zones plus the pergola footprint.
    expect(takeoff.elements.filter((e) => e.item_key === "garden.pcc_base")).toHaveLength(3);
    expect(takeoff.elements.filter((e) => e.item_key === "garden.counter_bbq")).toHaveLength(1);
    expect(takeoff.elements.filter((e) => e.item_key === "garden.wall_feature")).toHaveLength(1);
  });

  it("emits no element rows for the project lumps", () => {
    // A lump has no element to attribute it to, and inventing one would make
    // "what does this zone cost" wrong for every zone.
    for (const key of ["garden.preliminaries", "garden.mobilization", "garden.demolition", "garden.irrigation"]) {
      expect(takeoff.elements.some((e) => e.item_key === key), key).toBe(false);
    }
  });
});

describe("a garden-only project gets no interior take-off", () => {
  it("emits nothing, not even preliminaries, when there are no interior rooms", () => {
    // Interior preliminaries are the scaffold, floor protection and skip hire of
    // an INTERIOR fit-out. A garden has its own preliminaries from the landscape
    // rules, and emitting both charged for site establishment twice — which is
    // exactly what the calibration dry-run found.
    const t = computeTakeoff(
      [
        { id: "a", name: "Lawn", room_type: "artificial_grass", area_m2: 60 },
        { id: "b", name: "Patio", room_type: "paving", area_m2: 30 },
      ],
      "porcelain",
    );
    expect(t.items).toEqual([]);
    expect(t.summary.totalAreaM2).toBe(0);
    expect(t.summary.landscapeAreaM2).toBe(90);
  });

  it("still produces a full interior take-off when one interior room exists", () => {
    const t = computeTakeoff(
      [
        { id: "a", name: "Lawn", room_type: "artificial_grass", area_m2: 60 },
        { id: "b", name: "Bed", room_type: "bedroom", area_m2: 16 },
      ],
      "porcelain",
    );
    expect(t.items.length).toBeGreaterThan(0);
    expect(t.summary.totalAreaM2).toBe(16);
    expect(t.summary.landscapeAreaM2).toBe(60);
  });
});

describe("what-if leaves landscape lines alone", () => {
  it("exposes no gradeable landscape line, so a scenario cannot regrade a garden", () => {
    // What-if regrades interior lines by rule_id (P4/quantify/<key>) against a
    // three-grade rate book. The landscape rate book has ONE grade — these are
    // transacted rates, not an economy/standard/premium ladder — so garden
    // lines are deliberately not gradeable. They still count toward the
    // scenario total; they just cannot be swapped.
    const sections = buildGardenSections(VILLA94).sections;
    const lines = sections.flatMap((s) => s.lines);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(String(l.rule_id).startsWith("GL-"), String(l.rule_id)).toBe(true);
      expect(String(l.rule_id).startsWith("P4/quantify/")).toBe(false);
    }
  });

  it("keeps landscape work in its own POMI sections", () => {
    const names = buildGardenSections(VILLA94).sections.map((s) => s.work_section);
    expect(names).toEqual([
      "Demolition",
      "Preliminaries",
      "Hardscape & Structures",
      "Soft Landscaping",
      "Irrigation",
      "Electrical & Lighting",
    ]);
  });
});
