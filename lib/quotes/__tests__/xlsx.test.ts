import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listVocabulary } from "@/lib/firms/vocabulary";

import { buildTemplate, parseQuoteWorkbook, parseRows, TEMPLATE_HEADERS } from "../template";
import { columnIndex, columnLetter, readXlsx, writeXlsx } from "../xlsx";

// =============================================================================
// U3 — the xlsx layer and the template parser, on the ONE synthetic fixture.
// =============================================================================

const FIXTURE = path.resolve(__dirname, "../__fixtures__/synthetic-quote.xlsx");
const vocab = () => listVocabulary().map((v) => ({ ...v, reference: { kind: "none" as const } }));

describe("xlsx round trip", () => {
  it("writes what it reads: strings, numbers, empty cells, several sheets", () => {
    const sheets = [
      { name: "One", rows: [["a", 1, "", "d"], [2.5, "x&y<z>", null, ""], []] },
      { name: "Two", rows: [["only"]] },
    ];
    const back = readXlsx(writeXlsx(sheets));
    expect(back.map((s) => s.name)).toEqual(["One", "Two"]);
    expect(back[0]!.rows[0]).toEqual(["a", "1", "", "d"]);
    expect(back[0]!.rows[1]).toEqual(["2.5", "x&y<z>", "", ""]);
    expect(back[1]!.rows[0]).toEqual(["only"]);
  });
  it("column letters", () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(["A", "B", "Z", "AA", "AB", "ZZ", "AAA"]);
    for (const l of ["A", "Z", "AA", "AB", "ZZ", "AAA"]) expect(columnLetter(columnIndex(l))).toBe(l);
  });
});

describe("the synthetic fixture", () => {
  const bytes = new Uint8Array(fs.readFileSync(FIXTURE));

  it("is the one committed quotation fixture, byte-stable", () => {
    // Regenerate with scripts/make-synthetic-quote.mjs; this pins the content, not
    // the zip's timestamps (fflate writes none), so a rebuild is identical.
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("d1d78e92cd84c858539ad63568403f642334f0d0eb5b5baf2c44e84f22d6337b");
    const files = fs.readdirSync(path.dirname(FIXTURE));
    expect(files).toEqual(["synthetic-quote.xlsx"]);
  });

  it("parses every row, holds the unreadable rate and keeps the foreign currency", () => {
    const p = parseQuoteWorkbook(bytes);
    expect(p.header_row).toBe(1);
    expect(p.lines.map((l) => l.row_no)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.lines[0]).toMatchObject({ item_key_given: "garden.pcc_base", rate_raw: 98.5, unit: "m2", currency: "AED", parse_note: null });
    expect(p.lines[5]).toMatchObject({ currency: "USD", rate_raw: 95 });
    expect(p.lines[6]).toMatchObject({ rate_raw: null, parse_note: '"on request" is not a number' });
    expect(p.lines.every((l) => l.description.length > 0)).toBe(true);
  });
});

describe("the template", () => {
  it("has the six headers on a Quote sheet, a how-to sheet, and the vocabulary", () => {
    const sheets = readXlsx(buildTemplate(vocab()));
    expect(sheets.map((s) => s.name)).toEqual(["Quote", "How to fill", "Vocabulary"]);
    expect(sheets[0]!.rows[0]).toEqual([...TEMPLATE_HEADERS]);
    expect(sheets[2]!.rows.length).toBe(vocab().length + 1);
    expect(sheets[2]!.rows[0]).toEqual(["item_key", "label", "unit", "section", "accepts"]);
  });
  it("a filled template parses back; header synonyms and any column order work", () => {
    const filled = writeXlsx([{ name: "Quote", rows: [[...TEMPLATE_HEADERS], ["", "PCC base under paving", 10, "m2", "1,234.50", "AED"]] }]);
    expect(parseQuoteWorkbook(filled).lines[0]).toMatchObject({ rate_raw: 1234.5, qty: 10 });
    const other = parseRows([["Unit Rate", "Particulars", "UOM"], [55, "Wall plaster", "m2"]], 0, { rate: 0, description: 1, unit: 2 });
    expect(other.lines[0]).toMatchObject({ description: "Wall plaster", rate_raw: 55, unit: "m2" });
  });
  it("refuses a workbook with no description + rate header", () => {
    expect(() => parseQuoteWorkbook(writeXlsx([{ name: "x", rows: [["a", "b"], [1, 2]] }]))).toThrow(/header row/);
  });
});
