import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boqPricingFingerprint, needsReferenceBanner, proposalGateVerdict, referenceBasisOf } from "../reference-basis";

// L4 — where a BoQ's rates came from, as a gate.

const ROOT = path.resolve(__dirname, "../../..");
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/boq/__fixtures__/arabella-g5d-revisions.json"), "utf8")) as { stages: { boq_id: string }[]; boqs: Record<string, Parameters<typeof referenceBasisOf>[0]> };
const arabella = fx.boqs[fx.stages[7]!.boq_id]!;

const line = (rate_tier: string | undefined, rate_aed = 10, extra: Record<string, unknown> = {}) => ({ description: "x", quantity: 1, unit: "m2", rate_aed, total_aed: rate_aed, vendor_or_source: "", notes: null, rate_tier, ...extra });

describe("referenceBasisOf", () => {
  it("a pre-L1 garden BoQ (no rate_tier) is inferred: reference for priced lines, unpriced for the QS-to-price ones", () => {
    const b = referenceBasisOf(arabella);
    expect(b.basis).toBe("reference");
    expect(b.firm_lines).toBe(0);
    expect(b.reference_lines).toBe(15);
    expect(b.unpriced_lines).toBe(3); // GL-25 planting, GL-26 taps, GL-28 drainage at rate 0
    expect(b.total_lines).toBe(18);
    expect(b.reference_aed).toBeGreaterThan(90_000);
    expect(needsReferenceBanner(b)).toBe(true);
  });

  it("firm tiers (firm_private and the firm's own promoted correction) are the firm's; everything else is the reference", () => {
    const b = referenceBasisOf({ sections: [{ work_section: "S", lines: [line("firm_private"), line("firm_correction"), line("reference"), line("labour_book"), line("indicative"), line(undefined, 0, { rate_status: "needs_qs" })] }] });
    expect(b).toMatchObject({ basis: "mixed", firm_lines: 2, reference_lines: 3, unpriced_lines: 1, total_lines: 6, reference_aed: 30 });
  });

  it("all firm → firm basis, no banner; nothing → none; only QS-to-price lines → unpriced", () => {
    expect(referenceBasisOf({ sections: [{ work_section: "S", lines: [line("firm_private"), line("firm_private")] }] }).basis).toBe("firm");
    expect(needsReferenceBanner(referenceBasisOf({ sections: [{ work_section: "S", lines: [line("firm_private")] }] }))).toBe(false);
    expect(referenceBasisOf({ sections: [] }).basis).toBe("none");
    expect(referenceBasisOf(null).basis).toBe("none");
    expect(referenceBasisOf({ sections: [{ work_section: "S", lines: [line(undefined, 0, { rate_status: "needs_qs" })] }] }).basis).toBe("unpriced");
  });
});

describe("boqPricingFingerprint", () => {
  it("is the pricing only: a regenerated BoQ with a new timestamp fingerprints the same; a moved rate does not", () => {
    const a = { ...arabella, engine: { generated_at: "2026-01-01" } } as typeof arabella;
    expect(boqPricingFingerprint(a)).toBe(boqPricingFingerprint(arabella));
    const moved = { ...arabella, sections: arabella.sections.map((s, i) => (i === 0 ? { ...s, lines: s.lines.map((l, j) => (j === 0 ? { ...l, rate_aed: l.rate_aed + 1 } : l)) } : s)) };
    expect(boqPricingFingerprint(moved)).not.toBe(boqPricingFingerprint(arabella));
    expect(boqPricingFingerprint(null)).toBe(boqPricingFingerprint({ sections: [] }));
  });
});

describe("proposalGateVerdict", () => {
  const ref = referenceBasisOf(arabella);
  const firm = referenceBasisOf({ sections: [{ work_section: "S", lines: [line("firm_private")] }] });

  it("passes on the firm's own basis without any review or acceptance", () => {
    expect(proposalGateVerdict({ basis: firm, bookStatus: null, accepted: false })).toEqual({ ok: true, reason: "firm_basis", refusal: null });
  });

  it("refuses a reference-priced BoQ until the book is reviewed or the basis is accepted — and names the way out", () => {
    const v = proposalGateVerdict({ basis: ref, bookStatus: "draft", accepted: false });
    expect(v.ok).toBe(false);
    expect(v.refusal).toMatch(/15 of 18 lines are priced from the market reference/);
    expect(v.refusal).toMatch(/Mark the rate book reviewed, or accept the reference basis/);
    expect(proposalGateVerdict({ basis: ref, bookStatus: "reviewed", accepted: false })).toMatchObject({ ok: true, reason: "book_reviewed" });
    expect(proposalGateVerdict({ basis: ref, bookStatus: "draft", accepted: true })).toMatchObject({ ok: true, reason: "accepted" });
    // A reviewed book is the stronger statement and wins the label when both hold.
    expect(proposalGateVerdict({ basis: ref, bookStatus: "reviewed", accepted: true }).reason).toBe("book_reviewed");
  });
});
