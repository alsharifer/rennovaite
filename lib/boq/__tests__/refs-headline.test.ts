import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildBoqPdfPages } from "@/lib/documents/boq-pdf";
import { boqDerivedInfo, derivedTotal, isUnpricedLine } from "@/lib/documents/boq-derived";
import { VILLA94_GARDEN } from "@/lib/ground-truth/villa94-garden-plan";
import { findBoqLines } from "@/lib/viewer/inspect";

import { buildGardenSections } from "../garden-boq-feed";
import { transcriptionGardenBook } from "../garden-rates";
import { assignRefs, legacyRef, refMigration, refMigrationCsv, resolveRef, sectionCode, SECTION_REF_CODES, REF_MIGRATION_CSV_HEADER } from "../refs";
import { POMI_SECTIONS } from "../schema";
import { chainTotals } from "../totals";

// =============================================================================
// D4 — no rate-0 QS-to-price line is ever inside a headline total silently.
// D5 — every REF is unique within a BoQ, and old codes stay reconcilable.
// =============================================================================

type Doc = Parameters<typeof buildBoqPdfPages>[0]["boq"];

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "__snapshots__/mudon-boq.golden.json"), "utf8")) as Record<string, Doc>;

function gardenDoc(): Doc {
  const built = buildGardenSections(VILLA94_GARDEN, transcriptionGardenBook());
  const sections = built.sections as unknown as Doc["sections"];
  const subtotal = Math.round(sections.reduce((a, s) => a + s.section_total_aed, 0) * 100) / 100;
  return { sections, ...chainTotals({ subtotal_aed: subtotal, contingency_pct: 8, vat_pct: 5 }) } as Doc;
}

/** Arabella's shape: taps, planting and drainage all QS-to-price at rate 0. */
function arabellaLike(): Doc {
  const doc = gardenDoc();
  const unpriced = (description: string, unit: string, rule_id: string) => ({
    description, quantity: 2, unit, rate_aed: 0, total_aed: 0, vendor_or_source: "rate to be confirmed — not in the landscape rate book",
    notes: "", rule_id, kind: "supply_and_install", rate_band: "sku", wastage_pct: 0, rate_status: "needs_qs",
  });
  doc.sections.push({
    work_section: "Plumbing",
    section_total_aed: 0,
    lines: [
      unpriced("Outdoor water tap (hose bib) with isolation valve (no reference rate — QS to price)", "no", "GL-26"),
      unpriced("Drainage point / gully in paving (absorbed at no charge in the reference project — QS to confirm)", "no", "GL-28"),
    ],
  } as never);
  return doc;
}

const ALL: [string, () => Doc][] = [
  ...Object.keys(GOLDEN).map((k) => [`Mudon ${k}`, () => GOLDEN[k]!] as [string, () => Doc]),
  ["Villa 94 garden", gardenDoc],
  ["Arabella-like garden", arabellaLike],
];

describe("D4 — the headline excludes, and names, every line still to be priced", () => {
  for (const [name, make] of ALL) {
    it(`${name}: no rate-0 QS line is inside the headline`, () => {
      const boq = make();
      const unpriced = boq.sections.flatMap((s) => s.lines.filter(isUnpricedLine).map((l) => l.description));
      const h = derivedTotal(boq.grand_total_aed, boqDerivedInfo(boq));
      // Every one is excluded, by name, and none carries a cost.
      expect(h.excluded.map((x) => x.description)).toEqual(unpriced);
      for (const s of boq.sections) for (const l of s.lines) if (isUnpricedLine(l)) expect(l.total_aed).toBe(0);
      if (unpriced.length > 0) {
        expect(h.headline).toBe(`${h.text} · excludes ${unpriced.length} line${unpriced.length === 1 ? "" : "s"} to be priced`);
        const pdf = buildBoqPdfPages({ projectName: name, community: "Dubai", dateISO: "2026-09-22", boq }).join("");
        expect(pdf).toContain('data-headline-excludes="true"');
        for (const d of unpriced) expect(pdf).toContain(d.slice(0, 30).replace(/&/g, "&amp;"));
      } else {
        expect(h.excludes).toBeNull();
        expect(h.headline).toBe(h.text);
      }
    });
  }

  it("Arabella-like: taps, drainage and planting are all named", () => {
    const h = derivedTotal(0, boqDerivedInfo(arabellaLike()));
    expect(h.excluded.map((x) => x.description.split(" (")[0])).toEqual(
      expect.arrayContaining(["Planting beds — soil preparation and planting", "Outdoor water tap", "Drainage point / gully in paving"]),
    );
    expect(h.excludes).toBe(`excludes ${h.excluded.length} lines to be priced`);
  });

  it("a priced line that merely awaits QS validation (rate > 0) is NOT excluded", () => {
    expect(isUnpricedLine({ rate_status: "needs_qs", rate_aed: 400 })).toBe(false);
    expect(isUnpricedLine({ rate_status: "needs_qs", rate_aed: 0 })).toBe(true);
    expect(isUnpricedLine({ rate_status: "site_assessment", rate_aed: 0 })).toBe(false);
  });
});

describe("D5 — REF codes are unique and old ones stay reconcilable", () => {
  it("every section code is unique, and every POMI section has one", () => {
    const codes = Object.values(SECTION_REF_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const s of POMI_SECTIONS) expect(SECTION_REF_CODES[s], s).toBeTruthy();
  });

  for (const [name, make] of ALL) {
    it(`${name}: every line's REF is unique in the BoQ`, () => {
      const refs = Object.values(assignRefs(make().sections));
      expect(new Set(refs).size).toBe(refs.length);
    });
  }

  it("the old scheme collided (P-01 ×3); the new one does not", () => {
    const sections = ["Plaster", "Plumbing", "Preliminaries"].map((work_section) => ({ work_section, lines: [{ description: "x" }] }));
    expect(sections.map((s) => legacyRef(s.work_section, 0))).toEqual(["P-01", "P-01", "P-01"]);
    expect(Object.values(assignRefs(sections))).toEqual(["PLA-01", "PLB-01", "PRE-01"]);
  });

  it("two unknown sections with the same initials are suffixed, never merged", () => {
    const sections = [{ work_section: "Pool Works", lines: [1] }, { work_section: "Paving Works", lines: [1] }];
    expect(sectionCode("Pool Works")).toBe(sectionCode("Paving Works"));
    expect(Object.values(assignRefs(sections))).toEqual(["PW-01", "PW2-01"]);
  });

  it("a legacy code resolves only when unambiguous — never a guess", () => {
    const sections = [
      { work_section: "Plaster", lines: [1] },
      { work_section: "Preliminaries", lines: [1, 2] },
      { work_section: "Irrigation", lines: [1] },
    ];
    expect(resolveRef(sections, "PRE-02")).toBe("PRE-02"); // current code
    expect(resolveRef(sections, "P-01")).toBeNull(); // Plaster or Preliminaries?
    expect(resolveRef(sections, "P-02")).toBe("PRE-02"); // only Preliminaries has a line 2
    expect(resolveRef(sections, "I-01")).toBe("IRR-01");
  });

  it("the migration table maps every line old → new, and the CSV carries it", () => {
    const doc = GOLDEN.mid!;
    const rows = refMigration(doc.sections);
    expect(rows).toHaveLength(doc.sections.reduce((n, s) => n + s.lines.length, 0));
    const csv = refMigrationCsv(rows);
    expect(csv.split("\n")[0]).toBe(REF_MIGRATION_CSV_HEADER);
    expect(csv.split("\n")).toHaveLength(rows.length + 1);
  });

  it("the PDF prints the same REFs as the screen, and a REF-changes page", () => {
    const doc = GOLDEN.mid!;
    const pdf = buildBoqPdfPages({ projectName: "Mudon", community: "Dubai", dateISO: "2026-09-22", boq: doc }).join("");
    for (const ref of Object.values(assignRefs(doc.sections))) expect(pdf).toContain(`data-ref="${ref}"`);
    expect(pdf).toContain("REF CHANGES");
    expect(pdf).toContain('data-ref-map="P-01→PLA-01"');
  });

  it("the 3D viewer's tap-to-inspect links use the same REFs", () => {
    const doc = { sections: [{ work_section: "Plaster", lines: [{ description: "Wall plaster", quantity: 1, unit: "m2", total_aed: 1, element_refs: ["w1"] }] }] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(findBoqLines(doc as any, ["w1"])[0]!.ref).toBe(assignRefs(doc.sections)["Plaster-0"]);
  });
});
