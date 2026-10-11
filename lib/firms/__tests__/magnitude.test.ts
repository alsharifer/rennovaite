import { describe, expect, it } from "vitest";

import { checkMagnitude, conversionOffer, parseDimensions } from "../magnitude";
import { builtinShadowRate } from "../shadow-rate";

// H8 — a firm rate is checked against the figure it would shadow. Outside
// 0.33–3× it is held with "rate is N× the reference — check the unit"; where
// the description's dimensions resolve to the item's unit, a converted rate is
// OFFERED (never applied).

describe("checkMagnitude", () => {
  it("holds the J0 pergola: 24,500 per m² plan against 1,366.69 is 17.9×", () => {
    expect(checkMagnitude(24500, 1366.69)).toEqual({ ratio: 17.93, outlier: true, reason: "rate is 17.9× the reference — check the unit" });
  });
  it("passes a rate in band, and holds both tails", () => {
    expect(checkMagnitude(98.5, 105.6)).toMatchObject({ outlier: false, reason: null });
    expect(checkMagnitude(316, 105.6)!.outlier).toBe(false); // 2.99×
    expect(checkMagnitude(82, 26.4)).toMatchObject({ outlier: true, reason: "rate is 3.1× the reference — check the unit" });
    expect(checkMagnitude(1, 105.6)).toMatchObject({ outlier: true, reason: "rate is 0.01× the reference — check the unit" });
  });
  it("has nothing to say without a single reference figure", () => {
    expect(checkMagnitude(100, null)).toBeNull();
    expect(checkMagnitude(100, 0)).toBeNull();
  });
});

describe("parseDimensions", () => {
  it("reads the forms a quotation uses", () => {
    expect(parseDimensions("Aluminium louvred pergola 3.5 x 3.5 m")).toEqual([3.5, 3.5]);
    expect(parseDimensions("Shade sail 4×6m")).toEqual([4, 6]);
    expect(parseDimensions("Panel 2400 x 1200 mm")).toEqual([2.4, 1.2]);
    expect(parseDimensions("Planter run 6 m")).toEqual([6]);
    expect(parseDimensions("Irrigation controller programming")).toBeNull();
    expect(parseDimensions("Paving 80 m²")).toBeNull();
  });
});

describe("conversionOffer", () => {
  const pergola = { description: "Aluminium louvred pergola 3.5 x 3.5 m", rate_aed: 24500, quantity: 1, unit_given: "no", item_unit: "m2 plan", reference_aed: 1366.69 };
  it("offers 24,500 ÷ 12.25 m² = 2,000.00 per m² plan — and that is in band", () => {
    const o = conversionOffer(pergola)!;
    expect(o).toMatchObject({ rate_aed: 2000, quantity: 12.25, unit: "m2 plan", per_unit: 12.25, ratio: 1.46 });
    expect(o.note).toBe("24,500.00 per no ÷ 12.25 (3.5 × 3.5 m = 12.25 m²) = 2,000.00 / m2 plan");
  });
  it("offers nothing it cannot derive — a line already per area, or no dimensions", () => {
    expect(conversionOffer({ ...pergola, unit_given: "m2" })).toBeNull();
    expect(conversionOffer({ ...pergola, description: "Aluminium louvred pergola" })).toBeNull();
    expect(conversionOffer({ ...pergola, item_unit: "lm" })).toBeNull();
  });
  it("converts a length for an item priced per linear metre", () => {
    expect(conversionOffer({ description: "Planter run 6 m", rate_aed: 3000, quantity: 1, unit_given: "no", item_unit: "lm" })).toMatchObject({ rate_aed: 500, quantity: 6, unit: "lm" });
  });
});

describe("the figure an interior entry shadows", () => {
  it("is the P4 element constant, or the allowance — and nothing for a catalogue key", () => {
    expect(builtinShadowRate("wall_plaster")).toEqual({ rate_aed: 55, unit: "m2", source: "element_def" });
    expect(builtinShadowRate("floor.porcelain_material")).toBeNull();
    expect(builtinShadowRate("garden.pcc_base")).toBeNull(); // garden keys read the market book
  });
});
