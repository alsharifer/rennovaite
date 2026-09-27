// =============================================================================
// lib/quotes/template.ts — the quote template a firm downloads, and the parser
// that reads it (or any sheet with the same column names) back (U3).
//
// Columns, by header name, case-insensitive, any order; synonyms accepted:
//   item_key      optional — a take-off key when the supplier (or the firm)
//                 already knows it; honoured as a suggestion scoring 1
//   description   required — the supplier's own words
//   qty           optional — for the record; a rate book stores rates, not quantities
//   unit          the unit the rate is per
//   rate          the figure as quoted (net or list, incl. or excl. VAT — the
//                 quote record says which; lib/quotes/derive.ts applies it)
//   currency      per line, defaulting to the record's
//
// Nothing is dropped: a row with a description but an unreadable rate is kept
// and HELD with the reason. Pure — rows in, lines out.
// =============================================================================

import type { VocabularyItem } from "@/lib/firms/vocabulary-client";

import { readXlsx, writeXlsx, type Cell, type Sheet } from "./xlsx";

export const TEMPLATE_HEADERS = ["item_key", "description", "qty", "unit", "rate", "currency"] as const;

const SYNONYMS: Record<(typeof TEMPLATE_HEADERS)[number], string[]> = {
  item_key: ["item_key", "item key", "key", "code", "item code"],
  description: ["description", "item", "desc", "work item", "particulars", "scope"],
  qty: ["qty", "quantity", "qty.", "quantities"],
  unit: ["unit", "uom", "units", "per"],
  rate: ["rate", "unit rate", "price", "unit price", "rate aed", "rate (aed)", "amount per unit"],
  currency: ["currency", "ccy", "cur"],
};

export interface ParsedLine {
  row_no: number;
  description: string;
  item_key_given: string | null;
  qty: number | null;
  unit: string | null;
  rate_raw: number | null;
  currency: string | null;
  /** Why the rate could not be read (the line is still kept). */
  parse_note: string | null;
}

export interface ParseResult {
  lines: ParsedLine[];
  header_row: number;
  columns: Partial<Record<(typeof TEMPLATE_HEADERS)[number], number>>;
  skipped_blank: number;
}

/** The workbook a firm downloads: the sheet to fill, how to fill it, and the vocabulary. */
export function buildTemplate(vocab: readonly VocabularyItem[]): Uint8Array {
  const quote: Sheet = { name: "Quote", rows: [[...TEMPLATE_HEADERS]] };
  const how: Sheet = {
    name: "How to fill",
    rows: [
      ["One row per priced item. Only `description` and `rate` are required."],
      ["item_key: optional. If you know the take-off key (see the Vocabulary sheet), put it here — it will be suggested for confirmation. Otherwise leave it blank and the description is matched."],
      ["qty: optional, kept for the record. A rate book stores rates, not quantities."],
      ["unit: the unit the rate is per. Take-off units: m2, lm, no, project, lump, point, m2 plan, m3."],
      ["rate: the figure exactly as quoted. On upload you state whether rates are NET or LIST (and the discount), and whether they INCLUDE VAT — the book stores net, excluding VAT, in AED."],
      ["currency: AED. A line in another currency is kept but held — no exchange rate is applied."],
      ["Nothing you upload is applied on its own: every line is reviewed, a suggested item is confirmed by a member, and only then does a rate enter the book, marked as coming from this quotation."],
    ],
  };
  const vocabulary: Sheet = {
    name: "Vocabulary",
    rows: [["item_key", "label", "unit", "section", "accepts"], ...vocab.map((v): Cell[] => [v.item_key, v.label, v.unit ?? "(per line)", v.section, v.kinds.join(" / ")])],
  };
  return writeXlsx([quote, how, vocabulary]);
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function findHeader(rows: Cell[][]): { row: number; columns: ParseResult["columns"] } | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = (rows[r] ?? []).map(norm);
    const columns: ParseResult["columns"] = {};
    for (const h of TEMPLATE_HEADERS) {
      const i = cells.findIndex((c) => SYNONYMS[h].includes(c));
      if (i >= 0) columns[h] = i;
    }
    if (columns.description !== undefined && columns.rate !== undefined) return { row: r, columns };
  }
  return null;
}

function num(v: Cell): { value: number | null; note: string | null } {
  if (v === null || v === undefined || v === "") return { value: null, note: null };
  if (typeof v === "number") return { value: v, note: null };
  const cleaned = String(v).replace(/,/g, "").replace(/aed|usd|eur|gbp/gi, "").trim();
  const n = Number(cleaned);
  if (cleaned === "" || !Number.isFinite(n)) return { value: null, note: `"${String(v).trim()}" is not a number` };
  return { value: n, note: null };
}

/** Parse the first sheet whose header names a description and a rate column. */
export function parseQuoteWorkbook(bytes: Uint8Array): ParseResult {
  const sheets = readXlsx(bytes);
  for (const s of sheets) {
    const h = findHeader(s.rows);
    if (h) return parseRows(s.rows, h.row, h.columns);
  }
  throw new QuoteParseError("no sheet has a header row with a description and a rate column (use the downloaded template)");
}

export class QuoteParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteParseError";
  }
}

export function parseRows(rows: Cell[][], headerRow: number, columns: ParseResult["columns"]): ParseResult {
  const lines: ParsedLine[] = [];
  let skipped = 0;
  const col = (row: Cell[], h: keyof typeof columns): Cell => (columns[h] === undefined ? "" : row[columns[h]!]);
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const description = String(col(row, "description") ?? "").trim();
    const rateCell = col(row, "rate");
    const keyCell = String(col(row, "item_key") ?? "").trim();
    if (!description && (rateCell === "" || rateCell === null || rateCell === undefined) && !keyCell) {
      skipped++;
      continue;
    }
    const rate = num(rateCell);
    const qty = num(col(row, "qty"));
    const unit = String(col(row, "unit") ?? "").trim();
    const currency = String(col(row, "currency") ?? "").trim();
    lines.push({
      row_no: r + 1,
      description: description || keyCell || `(row ${r + 1}, no description)`,
      item_key_given: keyCell || null,
      qty: qty.value,
      unit: unit || null,
      rate_raw: rate.value,
      currency: currency ? currency.toUpperCase() : null,
      parse_note: rate.note ?? (rate.value === null ? "no rate on the row" : null),
    });
  }
  return { lines, header_row: headerRow + 1, columns, skipped_blank: skipped };
}
