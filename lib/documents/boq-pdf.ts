// =============================================================================
// lib/documents/boq-pdf.ts — the garden BoQ as a document (G5).
//
// Until G5 the BoQ page's "Export PDF" button did nothing. A draft pack needs the
// BoQ in the client's hands, with the same honesty the page has: the draft
// statement in the header of EVERY page, derived lines marked, the total printed
// with the derived convention (lib/documents/boq-derived.ts), and every rate's
// source shown by its public label — never a contractor.
//
// Pure page builder (SVG, A4 portrait) + a server wrapper that rasterises each
// page through resvg into pdf-lib, like the drawing set. The SVGs are returned
// alongside the PDF so the identity assertion can scan exactly what was printed.
// =============================================================================

import { esc } from "@/lib/drawings/sheet";

import { OHP_LINE_LABEL } from "@/lib/rates/ohp";

import { boqDerivedInfo, derivedLineNote, derivedTotal } from "./boq-derived";
import { formatAed } from "@/lib/format/aed";

export const BOQ_PAGE_W = 210;
export const BOQ_PAGE_H = 297;
const M = 14;

const INK_900 = "#0F1B2D";
const INK_700 = "#334155";
const INK_500 = "#64748b";
const INK_100 = "#e2e8f0";
const BRASS = "#A4793A";
const TERRACOTTA = "#9d3e1d";
const FONT_UI = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const FONT_DISPLAY = "'EB Garamond', Georgia, serif";

export interface BoqPdfLine {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes?: string | null;
  rate_status?: string;
  qty_derived?: boolean;
}

export interface BoqPdfInput {
  projectName: string;
  community: string;
  dateISO: string;
  boq: {
    sections: { work_section: string; lines: BoqPdfLine[]; section_total_aed: number }[];
    subtotal_aed: number;
    contingency_pct: number;
    contingency_aed: number;
    vat_pct: number;
    vat_aed: number;
    grand_total_aed: number;
    /** L1: the firm's OH&P — printed as its own summary row, never folded into a rate. */
    ohp_pct?: number;
    ohp_aed?: number;
    garden?: {
      draft?: { draft?: boolean; statement?: string | null; note?: string | null } | null;
      derived_lines?: number;
      kept?: { name: string }[];
      removals?: { name: string; qty: number; unit: string; disposition: string }[];
      undecided?: { name: string }[];
    } | null;
    /** G5d: the indicative delivery programme (lib/boq/programme.ts). */
    programme?: { total_days: number; phases: { name: string; start_day: number; days: number }[]; basis: string } | null;
  };
}

const STATUS_MARK: Record<string, { mark: string; label: string }> = {
  actual_transaction: { mark: "A", label: "rate from a completed comparable project" },
  site_assessment: { mark: "S", label: "allowance — confirm against this site" },
  needs_qs: { mark: "Q", label: "no reference rate — QS to price (rate 0)" },
  needs_selection: { mark: "C", label: "a choice is still open — priced at the cheaper default" },
  indicative: { mark: "I", label: "indicative" },
  priced: { mark: "P", label: "catalogue price" },
};

const aed = (n: number) => formatAed(n, "amount");
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * G5d (session comment 7 — client legibility): body, note and label sizes are
 * set about 22% larger (never under 2.6 mm ≈ 7.4 pt on A4); headings keep theirs.
 * Row heights and wrap widths below are scaled with it (K).
 */
const K = 1.22;
export const boqLegible = (size: number) => (size >= 3.4 ? size : Math.round(Math.max(2.6, size * K) * 100) / 100);

function t(x: number, y: number, s: string, o: { size?: number; fill?: string; font?: string; anchor?: string; weight?: number; spacing?: string } = {}): string {
  return `<text x="${f1(x)}" y="${f1(y)}" font-size="${boqLegible(o.size ?? 2.6)}" fill="${o.fill ?? INK_900}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""} style="font-family:${o.font ?? FONT_UI}${o.weight ? `;font-weight:${o.weight}` : ""}${o.spacing ? `;letter-spacing:${o.spacing}` : ""}">${esc(s)}</text>`;
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

type Row =
  | { kind: "section"; title: string }
  | { kind: "line"; line: BoqPdfLine; desc: string[]; sub: string[] }
  | { kind: "section_total"; title: string; total: number };

/** Build the BoQ pages. Deterministic. */
export function buildBoqPdfPages(input: BoqPdfInput): string[] {
  const { boq } = input;
  const info = boqDerivedInfo(boq);
  const total = derivedTotal(boq.grand_total_aed, info);
  const statement = info.draft ? info.statement : null;

  const rows: Row[] = [];
  for (const s of boq.sections) {
    rows.push({ kind: "section", title: s.work_section });
    for (const l of s.lines) {
      const sub = [derivedLineNote(l), l.vendor_or_source ? `Source: ${l.vendor_or_source}` : null].filter((x): x is string => !!x).flatMap((x) => wrap(x, 72));
      rows.push({ kind: "line", line: l, desc: wrap(l.description, 48).slice(0, 4), sub });
    }
    rows.push({ kind: "section_total", title: s.work_section, total: s.section_total_aed });
  }
  const DESC_H = 3.4 * K;
  const SUB_H = 3 * K;
  const rowH = (r: Row) => (r.kind === "section" ? 9 : r.kind === "section_total" ? 8 : DESC_H * r.desc.length + SUB_H * r.sub.length + 2.6);

  const header = (n: number) => {
    let s = t(M, 14, "RennovAIte", { size: 4.4, fill: BRASS, font: FONT_DISPLAY });
    s += t(BOQ_PAGE_W - M, 14, `${input.projectName} · Bill of Quantities`, { size: 2.6, fill: INK_500, anchor: "end" });
    let y = 18;
    if (statement) {
      s += `<rect x="${M}" y="${y}" width="${BOQ_PAGE_W - 2 * M}" height="9" fill="#FDF3EE" stroke="${TERRACOTTA}" stroke-width="0.45" data-boq-draft="true"/>`;
      s += t(M + 3, y + 5.8, statement, { size: 2.7, fill: TERRACOTTA, weight: 700 });
      y += 11;
    } else {
      s += `<line x1="${M}" y1="${y}" x2="${BOQ_PAGE_W - M}" y2="${y}" stroke="${INK_100}" stroke-width="0.3"/>`;
      y += 3;
    }
    s += t(BOQ_PAGE_W - M, BOQ_PAGE_H - 8, `${n}`, { size: 2.4, fill: INK_500, font: FONT_MONO, anchor: "end" });
    s += t(M, BOQ_PAGE_H - 8, `POMI work sections · AED · dated ${input.dateISO}`, { size: 2.2, fill: INK_500 });
    return { svg: s, y };
  };

  const colHead = (y: number) =>
    t(M, y, "DESCRIPTION", { size: 2.1, fill: INK_500, spacing: "0.06em" }) +
    t(128, y, "QTY", { size: 2.1, fill: INK_500, anchor: "end" }) +
    t(131, y, "UNIT", { size: 2.1, fill: INK_500 }) +
    t(162, y, "RATE", { size: 2.1, fill: INK_500, anchor: "end" }) +
    t(BOQ_PAGE_W - M, y, "TOTAL", { size: 2.1, fill: INK_500, anchor: "end" }) +
    `<line x1="${M}" y1="${f1(y + 1.6)}" x2="${BOQ_PAGE_W - M}" y2="${f1(y + 1.6)}" stroke="${INK_100}" stroke-width="0.3"/>`;

  const pages: string[] = [];
  let n = 1;
  let { svg, y } = header(n);

  // Title block on page 1.
  svg += t(M, y + 12, "Bill of Quantities", { size: 9, font: FONT_DISPLAY });
  svg += t(M, y + 19, `${input.projectName} · ${input.community}`, { size: 3.2, fill: INK_700 });
  svg += t(BOQ_PAGE_W - M, y + 12, total.text, { size: 7.5, font: FONT_MONO, anchor: "end" });
  svg += t(BOQ_PAGE_W - M, y + 19, "grand total incl. contingency and VAT", { size: 2.4, fill: INK_500, anchor: "end" });
  y += 24;
  if (total.footnote) {
    for (const line of wrap(total.footnote, 88)) {
      svg += t(M, y, line, { size: 2.4, fill: TERRACOTTA });
      y += 3.2 * K;
    }
    y += 1;
  }
  const g = boq.garden;
  if (g && ((g.kept?.length ?? 0) > 0 || (g.removals?.length ?? 0) > 0 || (g.undecided?.length ?? 0) > 0)) {
    const lines = [
      g.kept?.length ? `Existing on site, kept and excluded from demolition and new work: ${g.kept.map((k) => k.name).join(", ")}.` : null,
      g.removals?.length ? `Existing on site, taken out (in the demolition line): ${g.removals.map((r) => `${r.name} (${r.disposition})`).join(", ")}.` : null,
      g.undecided?.length ? `Not yet decided (in no quantity): ${g.undecided.map((u) => u.name).join(", ")}.` : null,
    ].filter((x): x is string => !!x);
    for (const para of lines) {
      for (const line of wrap(para, 90)) {
        svg += t(M, y, line, { size: 2.3, fill: INK_700 });
        y += 3.1 * K;
      }
    }
    y += 2;
  }
  y += 4;
  svg += colHead(y);
  y += 6;

  const bottom = BOQ_PAGE_H - 30;
  const flush = () => {
    pages.push(page(svg));
    n += 1;
    const h = header(n);
    svg = h.svg + colHead(h.y + 6);
    y = h.y + 12;
  };

  for (const r of rows) {
    if (y + rowH(r) > bottom) flush();
    if (r.kind === "section") {
      svg += t(M, y + 4, r.title.toUpperCase(), { size: 2.7, fill: BRASS, weight: 700, spacing: "0.05em" });
      y += 8;
    } else if (r.kind === "section_total") {
      svg += `<line x1="120" y1="${f1(y)}" x2="${BOQ_PAGE_W - M}" y2="${f1(y)}" stroke="${INK_100}" stroke-width="0.3"/>`;
      svg += t(162, y + 4, `${r.title} total`, { size: 2.4, fill: INK_500, anchor: "end" });
      svg += t(BOQ_PAGE_W - M, y + 4, aed(r.total), { size: 2.6, font: FONT_MONO, anchor: "end", weight: 700 });
      y += 7;
    } else {
      const l = r.line;
      const status = STATUS_MARK[l.rate_status ?? ""];
      r.desc.forEach((d, i) => {
        svg += t(M + 4, y + 2.6 + i * DESC_H, d, { size: 2.55 });
      });
      if (status) svg += t(M, y + 2.6, status.mark, { size: 2.2, fill: status.mark === "A" ? BRASS : TERRACOTTA, font: FONT_MONO, weight: 700 });
      const qty = `${l.qty_derived ? "≈ " : ""}${l.quantity}`;
      svg += t(128, y + 2.6, qty, { size: 2.55, font: FONT_MONO, anchor: "end", fill: l.qty_derived ? TERRACOTTA : INK_900 });
      svg += t(131, y + 2.6, l.unit, { size: 2.4, fill: INK_700 });
      svg += t(162, y + 2.6, aed(l.rate_aed), { size: 2.55, font: FONT_MONO, anchor: "end" });
      svg += t(BOQ_PAGE_W - M, y + 2.6, aed(l.total_aed), { size: 2.55, font: FONT_MONO, anchor: "end" });
      let sy = y + 2.6 + r.desc.length * DESC_H;
      for (const s of r.sub) {
        svg += t(M + 4, sy - 0.4, s, { size: 2.1, fill: s.startsWith("≈") || s.startsWith("Quantity") ? TERRACOTTA : INK_500 });
        sy += SUB_H;
      }
      y += rowH(r);
    }
  }

  // Totals + legend.
  if (y + 58 > bottom) flush();
  y += 4;
  const sumRow = (label: string, value: string, bold = false) => {
    svg += t(162, y, label, { size: 2.7, fill: bold ? INK_900 : INK_700, anchor: "end", weight: bold ? 700 : undefined });
    svg += t(BOQ_PAGE_W - M, y, value, { size: bold ? 3.4 : 2.7, font: FONT_MONO, anchor: "end", weight: bold ? 700 : undefined });
    y += bold ? 7 : 5;
  };
  svg += `<line x1="110" y1="${f1(y - 3)}" x2="${BOQ_PAGE_W - M}" y2="${f1(y - 3)}" stroke="${INK_900}" stroke-width="0.35"/>`;
  sumRow("Subtotal", aed(boq.subtotal_aed));
  if (boq.ohp_aed && boq.ohp_aed > 0) sumRow(`${OHP_LINE_LABEL} ${boq.ohp_pct}%`, aed(boq.ohp_aed));
  sumRow(`Contingency ${boq.contingency_pct}%`, aed(boq.contingency_aed));
  sumRow(`VAT ${boq.vat_pct}%`, aed(boq.vat_aed));
  sumRow("Grand total", total.text, true);
  if (total.footnote) {
    for (const line of wrap(total.footnote, 88)) {
      svg += t(M, y, line, { size: 2.4, fill: TERRACOTTA });
      y += 3.2 * K;
    }
  }
  y += 4;
  svg += t(M, y, "RATE STATUS", { size: 2.2, fill: INK_500, spacing: "0.06em" });
  y += 4.6;
  for (const [, v] of Object.entries(STATUS_MARK).filter(([k]) => boq.sections.some((s) => s.lines.some((l) => l.rate_status === k)))) {
    svg += t(M, y, v.mark, { size: 2.3, fill: v.mark === "A" ? BRASS : TERRACOTTA, font: FONT_MONO, weight: 700 });
    svg += t(M + 5, y, v.label, { size: 2.3, fill: INK_700 });
    y += 3.4 * K;
  }
  svg += t(M, y + 2, "≈ quantity derived from the reference layout or inferred — see the note under the line.", { size: 2.3, fill: INK_700 });
  y += 8;

  // G5d (Newspace session ask #5): an INDICATIVE delivery programme, never a line.
  const prog = boq.programme;
  if (prog && prog.phases.length) {
    const basis = wrap(prog.basis, 92);
    const need = 16 + prog.phases.length * 6.5 + basis.length * 3.2 * K;
    if (y + need > bottom) flush();
    svg += t(M, y + 2, "INDICATIVE DELIVERY PROGRAMME", { size: 2.7, fill: BRASS, weight: 700, spacing: "0.05em" });
    svg += t(BOQ_PAGE_W - M, y + 2, `≈ ${prog.total_days} days · indicative · derived`, { size: 2.6, fill: TERRACOTTA, font: FONT_MONO, anchor: "end" });
    y += 7;
    const barX = 92;
    const barW = BOQ_PAGE_W - M - barX;
    for (const ph of prog.phases) {
      svg += t(M, y + 3, ph.name, { size: 2.5, fill: INK_900 });
      svg += t(barX - 3, y + 3, `${ph.days} d`, { size: 2.5, fill: INK_700, font: FONT_MONO, anchor: "end" });
      const x0 = barX + ((ph.start_day - 1) / prog.total_days) * barW;
      const w = Math.max(0.8, (ph.days / prog.total_days) * barW);
      svg += `<rect x="${f1(x0)}" y="${f1(y + 0.6)}" width="${f1(w)}" height="3.2" rx="0.6" fill="${BRASS}" fill-opacity="0.75" data-programme-phase="${esc(ph.name)}"/>`;
      y += 6.5;
    }
    svg += t(barX, y + 1.5, "day 1", { size: 2.1, fill: INK_500, font: FONT_MONO });
    svg += t(BOQ_PAGE_W - M, y + 1.5, `day ${prog.total_days}`, { size: 2.1, fill: INK_500, font: FONT_MONO, anchor: "end" });
    y += 6;
    for (const line of basis) {
      svg += t(M, y, line, { size: 2.2, fill: INK_700 });
      y += 3.2 * K;
    }
  }
  pages.push(page(svg));
  return pages;
}

function page(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOQ_PAGE_W}mm" height="${BOQ_PAGE_H}mm" viewBox="0 0 ${BOQ_PAGE_W} ${BOQ_PAGE_H}"><rect x="0" y="0" width="${BOQ_PAGE_W}" height="${BOQ_PAGE_H}" fill="#FFFFFF"/>${body}</svg>`;
}

/** Rasterise the pages into an A4 PDF. Server-only (resvg + pdf-lib). */
export async function renderBoqPdf(input: BoqPdfInput): Promise<{ pdf: Uint8Array; pages: string[] }> {
  const pages = buildBoqPdfPages(input);
  const { Resvg } = await import("@resvg/resvg-js");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.projectName} — Bill of Quantities`);
  pdf.setAuthor("RennovAIte");
  pdf.setCreator("RennovAIte");
  pdf.setProducer("RennovAIte");
  const MM_TO_PT = 72 / 25.4;
  for (const svg of pages) {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 2480 } }).render().asPng();
    const p = pdf.addPage([BOQ_PAGE_W * MM_TO_PT, BOQ_PAGE_H * MM_TO_PT]);
    p.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width: BOQ_PAGE_W * MM_TO_PT, height: BOQ_PAGE_H * MM_TO_PT });
  }
  return { pdf: await pdf.save(), pages };
}
