import { describe, expect, it } from "vitest";

import { formatAED, formatDelta, formatQty, formatRatio, headlineSpokenText } from "../aed";

// =============================================================================
// K1 — the R7 number contract (spec §1.3): one helper per kind of figure.
// =============================================================================

const MINUS = "−";

describe("formatAED — exactly 2 dp, en-US grouping", () => {
  it("always prints the fils", () => {
    expect(formatAED(7329.7)).toBe("7,329.70");
    expect(formatAED(4400)).toBe("4,400.00");
    expect(formatAED(0)).toBe("0.00");
    expect(formatAED(116679.56)).toBe("116,679.56");
    expect(formatAED(1234567.891)).toBe("1,234,567.89");
  });

  it("rounds half away from zero, robust to binary representation (H7 money2)", () => {
    expect(formatAED(1.005)).toBe("1.01");
    expect(formatAED(16741.9525)).toBe("16,741.95");
    expect(formatAED(2.675)).toBe("2.68");
  });

  it("negatives use the true minus, never a hyphen; −0 is 0.00", () => {
    expect(formatAED(-16741.99)).toBe(`${MINUS}16,741.99`);
    expect(formatAED(-0.001)).toBe("0.00");
    expect(formatAED(-5)).not.toMatch(/-/);
  });

  it("prefix and empties", () => {
    expect(formatAED(7329.7, { prefix: true })).toBe("AED 7,329.70");
    expect(formatAED(null)).toBe("—");
    expect(formatAED(Number.NaN)).toBe("—");
    expect(formatAED(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatQty — integer if integral, else 2 dp", () => {
  it("prints like the frames", () => {
    expect(formatQty(1)).toBe("1");
    expect(formatQty(69.41)).toBe("69.41");
    expect(formatQty(12.5)).toBe("12.50");
    expect(formatQty(1200)).toBe("1,200");
    expect(formatQty(54.2200000001)).toBe("54.22");
    expect(formatQty(2.999)).toBe("3");
    expect(formatQty(-3)).toBe(`${MINUS}3`);
    expect(formatQty(null)).toBe("—");
  });
});

describe("formatDelta — signed, U+2212", () => {
  it("money", () => {
    expect(formatDelta(1234.5)).toBe("+1,234.50");
    expect(formatDelta(-0.04)).toBe(`${MINUS}0.04`);
    expect(formatDelta(-15247)).toBe(`${MINUS}15,247.00`);
    expect(formatDelta(0)).toBe("—");
    expect(formatDelta(0.004)).toBe("—");
  });

  it("percent, 1 dp", () => {
    expect(formatDelta(4.23, "pct")).toBe("+4.2%");
    expect(formatDelta(-2.9, "pct")).toBe(`${MINUS}2.9%`);
    expect(formatDelta(0.04, "pct")).toBe("—");
  });

  it("never a hyphen-minus", () => {
    for (const n of [-1, -0.5, -1234.56, -99999]) {
      expect(formatDelta(n)).not.toContain("-");
      expect(formatDelta(n, "pct")).not.toContain("-");
    }
  });
});

describe("formatRatio", () => {
  it("×n.n", () => {
    expect(formatRatio(17.86)).toBe("×17.9");
    expect(formatRatio(0.33)).toBe("×0.3");
    expect(formatRatio(3)).toBe("×3.0");
    expect(formatRatio(0)).toBe("—");
    expect(formatRatio(null)).toBe("—");
  });
});

describe("headlineSpokenText — never 'star' (spec §4.2 #12)", () => {
  it("reads the estimate and names the exclusions", () => {
    expect(headlineSpokenText(116679.56, { excludedLines: 3 })).toBe("approximately AED 116,679.56, excludes 3 lines to be priced");
    expect(headlineSpokenText(5000, { excludedLines: 1 })).toBe("approximately AED 5,000.00, excludes 1 line to be priced");
    expect(headlineSpokenText(738529, { estimate: false })).toBe("AED 738,529.00");
  });
});
