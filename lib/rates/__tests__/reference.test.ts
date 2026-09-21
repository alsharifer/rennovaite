import { describe, expect, it } from "vitest";

import { buildGardenSections } from "@/lib/boq/garden-boq-feed";
import {
  gardenBookFromRows,
  transcriptionGardenBook,
  transcriptionGardenRows,
} from "@/lib/boq/garden-rates";
import { VILLA94_GARDEN } from "@/lib/ground-truth/villa94-garden-plan";
import { REFERENCE_COLUMNS, indexReference, lookupCalibrated, type ReferenceRateRow } from "../reference";

// T1.0 — the garden take-off prices from rate_book rows, not module constants.

const row = (over: Partial<ReferenceRateRow>): ReferenceRateRow => ({
  item_key: "garden.pcc_base",
  grade: "standard",
  unit: "m2",
  rate_aed: 105.6,
  scope: "install_only",
  provenance: "actual_transaction",
  valid_from: "2026-09-12",
  work_section: "Landscape & External Works",
  ...over,
});

describe("reference rate book (T1.0)", () => {
  it("never selects source or internal_ref — the identity columns cannot reach a price", () => {
    const cols = REFERENCE_COLUMNS.split(",").map((c) => c.trim());
    expect(cols).not.toContain("source");
    expect(cols).not.toContain("internal_ref");
    expect(cols).toEqual(expect.arrayContaining(["item_key", "grade", "unit", "rate_aed", "provenance", "valid_from"]));
  });

  it("the price comes from the ROWS: change a row and the line moves", () => {
    const rows = transcriptionGardenRows().map((r) => (r.item_key === "garden.pcc_base" ? { ...r, rate_aed: 200 } : r));
    const moved = buildGardenSections(VILLA94_GARDEN, gardenBookFromRows(rows));
    const base = buildGardenSections(VILLA94_GARDEN, transcriptionGardenBook());
    const pcc = (b: typeof base) =>
      b.sections.flatMap((s) => s.lines).find((l) => String(l.rule_id).startsWith("GL-04") || String(l.description).startsWith("PCC"))!;
    expect(pcc(moved).rate_aed).toBe(200);
    expect(pcc(base).rate_aed).toBe(105.6);
    expect(moved.total_aed).toBeGreaterThan(base.total_aed);
  });

  it("a key the book does not carry throws — never a constant fallback", () => {
    const rows = transcriptionGardenRows().filter((r) => r.item_key !== "garden.pcc_base");
    expect(() => buildGardenSections(VILLA94_GARDEN, gardenBookFromRows(rows))).toThrow(/garden\.pcc_base/);
  });

  it("a row re-seeded in the wrong unit refuses to price", () => {
    const rows = transcriptionGardenRows().map((r) => (r.item_key === "garden.pcc_base" ? { ...r, unit: "lm" } : r));
    expect(() => gardenBookFromRows(rows)).toThrow(/unit drift/);
  });

  it("newest valid_from supersedes; calibrated beats indicative regardless of order", () => {
    const idx = indexReference([
      row({ rate_aed: 90, valid_from: "2026-01-01" }),
      row({ rate_aed: 120, valid_from: "2026-10-01", provenance: "seed" }),
      row({ rate_aed: 110, valid_from: "2026-09-30" }),
    ]);
    expect(lookupCalibrated(idx, "garden.pcc_base", "standard")!.rate_aed).toBe(110);
    const book = gardenBookFromRows([row({ rate_aed: 120, provenance: "seed", valid_from: "2027-01-01" }), row({ rate_aed: 110 })]);
    expect(book.resolve("garden.pcc_base")).toEqual({ rate_aed: 110, tier: "reference" });
  });

  it("an indicative row answers only when no calibrated rate exists", () => {
    const book = gardenBookFromRows([row({ provenance: "indicative", rate_aed: 99 })]);
    expect(book.resolve("garden.pcc_base")).toEqual({ rate_aed: 99, tier: "indicative" });
    expect(book.resolve("garden.nothing")).toBeNull();
  });

  it("the transcription rows ARE the seed: one row per GARDEN_RATES entry, all calibrated", () => {
    const rows = transcriptionGardenRows();
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.provenance))).toEqual(new Set(["actual_transaction"]));
  });
});
