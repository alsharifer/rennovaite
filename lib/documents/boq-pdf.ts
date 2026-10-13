// =============================================================================
// lib/documents/boq-pdf.ts — the garden BoQ as a document (G5).
//
// Until G5 the BoQ page's "Export PDF" button did nothing. A draft pack needs the
// BoQ in the client's hands, with the same honesty the page has: the draft
// statement in the header of EVERY page, derived lines marked, the total printed
// with the derived convention (lib/documents/boq-derived.ts), and every rate's
// source shown by its public label — never a contractor.
//
// K8 #16: the pages are built in ./boq-pdf-pages (A4 landscape, Blueprint
// paper, marks per line — Figma 68:1396). This module keeps the shared input
// type, the A4 portrait primitives the revision-diff PDF still uses, and the
// server wrapper that rasterises pages through resvg into pdf-lib. The SVGs
// are returned alongside the PDF so the identity assertion can scan exactly
// what was printed.
// =============================================================================

import { documentFontOptions } from "./doc-fonts";
import { stampPdfDay } from "@/lib/documents/pdf-date";
import { esc } from "@/lib/drawings/sheet";

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

/** The BoQ PDF pages — K8 #16 (68:1396): A4 landscape, lib/documents/boq-pdf-pages. */
export { buildBoqPdfPages } from "./boq-pdf-pages";
import { BOQ_LAND_H, BOQ_LAND_W, buildBoqPdfPages } from "./boq-pdf-pages";

function page(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOQ_PAGE_W}mm" height="${BOQ_PAGE_H}mm" viewBox="0 0 ${BOQ_PAGE_W} ${BOQ_PAGE_H}"><rect x="0" y="0" width="${BOQ_PAGE_W}" height="${BOQ_PAGE_H}" fill="#FFFFFF"/>${body}</svg>`;
}

// U4: the A4 text/wrap/page primitives and the palette, shared with the revision
// diff PDF (lib/documents/revision-diff-pdf.ts) so the two documents cannot drift
// in type size, margins or colour.
export const A4_PDF = { M, INK_900, INK_700, INK_500, INK_100, BRASS, TERRACOTTA, FONT_UI, FONT_MONO, FONT_DISPLAY, K } as const;
export { t as a4Text, wrap as a4Wrap, page as a4Page, f1 as a4Num };

/** Rasterise A4 SVG pages into a PDF (resvg → pdf-lib), dated to the UTC day. Server-only. Portrait unless a size is given (mm). */
export async function rasteriseA4Pages(pages: readonly string[], title: string, size: { w: number; h: number } = { w: BOQ_PAGE_W, h: BOQ_PAGE_H }): Promise<Uint8Array> {
  const { Resvg } = await import("@resvg/resvg-js");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = stampPdfDay(await PDFDocument.create());
  pdf.setTitle(title);
  pdf.setAuthor("RenovAIte");
  pdf.setCreator("RenovAIte");
  pdf.setProducer("RenovAIte");
  const MM_TO_PT = 72 / 25.4;
  for (const svg of pages) {
    // 300 dpi across the page width, whichever way it is turned.
    const png = new Resvg(svg, { fitTo: { mode: "width", value: Math.round((size.w / 25.4) * 300) }, font: documentFontOptions() }).render().asPng();
    const p = pdf.addPage([size.w * MM_TO_PT, size.h * MM_TO_PT]);
    p.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width: size.w * MM_TO_PT, height: size.h * MM_TO_PT });
  }
  return pdf.save();
}

/** Rasterise the pages into an A4 PDF. Server-only (resvg + pdf-lib). */
export async function renderBoqPdf(input: BoqPdfInput & { revision?: number | null; qsValidated?: Record<string, boolean> }): Promise<{ pdf: Uint8Array; pages: string[] }> {
  const pages = buildBoqPdfPages(input);
  return { pdf: await rasteriseA4Pages(pages, `${input.projectName} — Bill of Quantities`, { w: BOQ_LAND_W, h: BOQ_LAND_H }), pages };
}
