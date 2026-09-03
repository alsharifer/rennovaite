import { describe, expect, it } from "vitest";

import {
  buildCatalog,
  buildHvacCatalog,
  buildElectricalCatalog,
  buildLightingCatalog,
  buildSanitaryCatalog,
  NO_CATALOGUE_REASON,
  type SkuRow,
} from "@/lib/accessories/seed-data";
import {
  ACCESSORY_CATEGORIES,
  CATEGORY_ITEM_KEYS,
  categoryForItemKey,
  checkSelectionScope,
  comparableRows,
  formatAttribute,
  ITEM_KEY_LABEL,
  effectiveRate,
  selectionDeltas,
  type AccessoryItem,
} from "@/lib/accessories/types";
import { applyAccessory } from "@/lib/boq/rates";
import { RATE_RULES } from "@/lib/boq/rules";
import { SANITARY } from "@/lib/ground-truth/mudon-actuals";

const AC_SKUS: SkuRow[] = [
  {
    sku: "SKM-SPLIT-1T",
    brand: "SKM",
    category: "HVAC",
    subcategory: "Split AC",
    description_en:
      "SKM Decorative Split AC 1 Ton 12,000 BTU R410A, made in UAE, 5-year compressor warranty",
    price_aed: 1599,
    vendor: "SKM",
    lead_time_days: 10,
    last_verified: "2026-04-28",
  },
  {
    sku: "SKM-INV-2T",
    brand: "SKM",
    category: "HVAC",
    subcategory: "Inverter Split AC",
    description_en:
      "SKM Decorative Inverter Split AC 2 Ton 24,000 BTU, made in UAE, 5-year compressor warranty",
    price_aed: 3199,
    vendor: "SKM",
    lead_time_days: 10,
    last_verified: "2026-04-28",
  },
  {
    sku: "SKM-SPLIT-3T",
    brand: "SKM",
    category: "HVAC",
    subcategory: "Split AC",
    description_en: "SKM Decorative Split AC 3 Ton 36,000 BTU R410A, made in UAE",
    price_aed: 3795,
    vendor: "SKM",
    lead_time_days: 10,
    last_verified: "2026-04-28",
  },
];

const LIGHT_SKUS: SkuRow[] = [
  {
    sku: "IKEA-MELODI",
    brand: "IKEA",
    category: "Lighting",
    subcategory: "Pendant",
    description_en: "MELODI Pendant lamp white 28cm",
    price_aed: 49,
    vendor: "IKEA",
    lead_time_days: 3,
    last_verified: "2026-04-28",
  },
  {
    sku: "IKEA-VINDKAST",
    brand: "IKEA",
    category: "Lighting",
    subcategory: "Pendant",
    description_en: "VINDKAST Pendant lamp brass 38cm",
    price_aed: 295,
    vendor: "IKEA",
    lead_time_days: 3,
    last_verified: "2026-04-28",
  },
];

const ELEC_SKUS: SkuRow[] = [
  {
    sku: "SCH-ASFORA-SOCK",
    brand: "Schneider Electric",
    category: "Electrical",
    subcategory: "Switches/Sockets/MCB",
    description_en: "Schneider Asfora Universal Socket 13A White",
    price_aed: 29,
    vendor: "Schneider Electric",
    lead_time_days: 5,
    last_verified: "2026-04-28",
  },
  {
    sku: "SCH-UNICA-DBL",
    brand: "Schneider Electric",
    category: "Electrical",
    subcategory: "Switches/Sockets/MCB",
    description_en: "Schneider Unica Double Socket 13A White",
    price_aed: 75,
    vendor: "Schneider Electric",
    lead_time_days: 5,
    last_verified: "2026-04-28",
  },
];

const ALL_SKUS = [...AC_SKUS, ...LIGHT_SKUS, ...ELEC_SKUS];

function item(over: Partial<AccessoryItem> = {}): AccessoryItem {
  return {
    id: "c1",
    category: "sanitary",
    item_key: "san.basin",
    spec_class: "standard",
    name: "Basin mixer",
    brand: "GROHE",
    model_code: "332652433",
    rate_aed: 400,
    unit: "no",
    scope: "supply_and_install",
    provenance: "actual_transaction",
    source: "Laspinas 46703",
    rate_book_item_key: "san.basin",
    qs_validated: false,
    attributes: {},
    is_rule_default: true,
    sort_order: 0,
    ...over,
  };
}

describe("category ↔ item_key map", () => {
  it("only names item keys the engine actually prices", () => {
    for (const c of ACCESSORY_CATEGORIES) {
      for (const key of CATEGORY_ITEM_KEYS[c]) {
        expect(RATE_RULES[key], `${key} has no R-xx rule`).toBeDefined();
      }
    }
  });

  it("maps every key back to exactly one category", () => {
    const seen = new Set<string>();
    for (const c of ACCESSORY_CATEGORIES) {
      for (const key of CATEGORY_ITEM_KEYS[c]) {
        expect(seen.has(key), `${key} appears twice`).toBe(false);
        seen.add(key);
        expect(categoryForItemKey(key)).toBe(c);
      }
    }
    expect(categoryForItemKey("floor.skirting")).toBeNull();
  });

  it("labels every key it offers", () => {
    for (const c of ACCESSORY_CATEGORIES) {
      for (const key of CATEGORY_ITEM_KEYS[c]) {
        expect(ITEM_KEY_LABEL[key], `${key} unlabelled`).toBeTruthy();
      }
    }
  });
});

describe("sanitary catalogue — real Mudon quotation data", () => {
  const rows = buildSanitaryCatalog();

  it("prices every row from an actual transaction, never a seed guess", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.provenance).toBe("actual_transaction");
      expect(r.source).toBeTruthy();
      expect(r.rate_aed).toBeGreaterThan(0);
    }
  });

  it("carries the P8 spec-class correction: Eurosmart standard, Eurocube premium", () => {
    const basins = rows.filter((r) => r.item_key === "san.basin");
    const std = basins.find((b) => b.spec_class === "standard");
    const prem = basins.find((b) => b.spec_class === "premium");
    expect(std?.name).toMatch(/Eurosmart/i);
    expect(std?.rate_aed).toBe(400);
    expect(prem?.name).toMatch(/Eurocube/i);
    expect(prem?.rate_aed).toBe(675);
    // The actual project spec is the default, not the pricier seed value.
    expect(std?.is_rule_default).toBe(true);
  });

  it("models exposed vs concealed shower as distinct classes, not one price band", () => {
    const showers = rows.filter((r) => r.item_key === "san.shower");
    const exposed = showers.find((s) => s.attributes.mounting === "Exposed");
    const concealed = showers.find((s) => s.attributes.mounting === "Concealed");
    expect(exposed?.rate_aed).toBe(500);
    expect(concealed?.rate_aed).toBe(1750);
    expect(exposed?.spec_class).not.toBe(concealed?.spec_class);
  });

  it("keeps the accessory-set rates identical to the quotation lines", () => {
    const byCode = new Map(SANITARY.map((s) => [s.code, s]));
    for (const r of rows) {
      if (!r.model_code) continue;
      const q = byCode.get(r.model_code);
      if (q) expect(r.rate_aed).toBe(q.unit_price);
    }
  });

  it("leaves every sanitary rate awaiting QS review (P8 pending partner review)", () => {
    for (const r of rows) expect(r.qs_validated).toBe(false);
  });
});

describe("vendor-catalogue rows — attributes parsed, never inferred", () => {
  it("extracts capacity, refrigerant, origin and warranty only when stated", () => {
    const rows = buildHvacCatalog(AC_SKUS);
    const oneTon = rows.find((r) => r.model_code === "SKM-SPLIT-1T")!;
    expect(oneTon.attributes.capacity).toBe("1 Ton / 12,000 BTU");
    expect(oneTon.attributes.refrigerant).toBe("R410A");
    expect(oneTon.attributes.origin).toBe("UAE");
    expect(oneTon.attributes.warranty).toBe("5-year compressor");
    expect(oneTon.attributes.efficiency).toBe("Non-inverter");

    const inverter = rows.find((r) => r.model_code === "SKM-INV-2T")!;
    expect(inverter.attributes.efficiency).toBe("Inverter");
    // That SKU's description has no refrigerant, so the attribute is ABSENT.
    expect(inverter.attributes.refrigerant).toBeUndefined();

    // Nor is a warranty invented where the description omits it.
    const threeTon = rows.find((r) => r.model_code === "SKM-SPLIT-3T")!;
    expect(threeTon.attributes.warranty).toBeUndefined();
  });

  it("says the AC rates are vendor catalogue, not a Mudon quotation", () => {
    for (const r of buildHvacCatalog(AC_SKUS)) {
      expect(r.provenance).toBe("seed");
      expect(r.source).toMatch(/vendor catalogue/i);
      expect(r.source).not.toMatch(/Laspinas|Mudon/i);
    }
  });

  it("reads size and material from lighting descriptions", () => {
    const rows = buildLightingCatalog(LIGHT_SKUS);
    const brass = rows.find((r) => r.model_code === "IKEA-VINDKAST")!;
    expect(brass.attributes.dimensions).toBe("38 cm");
    expect(brass.attributes.finish).toBe("Brass");
    expect(rows.every((r) => r.attributes.capacity === undefined)).toBe(true);
  });

  it("reads amperage and series from electrical descriptions", () => {
    const rows = buildElectricalCatalog(ELEC_SKUS);
    const dbl = rows.find((r) => r.model_code === "SCH-UNICA-DBL")!;
    expect(dbl.attributes.efficiency).toBe("13A");
    expect(dbl.attributes.material).toBe("Unica series");
    expect(dbl.attributes.finish).toBe("White");
    // No capacity or warranty is claimed for a socket.
    expect(dbl.attributes.capacity).toBeUndefined();
    expect(dbl.attributes.warranty).toBeUndefined();
  });

  it("returns nothing rather than a placeholder when the pool is empty", () => {
    expect(buildHvacCatalog([])).toEqual([]);
    expect(buildLightingCatalog([])).toEqual([]);
  });

  it("documents every item_key it deliberately ships empty", () => {
    const rows = buildCatalog(ALL_SKUS);
    const covered = new Set(rows.map((r) => r.item_key));
    const all = Object.values(CATEGORY_ITEM_KEYS).flat();
    for (const key of all) {
      if (covered.has(key)) continue;
      expect(NO_CATALOGUE_REASON[key], `${key} is empty with no stated reason`).toBeTruthy();
    }
  });

  it("has no water-heater alternatives, and says why", () => {
    const rows = buildCatalog(ALL_SKUS);
    expect(rows.some((r) => r.item_key === "plumb.water_heater")).toBe(false);
    expect(NO_CATALOGUE_REASON["plumb.water_heater"]).toMatch(/no water-heater SKU/i);
  });
});

describe("scope invariants (S-pack)", () => {
  it("passes a supply_and_install selection", () => {
    expect(checkSelectionScope([item({ scope: "supply_and_install" })])).toEqual([]);
  });

  it("rejects install_only — it would double-count the labour section", () => {
    const issues = checkSelectionScope([item({ scope: "install_only" })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("install_only_forbidden");
  });

  it("flags supply_only — its installation would go unpriced", () => {
    const issues = checkSelectionScope([item({ scope: "supply_only" })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("supply_only_uninstalled");
  });

  it("ships a catalogue that is clean by construction", () => {
    const rows = buildCatalog(ALL_SKUS);
    const asItems = rows.map((r, i) => item({ id: `x${i}`, scope: r.scope, item_key: r.item_key, name: r.name }));
    expect(checkSelectionScope(asItems)).toEqual([]);
  });
});

describe("attribute display", () => {
  it("renders a missing attribute as an em dash, never blank or zero", () => {
    expect(formatAttribute({}, "capacity")).toBe("—");
    expect(formatAttribute({ capacity: "" }, "capacity")).toBe("—");
    expect(formatAttribute({ capacity: "2 Ton" }, "capacity")).toBe("2 Ton");
    expect(formatAttribute({ lead_time_days: 10 }, "lead_time_days")).toBe("10 days");
  });

  it("drops comparison rows no item has a value for", () => {
    const rows = comparableRows([
      item({ attributes: { capacity: "1 Ton" } }),
      item({ id: "c2", attributes: { warranty: "5-year" } }),
    ]);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("capacity");
    expect(keys).toContain("warranty");
    expect(keys).not.toContain("refrigerant");
  });

  it("leads with attributes, not price", () => {
    const rows = comparableRows([item({ attributes: { capacity: "1 Ton" } })]);
    expect(rows[0]!.key).toBe("capacity");
  });
});

describe("selectionDeltas — the predicted BoQ movement", () => {
  const quantities = { "san.shower": 3, "light.pendant": 5 };
  // What the rule assumes, and what KIND of rate that is — the kind is what
  // decides whether a supply price replaces, adds to, or shifts the default.
  const defaults = {
    "san.shower": { rate_aed: 9000, kind: "supply_and_install" },
    "light.pendant": { rate_aed: 500, kind: "labour" },
  };

  it("moves a supply-and-install line by the SPEC delta, preserving install", () => {
    // Exposed (500) is what the rule assumed; concealed (1750) is chosen.
    // Rate 9000 + (1750 − 500) = 10,250 → 3 × 1,250 = +3,750.
    const { lines, total_delta_aed } = selectionDeltas(quantities, defaults, [
      { item_key: "san.shower", rate_aed: 1750, default_supply_aed: 500 },
    ]);
    expect(lines[0]!.selected_rate_aed).toBe(10_250);
    expect(total_delta_aed).toBe(3750);
  });

  it("ADDS the fixture price to an installation-labour-only default", () => {
    // The pendant rule is "installation labour only", so supply is additive:
    // 500 + 49 = 549 → 5 × 49 = +245.
    const { lines, total_delta_aed } = selectionDeltas(quantities, defaults, [
      { item_key: "light.pendant", rate_aed: 49, default_supply_aed: null },
    ]);
    expect(lines[0]!.selected_rate_aed).toBe(549);
    expect(total_delta_aed).toBe(245);
  });

  it("never makes a premium specification cheaper than the default", () => {
    // The bug this whole rule exists to prevent: substituting a bare supply
    // price for a supply-and-install rate deleted the installation cost and
    // made premium sanitary REDUCE the BoQ.
    for (const supply of [400, 500, 525]) {
      for (const premium of [675, 850, 1750]) {
        if (premium <= supply) continue;
        const { total_delta_aed } = selectionDeltas(
          { "san.shower": 3 },
          { "san.shower": { rate_aed: 9000, kind: "supply_and_install" } },
          [{ item_key: "san.shower", rate_aed: premium, default_supply_aed: supply }],
        );
        expect(total_delta_aed).toBeGreaterThan(0);
      }
    }
  });

  it("refuses to re-price when the default's supply split is unknown", () => {
    // Better a line that did not move than one that silently lost its install.
    const { lines, total_delta_aed } = selectionDeltas(quantities, defaults, [
      { item_key: "san.shower", rate_aed: 1750, default_supply_aed: null },
    ]);
    expect(lines[0]!.selected_rate_aed).toBe(9000);
    expect(total_delta_aed).toBe(0);
  });

  it("swaps like for like when the default is itself a supply price", () => {
    const { lines } = selectionDeltas(
      { "san.shattaf": 3 },
      { "san.shattaf": { rate_aed: 250, kind: "allowance" } },
      [{ item_key: "san.shattaf", rate_aed: 310, default_supply_aed: 250 }],
    );
    expect(lines[0]!.selected_rate_aed).toBe(310);
    expect(lines[0]!.delta_aed).toBe(180);
  });

  it("never alters a quantity — only the rate", () => {
    const { lines } = selectionDeltas(quantities, defaults, [
      { item_key: "san.shower", rate_aed: 9999, default_supply_aed: 500 },
    ]);
    expect(lines[0]!.quantity).toBe(3);
  });

  it("ignores a selection with no take-off quantity", () => {
    const { lines, total_delta_aed } = selectionDeltas(quantities, defaults, [
      { item_key: "hvac.office_split", rate_aed: 5000, default_supply_aed: null },
    ]);
    expect(lines).toEqual([]);
    expect(total_delta_aed).toBe(0);
  });

  it("is zero when the choice matches what the rule already assumed", () => {
    const { total_delta_aed } = selectionDeltas(quantities, defaults, [
      { item_key: "san.shower", rate_aed: 500, default_supply_aed: 500 },
    ]);
    expect(total_delta_aed).toBe(0);
  });
});

describe("client and engine agree on the re-priced rate", () => {
  it("effectiveRate matches applyAccessory for every default kind", () => {
    const kinds = ["supply_and_install", "labour", "lump", "allowance", "material"] as const;
    for (const kind of kinds) {
      for (const defaultSupply of [null, 500]) {
        const base = {
          rate_aed: 9000,
          vendor_or_source: "rule",
          kind,
          rate_band: "mid" as const,
          wastage: 0,
          notes: null,
        };
        const chosen = {
          catalog_item_id: "c1",
          name: "Concealed shower",
          rate_aed: 1750,
          scope: "supply_and_install" as const,
          source: null,
          spec_class: "premium",
          qs_validated: false,
          default_supply_aed: defaultSupply,
        };
        expect(
          effectiveRate(base.rate_aed, kind, chosen.rate_aed, defaultSupply),
          `${kind} / defaultSupply=${defaultSupply}`,
        ).toBe(applyAccessory(base, chosen).rate_aed);
      }
    }
  });
});
