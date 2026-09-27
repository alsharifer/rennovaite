import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listVocabulary } from "@/lib/firms/vocabulary";

import { deriveRate } from "../derive";
import { indexVocabulary, suggestItemKey, tokens } from "../match";
import { parseQuoteWorkbook } from "../template";

// =============================================================================
// U3 — suggestions are suggestions; derivation is arithmetic shown, not applied.
// =============================================================================

const vocab = listVocabulary().map((v) => ({ ...v, reference: { kind: "none" as const } }));
const index = indexVocabulary(vocab);

describe("suggestItemKey", () => {
  it("honours a given key that exists, scoring 1, and ignores one that does not", () => {
    expect(suggestItemKey("anything", "garden.pcc_base", index)).toEqual({ item_key: "garden.pcc_base", score: 1, via: "key" });
    expect(suggestItemKey("PCC base under paving", "not.a.key", index)?.via).toBe("description");
  });

  it("matches the fixture's descriptions to the keys a QS would choose", () => {
    const p = parseQuoteWorkbook(new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../__fixtures__/synthetic-quote.xlsx"))));
    const got = Object.fromEntries(p.lines.map((l) => [l.row_no, suggestItemKey(l.description, l.item_key_given, index)?.item_key ?? null]));
    expect(got[2]).toBe("garden.pcc_base");
    expect(got[4]).toBe("garden.grass_supply");
    expect(got[5]).toBe("garden.pergola");
    expect(got[6]).toBe("wall_plaster");
    // The sign board matches nothing the take-off prices.
    expect(got[9]).toBeNull();
  });

  it("never returns a weak match", () => {
    expect(suggestItemKey("miscellaneous", null, index)).toBeNull();
    expect(suggestItemKey("", null, index)).toBeNull();
  });

  it("tokenises without measurement noise", () => {
    expect(tokens("Porcelain floor tile 600x600 supply only")).toEqual(["porcelain", "floor", "tile", "only"]);
  });
});

describe("deriveRate", () => {
  const base = { currency: "AED", vat_treatment: "excl" as const, rates_are: "net" as const, discount_pct: 0 };
  it("net excl VAT passes through", () => {
    expect(deriveRate(100, base)).toMatchObject({ rate_aed: 100, hold_reason: null });
  });
  it("list − discount, then ÷ VAT when included — and says so", () => {
    const d = deriveRate(100, { ...base, rates_are: "list", discount_pct: 12, vat_treatment: "incl" });
    expect(d.rate_aed).toBe(83.81);
    expect(d.explanation).toBe("100.00 − 12% = 88.00 ÷ 1.05 VAT = 83.81");
  });
  it("holds foreign currency, unknown VAT, missing and negative rates", () => {
    expect(deriveRate(95, { ...base, currency: "USD" }).hold_reason).toMatch(/currency USD/);
    expect(deriveRate(95, { ...base, vat_treatment: "unknown" }).hold_reason).toMatch(/VAT treatment unknown/);
    expect(deriveRate(null, base).hold_reason).toBe("rate is not a number");
    expect(deriveRate(-1, base).hold_reason).toBe("rate is negative");
  });
});
