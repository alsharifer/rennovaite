import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildGardenSections } from "@/lib/boq/garden-boq-feed";
import { transcriptionGardenBook } from "@/lib/boq/garden-rates";
import { chainTotals } from "@/lib/boq/totals";
import { VILLA94_GARDEN } from "@/lib/ground-truth/villa94-garden-plan";

import { buildBoqProvenance, lineTierKey, TIER_DISPLAY, type ProvBoq } from "../boq";

// I4 — every figure on a BoQ resolves a source chain, on BoQs of every vintage.

const GOLDEN = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../boq/__tests__/__snapshots__/mudon-boq.golden.json"), "utf8"),
) as Record<string, ProvBoq>;

function villa94Doc(): ProvBoq {
  const built = buildGardenSections(VILLA94_GARDEN, transcriptionGardenBook());
  const sections = built.sections as unknown as ProvBoq["sections"];
  const subtotal = Math.round(sections.reduce((a, s) => a + s.section_total_aed, 0) * 100) / 100;
  return { sections, ...chainTotals({ subtotal_aed: subtotal, contingency_pct: 8, vat_pct: 5 }) };
}

function figureCount(boq: ProvBoq) {
  return boq.sections.reduce((n, s) => n + s.lines.length * 3 + 1, 0) + 4; // qty/rate/total per line, section totals, subtotal/contingency/VAT/total
}

describe("provenance covers every figure", () => {
  for (const tier of ["value", "mid", "premium", "none"]) {
    it(`Mudon (${tier}): every line, section and summary figure has a chain; nothing is untraceable`, () => {
      const boq = GOLDEN[tier]!;
      const p = buildBoqProvenance(boq);
      const lineCount = boq.sections.reduce((n, s) => n + s.lines.length, 0);
      expect(Object.keys(p.lines)).toHaveLength(lineCount);
      expect(Object.keys(p.sections)).toHaveLength(boq.sections.length);
      for (const lp of Object.values(p.lines)) {
        for (const f of [lp.quantity, lp.rate, lp.total]) expect(f.steps.length).toBeGreaterThan(0);
      }
      expect(p.findings.map((f) => f.gap)).toEqual([]);
      expect(figureCount(boq)).toBeGreaterThan(lineCount * 3);
    });
  }

  it("Villa 94 garden: zones named, tier actual_transaction, chain reconciles", () => {
    const doc = villa94Doc();
    const ctx = {
      elements: { "z-pergola": { name: "Pergola", kind: "structure", derived: false, derived_note: null } },
      qsValidated: { "garden.pcc_base": false },
      withheldNames: [],
    };
    const p = buildBoqProvenance(doc, ctx);
    expect(p.findings).toEqual([]);
    const pccKey = Object.keys(p.lines).find((k) => p.lines[k]!.rate.title.includes("PCC base"))!;
    const pcc = p.lines[pccKey]!;
    expect(pcc.rate.steps.find((s) => s.kind === "tier")?.label).toBe("actual_transaction");
    expect(pcc.rate.steps.find((s) => s.kind === "qs")?.detail).toBe("QS-validated: no (rate book).");
    expect(pcc.quantity.steps[0]!.detail).toContain("Pergola (structure)");
    expect(pcc.quantity.steps[0]!.detail).toContain("no longer on the plan"); // ids not in ctx say so, never a made-up name
  });

  it("a BoQ stored before L1 (no rate_tier) infers the same tier the resolver recorded", () => {
    for (const s of GOLDEN.mid!.sections) {
      for (const l of s.lines) {
        const stored = l.rate_tier;
        const inferred = lineTierKey({ ...l, rate_tier: undefined }, s.work_section);
        if (stored && stored !== "selection") expect({ rule: l.rule_id, tier: inferred }).toEqual({ rule: l.rule_id, tier: stored });
      }
    }
  });

  it("flags: derived dimensions, sized to measured aggregate, QS to price", () => {
    const doc: ProvBoq = {
      sections: [
        {
          work_section: "Soft Landscaping",
          section_total_aed: 0,
          lines: [
            { description: "Planting beds — soil preparation and planting (no reference rate — QS to price)", quantity: 5, unit: "m2", rate_aed: 0, total_aed: 0, vendor_or_source: "rate to be confirmed — not in the landscape rate book", notes: "Σ planting bed area = 5 m²", rule_id: "GL-25", rate_status: "needs_qs", element_refs: ["bed"] },
          ],
        },
      ],
      subtotal_aed: 0, contingency_pct: 8, contingency_aed: 0, vat_pct: 5, vat_aed: 0, grand_total_aed: 0,
    };
    const p = buildBoqProvenance(doc, {
      elements: { bed: { name: "Rear planting bed", kind: "planting bed", derived: true, derived_note: "sized to measured aggregate; calibrated from type plan (Newspace site measurement)" } },
      qsValidated: {},
      withheldNames: ["Newspace"],
    });
    const line = p.lines["Soft Landscaping-0"]!;
    expect(line.rate.steps.find((s) => s.kind === "tier")?.label).toBe(TIER_DISPLAY.unpriced!.name);
    expect(line.quantity.flags).toEqual(expect.arrayContaining(["derived dimensions", "sized to measured aggregate", "QS to price"]));
    expect(JSON.stringify(p)).not.toContain("Newspace"); // a firm name in a zone note is withheld
  });

  it("an untraceable figure is REPORTED, never given a story", () => {
    const doc: ProvBoq = {
      sections: [{ work_section: "Preliminaries", section_total_aed: 500, lines: [{ description: "Legacy LLM line", quantity: 1, unit: "item", rate_aed: 400, total_aed: 400, vendor_or_source: "Claude estimate", notes: null }] }],
      subtotal_aed: 500, contingency_pct: 8, contingency_aed: 40, vat_pct: 5, vat_aed: 27, grand_total_aed: 567,
    };
    const p = buildBoqProvenance(doc);
    const f = p.lines["Preliminaries-0"]!;
    expect(f.rate.traceable).toBe(false);
    expect(f.quantity.traceable).toBe(false);
    expect(p.sections.Preliminaries!.traceable).toBe(false); // 400 ≠ 500 stored
    const gaps = p.findings.map((x) => x.gap).join("\n");
    expect(gaps).toMatch(/resolution tier cannot be established/);
    expect(gaps).toMatch(/no plan element/);
    expect(gaps).toMatch(/Section Preliminaries/);
  });
});
