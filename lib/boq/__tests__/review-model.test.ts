import { describe, expect, it } from "vitest";

import fixture from "@/lib/boq/__fixtures__/arabella-g5d-revisions.json";
import { lineTotal, money2 } from "@/lib/boq/money";
import { rechain } from "@/lib/boq/totals";
import { formatAED, formatQty } from "@/lib/format/aed";

import { buildReviewModel, splitAside, type ReviewBoq } from "../review-model";

// =============================================================================
// K3 — the BoQ & Review screen's data on Arabella rev 4 (H7-corrected, as the
// J3 frames print it): 6 market 21,074.00 · 9 derived 81,818.03 · 3 to be
// priced; subtotal 102,892.03 → 8,231.36 → 5,556.17 → ≈ 116,679.56*; the
// excluded lines named with their reasons; sections in canonical order.
// =============================================================================

const REV4 = (fixture as unknown as { boqs: Record<string, ReviewBoq> }).boqs["e042b9eb-6053-41f4-8207-471e85d883f4"]!;

function h7(boq: ReviewBoq): ReviewBoq {
  const sections = boq.sections.map((s) => {
    const lines = s.lines.map((l) => {
      const rate = money2(l.rate_aed);
      return { ...l, rate_aed: rate, total_aed: lineTotal(l.quantity, rate) };
    });
    return { ...s, lines };
  });
  return rechain({ ...boq, sections } as never) as ReviewBoq;
}

const model = buildReviewModel({
  projectId: "p",
  boqId: "b",
  rev: 4,
  revDate: "2026-09-22",
  persona: "firm",
  boq: h7(REV4),
  provenance: null,
  tierCtx: { qsValidated: {} },
  firm: null,
  basis: null,
  duplicates: [],
  budget: 850000,
});

describe("buildReviewModel — Arabella rev 4 = the J3 frames", () => {
  // H7's canonical order: Plumbing is an interior trade, so it precedes the
  // external works (the J3 frame drew it after Irrigation; the order rule wins).
  it("sections in canonical order with their REF codes", () => {
    expect(model.sections.map((s) => `${s.code} ${s.name}`)).toEqual([
      "PRE Preliminaries",
      "DEM Demolition",
      "PLB Plumbing",
      "HRD Hardscape & Structures",
      "SFT Soft Landscaping",
      "IRR Irrigation",
      "EXL Electrical & Lighting",
    ]);
  });

  it("basis of the subtotal by amount mark", () => {
    expect(model.basis.map((b) => `${b.tier} ${b.lines} ${formatAED(b.amount)}`)).toEqual(["market 6 21,074.00", "derived 9 81,818.03", "unpriced 3 0.00"]);
    expect(model.counted).toBe(15);
    expect(model.totalLines).toBe(18);
  });

  it("the chain to the fil", () => {
    expect(formatAED(model.chain.subtotal)).toBe("102,892.03");
    expect(formatAED(model.chain.contingency.amount)).toBe("8,231.36");
    expect(formatAED(model.chain.vat.base)).toBe("111,123.39");
    expect(formatAED(model.chain.vat.amount)).toBe("5,556.17");
    expect(formatAED(model.chain.grand)).toBe("116,679.56");
    expect(model.chain.ohp).toBeNull();
    expect(model.chain.ohpNote).toBe("no firm book on this project");
  });

  it("the headline: ≈, derived, named exclusions, spoken without a star", () => {
    expect(model.headline.estimate).toBe(true);
    expect(model.headline.tier).toBe("derived");
    expect(model.headline.excluded.map((x) => `${x.ref} ${x.description} — ${formatQty(x.quantity)} ${x.unit} · ${x.reason}`)).toEqual([
      "PLB-01 Outdoor water tap (hose bib) with isolation valve — 2 no · no reference rate",
      "PLB-02 Drainage point / gully in paving — 2 no · absorbed at no charge in the reference project; QS to confirm",
      "SFT-03 Planting beds — soil preparation and planting — 23.74 m2 · no reference rate",
    ]);
    expect(model.headline.spoken).toBe("approximately AED 116,679.56, excludes 3 lines to be priced");
    expect(model.headline.spoken).not.toMatch(/star|\*/);
  });

  it("section subtotal marks take the weakest counted line; an all-unpriced section is unpriced", () => {
    const by = Object.fromEntries(model.sections.map((s) => [s.code, `${s.tier} ${s.tbp}`]));
    expect(by).toEqual({ PRE: "market 0", DEM: "market 0", HRD: "derived 0", SFT: "derived 1", IRR: "derived 0", PLB: "unpriced 2", EXL: "market 0" });
  });

  it("every displayed rate × displayed quantity = displayed amount (spec §1.3)", () => {
    for (const s of model.sections) {
      for (const l of s.lines) {
        if (l.unpriced) continue;
        const q = Number(formatQty(l.quantity).replace(/,/g, ""));
        const r = Number(formatAED(l.rate).replace(/,/g, ""));
        expect(formatAED(q * r), l.ref).toBe(formatAED(l.amount));
      }
    }
  });

  it("section subtotals are the sum of their displayed amounts", () => {
    for (const s of model.sections) {
      const sum = s.lines.reduce((n, l) => n + Math.round(l.amount * 100), 0) / 100;
      expect(formatAED(sum), s.name).toBe(formatAED(s.subtotal));
    }
  });

  it("the client budget is never shown on a firm persona (H7)", () => {
    expect(model.budget).toBeNull();
  });
});

describe("splitAside", () => {
  it("drops the provenance aside from a title and words it as a reason", () => {
    expect(splitAside("Outdoor water tap (hose bib) with isolation valve (no reference rate — QS to price)")).toEqual({ title: "Outdoor water tap (hose bib) with isolation valve", aside: "no reference rate" });
    expect(splitAside("Seating bench, L-shape (0.7x0.6 section)")).toEqual({ title: "Seating bench, L-shape (0.7x0.6 section)", aside: null });
  });
});
