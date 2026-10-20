// Sprint C1 rule: NOTHING under lib/ground-truth/ emits a BoQ line.
//
// Ground truth (the reference projects' actual orders) enters the engine only
// as rates per unit, by type, with private provenance — and as the vocabulary
// and inclusion rules that go with them. Its records with a location, a
// quantity or a total (the aluminium order, the tile cart, the sanitary order,
// the contract lines) never reach a BoQ: until C1 the aluminium order was
// printed line by line — Mudon's rooms and quantities — on every project with
// an interior room (docs/SPRINT_C_ROOT_CAUSE.md §1).
//
// 1. STATIC: every name the pricing path imports from lib/ground-truth/ is on
//    the allowlist below, with the reason it is a rate or vocabulary.
// 2. RUNTIME: an assembled BoQ carries no ground-truth record's text.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { importGraph, rel, resolveImport, ROOT, runtimeImportStatements } from "@/lib/__tests__/helpers/import-graph";
import { ALUMINUM, JOINERY, TILES } from "@/lib/ground-truth/mudon-actuals";

import { generateDeterministicBoq } from "../engine";
import { MUDON_FIRST_FLOOR } from "../fixtures/mudon-first-floor";
import { appendJoineryAluminumSections } from "../joinery-aluminum";
import { LABOUR_RATES_FIXTURE } from "./labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "./pricing-skus.fixture";

/** What the pricing path may take from lib/ground-truth/, and why each is a rate or vocabulary — never a line. */
const ALLOWED: Record<string, string> = {
  "lib/ground-truth/mudon-actuals.ts::JOINERY": "composite rates per m² / item, by item_key (rate lookup only — the order's lines are never read)",
  "lib/ground-truth/villa94-garden.ts::GARDEN_RATES": "the landscape rate vocabulary per item_key: label, unit, scope (the figures come from rate_book)",
  "lib/ground-truth/villa94-garden.ts::getGardenRate": "lookup into GARDEN_RATES",
  "lib/ground-truth/villa94-garden.ts::GARDEN_PROVENANCE": "the provenance tag of the landscape rates",
  "lib/ground-truth/villa94-garden.ts::PUBLIC_SOURCE_LABEL": "the private-source label printed instead of the contractor",
  "lib/ground-truth/villa94-garden.ts::ABSORBED_SCOPE": "inclusion rule by item type",
  "lib/ground-truth/villa94-garden.ts::INCLUSIVE_SCOPE": "inclusion rule by item type",
  "lib/ground-truth/villa94-garden.ts::QUANTITY_INCLUSIONS": "inclusion rule by item type",
  "lib/ground-truth/villa94-garden.ts::PERGOLA_INCLUDED_DOWNLIGHTS": "inclusion rule by item type",
  "lib/ground-truth/villa94-garden.ts::TIMELINE": "the programme's scale anchor (stored as the programme, never a line)",
  "lib/ground-truth/villa94-garden.ts::TOTALS": "the programme's scale anchor (never a line)",
  "lib/ground-truth/villa94-garden.ts::INTERNAL_REF": "the identity the curation withholds (never printed)",
};

function groundTruthImports(entries: string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const f of importGraph(path.join(ROOT, entry))) {
      if (rel(f).startsWith("lib/ground-truth/")) continue;
      for (const s of runtimeImportStatements(readFileSync(f, "utf8"))) {
        const r = resolveImport(f, s.spec);
        if (!r || !rel(r).startsWith("lib/ground-truth/")) continue;
        for (const n of s.names ?? ["*"]) {
          const k = `${rel(r)}::${n}`;
          (out.get(k) ?? out.set(k, new Set()).get(k)!).add(rel(f));
        }
      }
    }
  }
  return out;
}

describe("C1: nothing under lib/ground-truth/ emits a BoQ line", () => {
  const imports = groundTruthImports(["lib/boq/assemble.ts", "app/api/generate-boq/route.ts"]);

  it("walks the real pricing path (not a vacuous graph)", () => {
    expect([...imports.keys()]).toContain("lib/ground-truth/mudon-actuals.ts::JOINERY");
    expect([...imports.keys()]).toContain("lib/ground-truth/villa94-garden.ts::GARDEN_RATES");
  });

  it("the pricing path imports only rates and vocabulary from ground truth", () => {
    const offending = [...imports].filter(([k]) => !(k in ALLOWED)).map(([k, from]) => `${k} ← ${[...from].join(", ")}`);
    expect(offending).toEqual([]);
  });

  // The sanitary order is left out on purpose: its records are PRODUCTS (a GROHE
  // shattaf, matt black), which R-40–R-43 price per unit by type — a product is a
  // specification (I4), not a line of somebody's order.
  it("an assembled BoQ carries no ground-truth record's text (the aluminium order, the tile cart, the joinery order)", () => {
    const { boq } = generateDeterministicBoq({ rooms: MUDON_FIRST_FLOOR, labourRates: LABOUR_RATES_FIXTURE as never, skus: PRICING_SKUS_FIXTURE, styleKey: "contemporary-arabic" });
    const out = appendJoineryAluminumSections(boq, MUDON_FIRST_FLOOR.map((r) => ({ ...r, name_en: r.name })) as never);
    const text = JSON.stringify(out);
    const records = [...ALUMINUM.map((a) => a.item), ...ALUMINUM.map((a) => `${a.location} —`), ...JOINERY.map((j) => j.desc), ...TILES.map((t) => t.desc)];
    expect(records.filter((r) => text.includes(r))).toEqual([]);
    expect(text).not.toMatch(/GT\/aluminum\//);
  });
});
