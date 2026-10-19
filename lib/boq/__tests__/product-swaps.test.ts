import { describe, expect, it } from "vitest";

import { GRADEABLE_ITEMS } from "@/lib/whatif/grades";
import { groupLineKeys, isProductValue, lineProductKey, optionBasis, PRODUCT_GROUPS, productChangeSummary, productGroupOf } from "@/lib/boq/product-swaps";
import { summarizeChanges } from "@/lib/boq/changes-since";

describe("B7 5 — the what-if grades cannot express the pilot's savings", () => {
  it("what-if grades surfaces only; none of the product lines is gradeable", () => {
    const productKeys = PRODUCT_GROUPS.flatMap((g) => g.options.flatMap((o) => o.lines));
    expect(productKeys.some((k) => (GRADEABLE_ITEMS as readonly string[]).includes(k))).toBe(false);
  });
});

describe("B7 5 — a BoQ line's product group", () => {
  it("finds the group by item key, or by rule where the line has none (the enclosure, the made-to-measure vanity)", () => {
    expect(productGroupOf({ rule_id: "S6-06/R-47" })).toMatchObject({ group: { field: "shower_screen" }, current: { value: "enclosure" } });
    expect(productGroupOf({ rule_id: "W-26/R-67", item_key: "alum.shower_panel_fixed" })).toMatchObject({ current: { value: "fixed_panel" } });
    expect(productGroupOf({ rule_id: "GT/joinery/vanity" })).toMatchObject({ group: { field: "vanity" }, current: { value: "floating_stone" } });
    expect(productGroupOf({ rule_id: "W-13/R-74", item_key: "wall.shower_niche_plain" })).toMatchObject({ group: { field: "niche_led" }, current: { value: false } });
    expect(productGroupOf({ rule_id: "Q-35/R-37", item_key: "prelim.floor_protection" })).toBeNull();
    expect(lineProductKey({ rule_id: "S6-05/R-46" })).toBe("S6-05");
  });
  it("prices an alternative from its rule's allowance; a market-rate one is priced on regenerate", () => {
    const glass = PRODUCT_GROUPS.find((g) => g.field === "shower_screen")!;
    expect(glass.options.find((o) => o.value === "fixed_panel")!.rate_aed).toBe(2139);
    expect(optionBasis(glass.options.find((o) => o.value === "fixed_panel")!)).toBe("catalogue"); // B9
    expect(optionBasis(PRODUCT_GROUPS.find((g) => g.field === "niche_led")!.options.find((o) => o.value === false)!)).toBe("allowance");
    expect(PRODUCT_GROUPS.find((g) => g.field === "shower_valve")!.options.find((o) => o.value === "thermostatic")!.rate_aed).toBeNull();
  });
  it("only a group's own values are accepted", () => {
    expect(isProductValue("waste", "bagged")).toBe(true);
    expect(isProductValue("waste", "fixed_panel")).toBe(false);
    expect(isProductValue("nope", "x")).toBe(false);
  });
});

describe("B7 5 — the revision cause", () => {
  it("'Product changed by <name>', naming the group and both products", () => {
    expect(productChangeSummary("abdallah", "Shower glass", "Frameless enclosure — panels with a hinged door", "One fixed walk-in panel")).toBe("Product changed by abdallah — Shower glass: frameless enclosure — panels with a hinged door → one fixed walk-in panel");
    expect(groupLineKeys(PRODUCT_GROUPS.find((g) => g.field === "vanity")!)).toEqual(["GT/joinery/vanity", "S6-05", "joinery.vanity_ready"]);
  });
  it("Regenerate says a product changed", () => {
    expect(summarizeChanges([{ kind: "product_change" }], 10).summary).toBe("1 product changed since rev 10");
  });
});
