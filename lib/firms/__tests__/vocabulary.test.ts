import { describe, expect, it } from "vitest";

import { GARDEN_RATES } from "@/lib/ground-truth/villa94-garden";
import { UNPRICED_GARDEN_ITEMS } from "@/lib/boq/garden-takeoff";
import { WORK_ITEM_DEF } from "@/lib/boq/elements";
import { RATE_RULES } from "@/lib/boq/rules";

import { itemVocabulary, listVocabulary, validateEntry } from "../vocabulary";
import { groupBySection, validateDraftAgainst, type VocabularyItem } from "../vocabulary-client";

// =============================================================================
// U2 — the vocabulary as data, and the page's validator held to the server's.
// =============================================================================

const asItem = (key: string): VocabularyItem | null => {
  const v = itemVocabulary(key);
  return v ? { ...v, reference: v.path === "garden" ? { kind: "none" } : { kind: "builtin", how: v.builtin ?? "catalog" } } : null;
};

describe("listVocabulary", () => {
  const all = listVocabulary();

  it("enumerates every key the four sources define, once each, and nothing else", () => {
    const expected = new Set([
      ...GARDEN_RATES.map((g) => g.item_key),
      ...Object.keys(UNPRICED_GARDEN_ITEMS),
      ...Object.keys(WORK_ITEM_DEF),
      ...Object.keys(RATE_RULES),
    ]);
    expect(new Set(all.map((v) => v.item_key))).toEqual(expected);
    expect(all.length).toBe(expected.size);
    expect(all.length).toBeGreaterThan(40);
  });

  it("every item resolves through itemVocabulary identically and carries a section", () => {
    for (const v of all) {
      expect(itemVocabulary(v.item_key)).toEqual(v);
      expect(v.section.length).toBeGreaterThan(0);
      expect(v.kinds.length).toBeGreaterThan(0);
      expect(v.kinds).toContain(v.default_kind);
    }
  });

  it("garden keys carry their POMI section; interior keys say what built-in pricing they shadow", () => {
    expect(itemVocabulary("garden.pcc_base")).toMatchObject({ path: "garden", section: "Hardscape & Structures", unit: "m2" });
    expect(itemVocabulary("wall_plaster")).toMatchObject({ path: "interior", section: "Plaster", builtin: "element_def" });
    expect(itemVocabulary("demo.soft_strip")).toMatchObject({ path: "interior", section: "Demolition", builtin: "labour_book" });
    for (const v of all) if (v.path === "interior") expect(v.builtin, v.item_key).toBeDefined();
  });

  it("groupBySection keeps every item and sorts within a section", () => {
    const items = all.map((v) => asItem(v.item_key)!);
    const groups = groupBySection(items);
    expect(groups.flatMap((g) => g.items).length).toBe(items.length);
    for (const g of groups) {
      const labels = g.items.map((i) => i.label);
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    }
  });
});

describe("the page's validator says exactly what the API would", () => {
  const drafts = [
    { item_key: "garden.pcc_base", unit: "m2", kind: "labour" as const, rate_aed: 95 },
    { item_key: "garden.pcc_base", unit: "lm", kind: "labour" as const, rate_aed: 95 },
    { item_key: "garden.pcc_base", unit: "m2", kind: "supply_and_install" as const, rate_aed: 95 },
    { item_key: "garden.pcc_base", unit: "furlong", kind: "supply" as const, rate_aed: -1 },
    { item_key: "floor.porcelain_material", unit: "m2", kind: "supply_and_install" as const, rate_aed: 1 },
    { item_key: "floor.porcelain_material", unit: "m2", kind: "supply" as const, rate_aed: 1 },
    { item_key: "garden.deck", unit: "m2", kind: "supply_and_install" as const, rate_aed: 650 },
    { item_key: "wall_plaster", unit: "m2", kind: "labour" as const, rate_aed: Number.NaN },
    { item_key: "not.a.key", unit: "m2", kind: "labour" as const, rate_aed: 1 },
  ];

  it.each(drafts)("%o", (d) => {
    expect(validateDraftAgainst(asItem(d.item_key), d)).toEqual(validateEntry(d));
  });

  it("is exhaustive over the vocabulary for the common wrong-unit and wrong-kind mistakes", () => {
    for (const v of listVocabulary()) {
      const item = asItem(v.item_key);
      const wrongUnit = { item_key: v.item_key, unit: v.unit === "lm" ? "m2" : "lm", kind: v.default_kind, rate_aed: 1 };
      const wrongKind = { item_key: v.item_key, unit: v.unit ?? "m2", kind: (v.kinds.includes("lump") ? "supply" : "lump") as "supply" | "lump", rate_aed: 1 };
      expect(validateDraftAgainst(item, wrongUnit)).toEqual(validateEntry(wrongUnit));
      expect(validateDraftAgainst(item, wrongKind)).toEqual(validateEntry(wrongKind));
    }
  });
});
