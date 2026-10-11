import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildGardenSections } from "@/lib/boq/garden-boq-feed";
import { transcriptionGardenBook } from "@/lib/boq/garden-rates";
import { VILLA94_GARDEN } from "@/lib/ground-truth/villa94-garden-plan";

import { lineTotal, money2, sumMoney } from "../money";
import { assignRefs } from "../refs";
import { CANONICAL_SECTION_ORDER, sectionRank, sortSections } from "../section-order";
import { chainTotals, rechain, type ChainedDoc } from "../totals";

// H7 — every figure a QS sees multiplies out from the figures beside it.
//   rate_aed is a 2-dp figure; total_aed = round(quantity × rate_aed, 2);
//   a section total is Σ its lines to the fils; the subtotal Σ the sections;
//   contingency and VAT are each rounded once, to the fils; and
//   grand = subtotal + OH&P + contingency + VAT exactly.
// Sections run in THE canonical order, and reordering never moves a REF.

interface Line { description?: string; quantity: number; rate_aed: number; total_aed: number }
interface Section { work_section: string; lines: Line[]; section_total_aed: number }
interface Doc { sections: Section[]; subtotal_aed: number; contingency_pct: number; contingency_aed: number; vat_pct: number; vat_aed: number; grand_total_aed: number; ohp_pct?: number; ohp_aed?: number }

const load = (file: string): unknown => {
  let text = fs.readFileSync(path.join(__dirname, "__snapshots__", file), "utf8").trim();
  if (text.startsWith('"')) text = JSON.parse(text) as string;
  return JSON.parse(text);
};

function fixtureBoqs(): [string, Doc][] {
  const mudon = load("mudon-boq.golden.json") as Record<string, Doc>;
  const element = (load("element-mapping.golden.json") as { mapped: Doc }).mapped;
  const garden = rechain({
    sections: buildGardenSections(VILLA94_GARDEN, transcriptionGardenBook()).sections,
    subtotal_aed: 0, contingency_pct: 8, contingency_aed: 0, vat_pct: 5, vat_aed: 0, grand_total_aed: 0,
  } as unknown as ChainedDoc) as unknown as Doc;
  return [
    ...Object.entries(mudon).map(([tier, d]) => [`Mudon (${tier})`, d] as [string, Doc]),
    ["Mudon element-mapped (P4)", element],
    ["Villa 94 garden", garden],
    ["Villa 94 garden + 12% OH&P", rechain({ ...garden, ohp_pct: 12 } as unknown as ChainedDoc) as unknown as Doc],
  ];
}

const fils = (n: number) => Math.round(n * 100);
const is2dp = (n: number) => fils(n) / 100 === n;

describe("H7 — every line multiplies out", () => {
  for (const [name, boq] of fixtureBoqs()) {
    it(`${name}: total_aed == round(quantity × rate_aed, 2), with rate_aed already 2 dp`, () => {
      let n = 0;
      for (const s of boq.sections) {
        for (const l of s.lines) {
          n++;
          expect(is2dp(l.rate_aed), `${s.work_section} · ${l.description}: rate ${l.rate_aed}`).toBe(true);
          expect(l.total_aed, `${s.work_section} · ${l.description}`).toBe(money2(l.quantity * l.rate_aed));
          expect(l.total_aed).toBe(lineTotal(l.quantity, l.rate_aed));
        }
      }
      expect(n).toBeGreaterThan(0);
    });

    it(`${name}: section totals, subtotal and the chain add up to the fils`, () => {
      for (const s of boq.sections) expect(s.section_total_aed, s.work_section).toBe(sumMoney(s.lines.map((l) => l.total_aed)));
      expect(boq.subtotal_aed).toBe(sumMoney(boq.sections.map((s) => s.section_total_aed)));
      const c = chainTotals({ subtotal_aed: boq.subtotal_aed, contingency_pct: boq.contingency_pct, vat_pct: boq.vat_pct, ohp_pct: boq.ohp_pct });
      expect([boq.ohp_aed ?? 0, boq.contingency_aed, boq.vat_aed, boq.grand_total_aed]).toEqual([c.ohp_aed, c.contingency_aed, c.vat_aed, c.grand_total_aed]);
      for (const v of [boq.contingency_aed, boq.vat_aed, boq.grand_total_aed]) expect(is2dp(v)).toBe(true);
      expect(fils(boq.grand_total_aed)).toBe(fils(boq.subtotal_aed) + fils(boq.ohp_aed ?? 0) + fils(boq.contingency_aed) + fils(boq.vat_aed));
    });

    it(`${name}: sections in the canonical order`, () => {
      const ranks = boq.sections.map((s) => sectionRank(s.work_section));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      for (const s of boq.sections) expect(CANONICAL_SECTION_ORDER as readonly string[], s.work_section).toContain(s.work_section);
    });
  }

  it("a property check: random quantities and 4-dp rates", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 5000; i++) {
      const q = Math.round(rnd() * 50000) / 100;
      const r = Math.round(rnd() * 100000000) / 10000;
      const t = lineTotal(q, r);
      expect(is2dp(t)).toBe(true);
      expect(t).toBe(money2(q * money2(r)));
    }
    // The brief's case: GL-14 pergola, 12.25 m² plan at 1,366.6928 net.
    expect(money2(1366.6928)).toBe(1366.69);
    expect(lineTotal(12.25, 1366.6928)).toBe(16741.95);
  });
});

describe("H7 — the canonical order never moves a REF", () => {
  it("every SECTION in the canonical order has exactly one rank, Preliminaries first", () => {
    expect(CANONICAL_SECTION_ORDER[0]).toBe("Preliminaries");
    expect(new Set(CANONICAL_SECTION_ORDER).size).toBe(CANONICAL_SECTION_ORDER.length);
  });

  for (const [name, boq] of fixtureBoqs()) {
    it(`${name}: REF codes are identical before and after the sort`, () => {
      // The pre-H7 orders put Preliminaries late; shuffle the sections into
      // reverse to be sure the sort, not the input, decides.
      const shuffled = [...boq.sections].reverse();
      const before = assignRefs(shuffled);
      const after = assignRefs(sortSections(shuffled));
      expect(after).toEqual(before);
      // And the same line keeps the same REF: key → line identity.
      const byKey = (ss: Section[]) => Object.fromEntries(ss.flatMap((s) => s.lines.map((l, i) => [`${s.work_section}-${i}`, l.description])));
      expect(byKey(sortSections(shuffled))).toEqual(byKey(shuffled));
    });
  }

  it("lines never change position inside their section", () => {
    const secs = [
      { work_section: "Plumbing", lines: [{ description: "a" }, { description: "b" }] },
      { work_section: "Preliminaries", lines: [{ description: "c" }, { description: "d" }] },
      { work_section: "Unknown section", lines: [{ description: "e" }] },
      { work_section: "Demolition", lines: [{ description: "f" }] },
    ];
    const sorted = sortSections(secs);
    expect(sorted.map((s) => s.work_section)).toEqual(["Preliminaries", "Demolition", "Plumbing", "Unknown section"]);
    expect(sorted.find((s) => s.work_section === "Plumbing")!.lines.map((l) => l.description)).toEqual(["a", "b"]);
  });
});
