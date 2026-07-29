import { describe, expect, it } from "vitest";

import { enforceScope, scopeIsValid, type ScopedLine } from "../scope";
import {
  TILES,
  JOINERY,
  JOINERY_GROSS,
  SANITARY,
  netRate,
  TRADE_TOTALS,
} from "@/lib/ground-truth/mudon-actuals";
import { SANITARY_SPEC_CLASSES } from "@/lib/whatif/grades";

describe("scope enforcement (Step 2b)", () => {
  it("flags a supply_and_install line that is shadowed by an install line", () => {
    const lines: ScopedLine[] = [
      { description: "Joinery dresser (composite)", scope: "supply_and_install", install_group: "joinery" },
      { description: "Joinery install labour", scope: "install_only", install_group: "joinery" },
    ];
    const { violations } = enforceScope(lines);
    expect(violations.some((v) => v.kind === "composite_with_install")).toBe(true);
    expect(scopeIsValid(lines)).toBe(false);
  });

  it("passes a supply_only line paired with its install_only counterpart", () => {
    const lines: ScopedLine[] = [
      { description: "Tiles supply", scope: "supply_only", install_group: "flooring" },
      { description: "Flooring Works (labour)", scope: "install_only", install_group: "flooring" },
    ];
    const { violations, lines: out } = enforceScope(lines);
    expect(violations).toHaveLength(0);
    expect(out.find((l) => l.scope === "supply_only")!.install_missing).toBe(false);
  });

  it("flags a supply_only line with no install counterpart as install_missing", () => {
    const lines: ScopedLine[] = [
      { description: "Sanitary supply", scope: "supply_only", install_group: "sanitary" },
    ];
    const { violations, lines: out } = enforceScope(lines);
    expect(violations.some((v) => v.kind === "install_missing")).toBe(true);
    expect(out[0]!.install_missing).toBe(true);
  });

  it("passes a clean supply_and_install line with no shadow install", () => {
    const lines: ScopedLine[] = [
      { description: "Aluminum window (composite allowance)", scope: "supply_and_install", install_group: "aluminum" },
    ];
    expect(scopeIsValid(lines)).toBe(true);
  });
});

describe("ground-truth figures reconcile with the workbook", () => {
  it("tile net rate = 60% of list (Surface XL, Pontino, slab)", () => {
    expect(netRate(181)).toBe(108.6);
    expect(netRate(141)).toBe(84.6);
    expect(netRate(446.45)).toBe(267.87);
  });

  it("joinery line totals sum to the quoted gross", () => {
    const sum = JOINERY.reduce((s, l) => s + Math.round(l.rate * l.qty * 100) / 100, 0);
    expect(Math.round(sum)).toBe(JOINERY_GROSS); // 73,011
  });

  it("sanitary line totals sum to the quoted subtotal (pre-discount)", () => {
    const sum = SANITARY.reduce((s, l) => s + l.qty * l.unit_price, 0);
    expect(sum).toBe(15_165); // subtotal before the AED 240 discount → 14,925 net
    expect(sum - 240).toBe(TRADE_TOTALS.sanitary.excl_vat);
  });

  it("the Surface XL main-flooring SKU maps onto floor_finish standard", () => {
    const surfaceXL = TILES.find((t) => t.sku === "A22GZSFX-OWH")!;
    expect(surfaceXL.maps_to).toEqual({ item_key: "floor_finish", grade: "standard" });
    expect(netRate(surfaceXL.list_rate)).toBe(108.6);
  });
});

describe("sanitary spec-class reclassification (Step 3)", () => {
  it("puts Eurosmart in standard and Eurocube in premium (was inverted in seed)", () => {
    expect(SANITARY_SPEC_CLASSES.basin_mixer.standard!.rate_aed).toBe(400);
    expect(SANITARY_SPEC_CLASSES.basin_mixer.standard!.spec).toMatch(/Eurosmart/);
    expect(SANITARY_SPEC_CLASSES.basin_mixer.premium!.rate_aed).toBe(675);
    expect(SANITARY_SPEC_CLASSES.basin_mixer.premium!.spec).toMatch(/Eurocube/);
  });

  it("models exposed vs concealed shower as distinct spec classes", () => {
    expect(SANITARY_SPEC_CLASSES.shower_system.standard!.spec).toMatch(/exposed/i);
    expect(SANITARY_SPEC_CLASSES.shower_system.premium!.spec).toMatch(/concealed/i);
    expect(SANITARY_SPEC_CLASSES.shower_system.premium!.rate_aed).toBe(1_750);
  });

  it("flags every sanitary assignment as pending partner review", () => {
    for (const cls of Object.values(SANITARY_SPEC_CLASSES)) {
      for (const spec of Object.values(cls)) {
        if (spec) expect(spec.pending_partner_review).toBe(true);
      }
    }
  });
});
