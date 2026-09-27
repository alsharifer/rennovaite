// =============================================================================
// lib/quotes/xlsx.ts — the smallest xlsx the quote template needs (U3).
//
// Write: a workbook of plain sheets (strings and numbers), inline strings, no
// styles worth the name. Read: shared and inline strings, numbers, any sheet —
// the same approach the repo already uses to read the design-session workbook
// (scripts/arabella-session-apply.ts), lifted into a library. No SheetJS: the
// npm build is stale, and a quote template does not need formulas, dates or
// merged cells. Pure — bytes in, rows out.
// =============================================================================

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type Cell = string | number | null | undefined;
export interface Sheet {
  name: string;
  rows: Cell[][];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function columnLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetXml(rows: Cell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null || v === undefined || v === "") return "";
          const ref = `${columnLetter(c)}${r + 1}`;
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join("");
      return cells ? `<row r="${r + 1}">${cells}</row>` : "";
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Bytes of an .xlsx holding the given sheets. */
export function writeXlsx(sheets: Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows));
  });
  return zipSync(files, { level: 6 });
}

/** Every sheet as a dense row/column grid of strings (numbers stringified as written). */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  const zip = unzipSync(bytes);
  const xml = (p: string) => (zip[p] ? strFromU8(zip[p]!) : "");
  const shared = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unesc([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")),
  );
  const rels = new Map(
    [...xml("xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
  );
  const sheets = [...xml("xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({
    name: unesc(m[1]!),
    target: rels.get(m[2]!) ?? "",
  }));
  return sheets.map((s) => {
    const path = s.target.startsWith("/") ? s.target.slice(1) : `xl/${s.target}`;
    const grid: string[][] = [];
    for (const c of xml(path).matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = columnIndex(c[1]!);
      const row = Number(c[2]) - 1;
      const attrs = c[3] ?? "";
      const inner = c[4] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      const is = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let val = "";
      if (v) val = /t="s"/.test(attrs) ? (shared[Number(v[1])] ?? "") : unesc(v[1]!);
      else if (is) val = unesc(is[1]!);
      if (val === "") continue;
      (grid[row] ??= [])[col] = val;
    }
    // Dense: no holes, every row an array.
    const width = grid.reduce((w, r) => Math.max(w, r?.length ?? 0), 0);
    const rows: Cell[][] = [];
    for (let r = 0; r < grid.length; r++) rows.push(Array.from({ length: width }, (_, c) => grid[r]?.[c] ?? ""));
    return { name: s.name, rows };
  });
}
