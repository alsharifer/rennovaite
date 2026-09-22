import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyOhp } from "@/lib/rates/ohp";
import { recalc, defaultRateBook, scenarioTotal } from "@/lib/whatif/engine";

import { chainTotals, chainWithSubtotal } from "../totals";

// I4 — ONE summary chain. The browser's recomputed figures (what-if, vendor
// swaps) go through chainTotals; it must reproduce every stored BoQ exactly, or
// a displayed number could drift from the one a regenerated BoQ would store.

const golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, "__snapshots__/mudon-boq.golden.json"), "utf8").replace(/^"|"$/g, ""),
) as Record<string, { subtotal_aed: number; contingency_pct: number; contingency_aed: number; vat_pct: number; vat_aed: number; grand_total_aed: number }>;

describe("chainTotals reproduces stored BoQs", () => {
  it("Mudon at every tier (engine + joinery/aluminium)", () => {
    for (const [tier, boq] of Object.entries(golden)) {
      const c = chainWithSubtotal(boq, boq.subtotal_aed);
      expect({ tier, c: c.contingency_aed, v: c.vat_aed, g: c.grand_total_aed }).toEqual({ tier, c: boq.contingency_aed, v: boq.vat_aed, g: boq.grand_total_aed });
    }
  });

  it("garden documents with fractional subtotals — Arabella and Villa 94 as stored on dev (2026-09-20)", () => {
    const stored = [
      { subtotal_aed: 102892.07, contingency_pct: 8, contingency_aed: 8231, vat_pct: 5, vat_aed: 5556, grand_total_aed: 116679.07 },
      { subtotal_aed: 147679.18, contingency_pct: 8, contingency_aed: 11814, vat_pct: 5, vat_aed: 7975, grand_total_aed: 167468.18 },
    ];
    for (const b of stored) {
      const c = chainTotals(b);
      expect([c.contingency_aed, c.vat_aed, c.grand_total_aed]).toEqual([b.contingency_aed, b.vat_aed, b.grand_total_aed]);
    }
  });

  it("applyOhp is the same arithmetic", () => {
    const boq: import("@/lib/rates/ohp").BoqTotalsLike = { ...golden.mid! };
    const viaApply = applyOhp({ ...boq }, 12);
    const viaChain = chainTotals({ subtotal_aed: boq.subtotal_aed, contingency_pct: boq.contingency_pct, vat_pct: boq.vat_pct, ohp_pct: 12 });
    expect([viaApply.ohp_aed, viaApply.contingency_aed, viaApply.vat_aed, viaApply.grand_total_aed]).toEqual([viaChain.ohp_aed, viaChain.contingency_aed, viaChain.vat_aed, viaChain.grand_total_aed]);
  });
});

describe("what-if totals ride the chain", () => {
  const BOQ = {
    grand_total_aed: 0,
    subtotal_aed: 100_000,
    contingency_pct: 8,
    vat_pct: 5,
    ohp_pct: 10,
    sections: [{ work_section: "Floor Finishes", lines: [{ rule_id: "P4/quantify/floor_finish", quantity: 100, rate_aed: 190, total_aed: 19000, description: "Floor" }] }],
  };
  BOQ.grand_total_aed = chainTotals(BOQ).grand_total_aed;

  it("no change → exactly the stored total", () => {
    expect(recalc(BOQ, defaultRateBook(), {}).total).toBe(BOQ.grand_total_aed);
  });

  it("a line change carries OH&P, contingency and VAT — the figure a regenerated BoQ stores", () => {
    const r = recalc(BOQ, defaultRateBook(), { floor_finish: "premium" });
    expect(r.delta).toBe((450 - 190) * 100);
    expect(r.total).toBe(chainTotals({ ...BOQ, subtotal_aed: BOQ.subtotal_aed + r.delta }).grand_total_aed);
    expect(r.total - BOQ.grand_total_aed).toBeGreaterThan(r.delta); // the markups moved too
    expect(scenarioTotal(BOQ, r.delta)).toBe(r.total);
  });
});
