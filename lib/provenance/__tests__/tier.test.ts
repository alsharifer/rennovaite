import { describe, expect, it } from "vitest";

import fixture from "@/lib/boq/__fixtures__/arabella-g5d-revisions.json";
import { lineTotal, money2, sumMoney } from "@/lib/boq/money";
import { chainTotals } from "@/lib/boq/totals";
import { formatAED, formatQty } from "@/lib/format/aed";
import type { ProvLine } from "@/lib/provenance/boq";

import { describeFigure, tierLabel, tierLabelWithWhy, tierOf, weakest, type ProvTier } from "../tier";

// =============================================================================
// K1 — tierOf() (spec §1.4, ruled 12 Oct) and the J3 frame figures.
//
// Arabella rev 4 is the fixture's last stage (e042b9eb, stored before H7).
// H7's rounding is applied here exactly as the engine now applies it (rate to
// 2 dp at resolution, total = qty × rate) — only the pergola moves — and the
// result must be the J3 frames to the fil: 6 market (21,074.00), 9 derived
// (81,818.03), 3 to be priced; subtotal 102,892.03; total 116,679.56.
// =============================================================================

interface FixtureBoq {
  sections: { work_section: string; lines: ProvLine[] }[];
  contingency_pct: number;
  vat_pct: number;
}
const REV4 = (fixture as unknown as { boqs: Record<string, FixtureBoq> }).boqs["e042b9eb-6053-41f4-8207-471e85d883f4"]!;

// H7: rates to 2 dp at resolution, totals = lineTotal(qty, rate).
const lines = REV4.sections.flatMap((s) =>
  s.lines.map((l) => {
    const rate = money2(l.rate_aed);
    return { section: s.work_section, line: { ...l, rate_aed: rate, total_aed: lineTotal(l.quantity, rate) } };
  }),
);
// Garden reference rows are all qs_validated = false (seed-rate-book-garden).
const tiers = lines.map(({ section, line }) => ({ rule: line.rule_id, total: line.total_aed, line, t: tierOf(line, section, { qsValidated: {} }) }));

describe("tierOf on every Arabella line = the J3 frames", () => {
  it("each line's quantity / rate / amount marks", () => {
    const table = Object.fromEntries(tiers.map((x) => [x.rule, `${x.t.qty}/${x.t.rate}/${x.t.amount}`]));
    expect(table).toEqual({
      "GL-01": "measured/market/market",
      "GL-02": "measured/market/market",
      "GL-03": "measured/market/market",
      "GL-04": "derived/market/derived",
      "GL-05": "derived/market/derived",
      "GL-06": "derived/derived/derived", // tile supply — site assessment
      "GL-09": "derived/market/derived",
      "GL-11a": "derived/market/derived",
      "GL-14": "derived/market/derived",
      "GL-07": "derived/market/derived",
      "GL-08": "derived/market/derived",
      "GL-25": "unpriced/unpriced/unpriced",
      "GL-15": "derived/derived/derived", // irrigation allowance — site assessment
      "GL-16": "measured/market/market",
      "GL-17": "measured/market/market",
      "GL-18": "measured/market/market",
      "GL-26": "unpriced/unpriced/unpriced",
      "GL-28": "unpriced/unpriced/unpriced",
    });
  });

  it("6 market · 9 derived · 3 to be priced, to the fil", () => {
    const by = (tier: ProvTier) => tiers.filter((x) => x.t.amount === tier);
    expect(by("market").length).toBe(6);
    expect(by("derived").length).toBe(9);
    expect(by("unpriced").length).toBe(3);
    expect(by("measured").length + by("validated").length).toBe(0);
    expect(formatAED(sumMoney(by("market").map((x) => x.total)))).toBe("21,074.00");
    expect(formatAED(sumMoney(by("derived").map((x) => x.total)))).toBe("81,818.03");
  });

  it("subtotal 102,892.03 → contingency 8,231.36 → VAT 5,556.17 → ≈ 116,679.56*", () => {
    const subtotal = sumMoney(tiers.map((x) => x.total));
    expect(formatAED(subtotal)).toBe("102,892.03");
    const chain = chainTotals({ subtotal_aed: subtotal, contingency_pct: REV4.contingency_pct, vat_pct: REV4.vat_pct });
    expect(formatAED(chain.contingency_aed)).toBe("8,231.36");
    expect(formatAED(chain.vat_aed)).toBe("5,556.17");
    expect(formatAED(chain.grand_total_aed)).toBe("116,679.56");
  });

  it("the headline takes the weakest counted mark: derived", () => {
    expect(weakest(tiers.map((x) => x.t.amount))).toBe("derived");
  });

  it("every displayed rate × displayed quantity = displayed amount (spec §1.3)", () => {
    for (const { line } of tiers) {
      if (line.rate_aed === 0) continue;
      const q = Number(formatQty(line.quantity).replace(/,/g, ""));
      const r = Number(formatAED(line.rate_aed).replace(/,/g, ""));
      expect(formatAED(q * r), line.description).toBe(formatAED(line.total_aed));
    }
  });

  it("the pergola is the one line H7 moved", () => {
    const pergola = tiers.find((x) => x.rule === "GL-14")!;
    expect(formatAED(pergola.line.rate_aed)).toBe("1,366.69");
    expect(formatAED(pergola.total)).toBe("16,741.95");
  });
});

// --- the mapping, case by case ---------------------------------------------------

const line = (over: Partial<ProvLine>): ProvLine => ({
  description: "x",
  quantity: 10,
  unit: "m2",
  rate_aed: 50,
  total_aed: 500,
  vendor_or_source: "",
  notes: null,
  ...over,
});

describe("tierOf — the 12 Oct mapping", () => {
  it("a firm's own rate (private or promoted correction) is measured — 'Own basis'", () => {
    expect(tierOf(line({ rate_tier: "firm_private", rate_status: "priced" }), "Painting").rate).toBe("measured");
    expect(tierOf(line({ rate_tier: "firm_correction" }), "Painting").amount).toBe("measured");
    expect(tierLabel("measured", "firm", "rate")).toBe("Own basis");
    expect(tierLabel("measured", "firm", "qty")).toBe("Measured");
  });

  it("validated ONLY from rate_book.qs_validated", () => {
    const l = line({ rate_tier: "reference", item_key: "garden.pcc_base" } as Partial<ProvLine>);
    expect(tierOf(l, "Hardscape & Structures", { qsValidated: { "garden.pcc_base": true } }).rate).toBe("validated");
    expect(tierOf(l, "Hardscape & Structures", { qsValidated: { "garden.pcc_base": false } }).rate).toBe("market");
    expect(tierOf(l, "Hardscape & Structures").rate).toBe("market");
  });

  it("a selected product: priced → market (never validated); unchecked → derived", () => {
    expect(tierOf(line({ rate_tier: "selection", rate_status: "priced" }), "Sanitary").rate).toBe("market");
    expect(tierOf(line({ rate_tier: "selection", rate_status: "needs_qs" }), "Sanitary").rate).toBe("derived");
  });

  it("fallbacks are derived, with the reason", () => {
    for (const [tier, why] of [["catalog", "catalogue price"], ["allowance", "rule allowance"], ["labour_book", "labour rate book"], ["indicative", "indicative rate"]] as const) {
      const t = tierOf(line({ rate_tier: tier }), "Floor Finishes");
      expect(t.rate, tier).toBe("derived");
      expect(t.rateWhy, tier).toBe(why);
    }
    expect(tierOf(line({ rule_id: "P4/quantify/wall_paint", rate_status: "priced" }), "Painting")).toMatchObject({ rate: "derived", rateWhy: "take-off constant" });
  });

  it("site_assessment / indicative / needs_selection cap the rate at derived — even a firm's", () => {
    expect(tierOf(line({ rate_tier: "reference", rate_status: "site_assessment" }), "Irrigation")).toMatchObject({ rate: "derived", rateWhy: "site assessment" });
    expect(tierOf(line({ rate_tier: "firm_private", rate_status: "site_assessment" }), "Irrigation").rate).toBe("derived");
    expect(tierOf(line({ rate_tier: "reference", rate_status: "needs_selection" }), "Hardscape & Structures").rate).toBe("derived");
  });

  it("an untraceable rate is derived, never better than the evidence", () => {
    expect(tierOf(line({}), "Other")).toMatchObject({ rate: "derived", rateWhy: "source not established" });
  });

  it("QS-to-price at rate 0 is unpriced; with a rate it is priced (D4)", () => {
    expect(tierOf(line({ rate_status: "needs_qs", rate_aed: 0, total_aed: 0 }), "Plumbing").amount).toBe("unpriced");
    expect(tierOf(line({ rate_status: "needs_qs", rate_aed: 120, rule_id: "P2/overlay/socket" }), "Electrical Installations").amount).not.toBe("unpriced");
  });

  it("amount = the weaker of quantity and rate (R1)", () => {
    expect(tierOf(line({ rate_tier: "firm_private", qty_derived: true }), "Painting")).toMatchObject({ qty: "derived", rate: "measured", amount: "derived" });
  });
});

describe("weakest / labels / descriptions", () => {
  it("weakest skips unpriced; all-unpriced is unpriced; empty is null", () => {
    expect(weakest(["measured", "unpriced", "market"])).toBe("market");
    expect(weakest(["validated", "measured"])).toBe("validated");
    expect(weakest(["unpriced", "unpriced"])).toBe("unpriced");
    expect(weakest([])).toBeNull();
  });

  it("owner words", () => {
    expect(["measured", "validated", "market", "derived", "unpriced"].map((t) => tierLabel(t as ProvTier, "owner"))).toEqual(["Measured", "Checked", "Market reference", "Estimated", "To be priced"]);
  });

  it("Derived (+ which) for a firm", () => {
    expect(tierLabelWithWhy("derived", "site assessment")).toBe("Derived — site assessment");
    expect(tierLabelWithWhy("derived", "site assessment", "owner")).toBe("Estimated");
  });

  it("the spec's own example (§4.2 #1)", () => {
    expect(describeFigure("7,329.70", "derived", { inputs: { qty: "derived", rate: "market" } })).toBe("7,329.70, derived — quantity derived, rate market reference");
  });
});
