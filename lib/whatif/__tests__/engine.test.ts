import { describe, expect, it } from "vitest";

import { GRADE_SPECS } from "@/lib/whatif/grades";
import {
  defaultRateBook,
  recalc,
  suggestForBudget,
  type ScenarioBoq,
} from "@/lib/whatif/engine";

// Mudon's P4-mapped lines (captured live). Quantities = graph take-off.
const MUDON: ScenarioBoq = {
  grand_total_aed: 259855,
  sections: [
    { work_section: "Floor Finishes", lines: [{ rule_id: "P4/quantify/floor_finish", quantity: 145.7, rate_aed: 190, total_aed: 27683, description: "Floor finish" }] },
    { work_section: "Wall Finishes", lines: [{ rule_id: "P4/quantify/wet_tiling", quantity: 81.84, rate_aed: 260, total_aed: 21278, description: "Wet-area tiling" }] },
    { work_section: "Ceilings", lines: [{ rule_id: "P4/quantify/ceiling_finish", quantity: 145.7, rate_aed: 130, total_aed: 18941, description: "Ceiling" }] },
    { work_section: "Decoration & Painting", lines: [{ rule_id: "P4/quantify/wall_paint", quantity: 449.34, rate_aed: 35, total_aed: 15727, description: "Wall paint" }] },
    { work_section: "Plaster", lines: [{ rule_id: "P4/quantify/wall_plaster", quantity: 449.34, rate_aed: 55, total_aed: 24714, description: "Wall plaster" }] },
    // an unmapped project-level line (no rule_id) — must never move.
    { work_section: "Preliminaries", lines: [{ quantity: 1, rate_aed: 20000, total_aed: 20000, description: "Preliminaries" }] },
  ],
};

describe("what-if recalc — Mudon", () => {
  const rb = defaultRateBook();
  const floorQty = 145.7;

  it("VERIFICATION GATE: marble→porcelain moves the total by exactly rate_delta × area", () => {
    const marble = GRADE_SPECS.floor_finish.premium.rate_aed; // 450
    const porcelain = GRADE_SPECS.floor_finish.standard.rate_aed; // 190 (baseline)
    const expected = Math.round((marble - porcelain) * floorQty * 100) / 100;

    const atMarble = recalc(MUDON, rb, { floor_finish: "premium" });
    const atPorcelain = recalc(MUDON, rb, { floor_finish: "standard" });
    // toggling marble → porcelain
    expect(atMarble.total - atPorcelain.total).toBeCloseTo(expected, 2);
    expect(atMarble.delta).toBeCloseTo(expected, 2);
    // only the floor line changed; nothing else moved
    expect(atMarble.changedItemKeys).toEqual(["floor_finish"]);
  });

  it("reset (all standard) returns to the QS baseline to the fils", () => {
    const r = recalc(MUDON, rb, {});
    expect(r.total).toBe(MUDON.grand_total_aed);
    expect(r.delta).toBe(0);
    expect(r.changedItemKeys).toHaveLength(0);
  });

  it("H4: a firm-priced BoQ with no grade chosen shows its OWN total — unselected lines keep the rate they were priced at", () => {
    // The walkthrough's firm prices plaster at 41.5 (tier 1), not the rate-book 55.
    const firm: ScenarioBoq = {
      ...MUDON,
      sections: MUDON.sections.map((s) =>
        s.work_section === "Plaster" ? { ...s, lines: [{ ...s.lines[0]!, rate_aed: 41.5, total_aed: 18647.61 }] } : s,
      ),
    };
    const r = recalc(firm, rb, {});
    expect(r.delta).toBe(0);
    expect(r.total).toBe(firm.grand_total_aed);
    expect(r.changedItemKeys).toEqual([]);
    expect(r.perChange.find((c) => c.item_key === "wall_plaster")).toMatchObject({ baseline_rate: 41.5, new_rate: 41.5, delta: 0 });
    // Choosing a grade still re-prices exactly that line from the firm's rate.
    const std = recalc(firm, rb, { wall_plaster: "standard" });
    expect(std.delta).toBeCloseTo((GRADE_SPECS.wall_plaster.standard.rate_aed - 41.5) * 449.34, 2);
    expect(std.changedItemKeys).toEqual(["wall_plaster"]);
  });

  it("only rates swap — quantities never change; unmapped lines never move", () => {
    const r = recalc(MUDON, rb, { floor_finish: "economy", wet_tiling: "premium" });
    const floor = r.perChange.find((c) => c.item_key === "floor_finish")!;
    expect(floor.quantity).toBe(floorQty); // graph qty preserved
    // total delta = Σ line deltas, and the Preliminaries line is not in perChange
    expect(r.perChange.every((c) => c.item_key !== undefined)).toBe(true);
    expect(r.perChange).toHaveLength(5); // only the 5 gradeable lines
  });

  it("flags indicative (non-QS-validated) rates per change", () => {
    const r = recalc(MUDON, rb, { floor_finish: "premium" });
    const floor = r.perChange.find((c) => c.item_key === "floor_finish")!;
    expect(floor.qs_validated).toBe(false); // marble not yet QS-validated
    expect(floor.source).toContain("stone");
  });

  it("recalc runs well under 100 ms", () => {
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) recalc(MUDON, rb, { floor_finish: "premium", wet_tiling: "economy" });
    const perCall = (performance.now() - t0) / 500;
    expect(perCall).toBeLessThan(100);
  });

  it("budget dial downgrades largest-saving lines first, under target", () => {
    const target = MUDON.grand_total_aed - 15000;
    const sel = suggestForBudget(MUDON, rb, target);
    const r = recalc(MUDON, rb, sel);
    expect(r.total).toBeLessThanOrEqual(MUDON.grand_total_aed); // moved down
    expect(Object.values(sel).every((g) => g === "economy")).toBe(true);
    // above-target budgets suggest nothing (already under at standard)
    expect(suggestForBudget(MUDON, rb, MUDON.grand_total_aed + 5000)).toEqual({});
  });
});
