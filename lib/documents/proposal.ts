// =============================================================================
// lib/documents/proposal.ts — the firm's client-facing proposal, as pages (L4).
//
// The firm is the brand. A cover with the firm's logo and display name, a scope
// summary, the BoQ at the firm's resolved rates with its overheads & profit as
// its own row, a terms block (the firm's words) and the indicative programme.
// RenovAIte is a discreet "prepared with" mark in the footer, nothing more.
//
// What a client-facing proposal does NOT print: rate sources, resolution tiers,
// QS status marks, the reference label, a contractor identity. What it DOES
// keep from the BoQ's honesty: the derived-quantity flag and note, the derived
// total convention (≈ … *), the D4 "excludes N lines to be priced" headline, and
// the DRAFT statement on every page while boundary-critical dimensions remain
// derived — a client sees a draft as a draft.
//
// Pure (A4 SVG pages on the BoQ PDF's primitives); the rasteriser is in
// proposal-pdf.ts.
// =============================================================================

import { assignRefs } from "@/lib/boq/refs";
import { sortSections } from "@/lib/boq/section-order";
import { esc } from "@/lib/drawings/sheet";
import { formatAed } from "@/lib/format/aed";
import { OHP_LINE_LABEL } from "@/lib/rates/ohp";

import { boqDerivedInfo, derivedLineNote, derivedTotal } from "./boq-derived";
import { A4_PDF, BOQ_PAGE_H, BOQ_PAGE_W, a4Num as f1, a4Page as page, a4Text as t, a4Wrap as wrap, type BoqPdfInput } from "./boq-pdf";
import { PREPARED_WITH_MARK } from "./reference-basis-types";

const { M, INK_900, INK_700, INK_500, INK_100, BRASS, TERRACOTTA, FONT_MONO, FONT_DISPLAY, K } = A4_PDF;

export interface ProposalScopeRoom {
  name: string;
  kind: string;
  area_m2: number | null;
}

export interface ProposalInput {
  /** What the client sees as the sender. */
  brand: string;
  /** A data URI (PNG/JPG) or null. */
  logoDataUri: string | null;
  termsText: string | null;
  projectName: string;
  community: string;
  dateISO: string;
  rooms: ProposalScopeRoom[];
  boq: BoqPdfInput["boq"];
  // --- K4 setup (053). All optional: absent = the L4 document, unchanged. ---------
  /** Who the cover names as the client. Printed on the cover only. */
  clientLabel?: string | null;
  /** "Valid for 30 days from issue — until …" (proposal-setup validityText). */
  validity?: string | null;
  /** The proposal's payment terms (the firm's words). */
  paymentTerms?: string | null;
  /** A short letter from the firm, opening the scope page. */
  coverNote?: string | null;
  /**
   * Line rates and line totals in the priced schedule. Absent = shown (L4).
   * The K4 setup defaults it OFF: the client sees quantities and section
   * totals, and the firm's book stays private.
   */
  showLineRates?: boolean;
  /** "PREVIEW · NOT ISSUED" across every page — the in-app preview, never a release. */
  preview?: boolean;
}

/** The preview's mark: it is on every page, so a preview can never pass for the proposal. */
export const PREVIEW_MARK = "PREVIEW · NOT ISSUED";

// H7: the proposal's BoQ to the fils, like the firm's own BoQ PDF.
const aed = (n: number) => formatAed(n, "money");

/**
 * A BoQ description may carry a provenance aside for the firm's eyes —
 * "(no reference rate — QS to price)", "(absorbed at no charge in the reference
 * project — QS to confirm)". A client reads the work, not where its rate came
 * from: such parentheticals are dropped here. Everything else is printed as is.
 */
export function clientDescription(description: string): string {
  return description
    .replace(/\s*\((?=[^)]*(?:reference|QS|indicative|allowance|absorbed|market))[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type Row =
  | { kind: "section"; title: string }
  | { kind: "line"; line: BoqPdfInput["boq"]["sections"][number]["lines"][number]; desc: string[]; sub: string[]; ref: string }
  | { kind: "section_total"; title: string; total: number };

export function buildProposalPages(input: ProposalInput): string[] {
  const { boq, brand } = input;
  const info = boqDerivedInfo(boq);
  const total = derivedTotal(boq.grand_total_aed, info);
  const statement = info.draft ? info.statement : null;
  const refs = assignRefs(boq.sections);
  const pages: string[] = [];
  let n = 0;
  const showRates = input.showLineRates !== false;
  const previewMark = input.preview
    ? `<text x="${f1(BOQ_PAGE_W / 2)}" y="${f1(BOQ_PAGE_H / 2)}" text-anchor="middle" transform="rotate(-35 ${f1(BOQ_PAGE_W / 2)} ${f1(BOQ_PAGE_H / 2)})" font-family="${FONT_MONO}" font-size="11" letter-spacing="1.2" fill="${INK_500}" fill-opacity="0.28" data-preview="true">${esc(PREVIEW_MARK)}</text>`
    : "";
  const push = (body: string) => pages.push(page(body + previewMark));

  // --- chrome: every page but the cover -------------------------------------------
  const header = () => {
    n += 1;
    let s = t(M, 14, brand, { size: 4.2, fill: INK_900, font: FONT_DISPLAY }).replace("<text ", '<text data-firm-brand="header" ');
    s += t(BOQ_PAGE_W - M, 14, `${input.projectName} · Proposal`, { size: 2.6, fill: INK_500, anchor: "end" });
    let y = 18;
    if (statement) {
      s += `<rect x="${M}" y="${y}" width="${BOQ_PAGE_W - 2 * M}" height="9" fill="#FDF3EE" stroke="${TERRACOTTA}" stroke-width="0.45" data-boq-draft="true"/>`;
      s += t(M + 3, y + 5.8, statement, { size: 2.7, fill: TERRACOTTA, weight: 700 });
      y += 11;
    } else {
      s += `<line x1="${M}" y1="${y}" x2="${BOQ_PAGE_W - M}" y2="${y}" stroke="${INK_100}" stroke-width="0.3"/>`;
      y += 3;
    }
    s += footer();
    return { svg: s, y };
  };
  const footer = () =>
    t(BOQ_PAGE_W - M, BOQ_PAGE_H - 8, `${n}`, { size: 2.4, fill: INK_500, font: FONT_MONO, anchor: "end" }) +
    t(M, BOQ_PAGE_H - 8, `${PREPARED_WITH_MARK} · AED · dated ${input.dateISO}`, { size: 2.2, fill: INK_500 }).replace("<text ", '<text data-prepared-with="true" ');

  // --- cover -------------------------------------------------------------------------
  n += 1;
  let svg = "";
  let y = 30;
  if (input.logoDataUri) {
    svg += `<image x="${M}" y="${y - 8}" width="44" height="22" preserveAspectRatio="xMinYMin meet" href="${input.logoDataUri}" data-logo="present"/>`;
    y += 20;
  }
  svg += t(M, y, brand, { size: 7.5, fill: INK_900, font: FONT_DISPLAY }).replace("<text ", `<text data-firm-brand="cover" data-logo="${input.logoDataUri ? "present" : "none"}" data-proposal-cover="true" `);
  y += 8;
  svg += `<line x1="${M}" y1="${y}" x2="${M + 40}" y2="${y}" stroke="${BRASS}" stroke-width="0.6"/>`;
  y = 110;
  svg += t(M, y, "Proposal", { size: 13, fill: INK_900, font: FONT_DISPLAY });
  y += 12;
  svg += t(M, y, input.projectName, { size: 5.2, fill: INK_700 });
  y += 7;
  svg += t(M, y, input.community, { size: 3.2, fill: INK_500 });
  if (input.clientLabel) {
    y += 7;
    svg += t(M, y, `Prepared for ${input.clientLabel}`, { size: 3.2, fill: INK_700 }).replace("<text ", '<text data-client="true" ');
  }
  y += 16;
  svg += t(M, y, "Proposed contract sum", { size: 2.4, fill: INK_500, spacing: "0.06em" });
  y += 8;
  svg += t(M, y, total.text, { size: 8.5, font: FONT_MONO, fill: INK_900 }).replace("<text ", `<text data-grand-total="${boq.grand_total_aed}" `);
  y += 6;
  svg += t(M, y, "incl. overheads & profit, contingency and VAT", { size: 2.4, fill: INK_500 });
  if (input.validity) {
    y += 5;
    svg += t(M, y, input.validity, { size: 2.6, fill: INK_700 }).replace("<text ", '<text data-validity="true" ');
  }
  if (total.excludes) {
    y += 5;
    svg += t(M, y, total.excludes, { size: 2.6, fill: TERRACOTTA, weight: 700 }).replace("<text ", '<text data-headline-excludes="true" ');
  }
  if (total.footnote) {
    y += 6;
    for (const line of wrap(total.footnote, 88)) {
      svg += t(M, y, line, { size: 2.4, fill: TERRACOTTA });
      y += 3.2 * K;
    }
  }
  if (statement) {
    const sy = BOQ_PAGE_H - 44;
    svg += `<rect x="${M}" y="${sy}" width="${BOQ_PAGE_W - 2 * M}" height="11" fill="#FDF3EE" stroke="${TERRACOTTA}" stroke-width="0.45" data-boq-draft="true" data-draft-cover="true"/>`;
    svg += t(M + 3, sy + 7, statement, { size: 2.9, fill: TERRACOTTA, weight: 700 });
  }
  svg += t(M, BOQ_PAGE_H - 24, `Prepared by ${brand} · ${input.dateISO}`, { size: 2.8, fill: INK_700 });
  svg += footer();
  push(svg);

  // --- scope summary + BoQ ---------------------------------------------------------------
  ({ svg, y } = header());
  const bottom = BOQ_PAGE_H - 30;
  const flush = () => {
    push(svg);
    ({ svg, y } = header());
    y += 4;
  };
  y += 6;
  if (input.coverNote && input.coverNote.trim()) {
    for (const para of input.coverNote.split(/\r?\n/)) {
      if (!para.trim()) {
        y += 2.5;
        continue;
      }
      for (const line of wrap(para, 96)) {
        if (y + 4 > bottom) flush();
        svg += t(M, y, line, { size: 2.7, fill: INK_900 }).replace("<text ", '<text data-cover-note="true" ');
        y += 3.4 * K;
      }
      y += 1.5;
    }
    y += 6;
  }
  svg += t(M, y, "SCOPE OF WORKS", { size: 2.7, fill: BRASS, weight: 700, spacing: "0.05em" });
  y += 6;
  const scopeLines: string[] = [];
  if (input.rooms.length) {
    scopeLines.push(`${input.rooms.length} area${input.rooms.length === 1 ? "" : "s"}: ${input.rooms.map((r) => `${r.name}${r.area_m2 != null ? ` (${Math.round(r.area_m2 * 10) / 10} m²)` : ""}`).join(", ")}.`);
  }
  scopeLines.push(`${boq.sections.length} work sections, ${boq.sections.reduce((k, s) => k + s.lines.length, 0)} priced items: ${sortSections(boq.sections).map((s) => `${s.work_section} (${aed(s.section_total_aed)})`).join(" · ")}.`);
  const g = boq.garden;
  if (g?.kept?.length) scopeLines.push(`Existing on site, kept and excluded from the works: ${g.kept.map((k) => k.name).join(", ")}.`);
  if (g?.removals?.length) scopeLines.push(`Existing on site, taken out: ${g.removals.map((r) => `${r.name} (${r.disposition})`).join(", ")}.`);
  for (const para of scopeLines) {
    for (const line of wrap(para, 96)) {
      if (y + 4 > bottom) flush();
      svg += t(M, y, line, { size: 2.5, fill: INK_700 }).replace("<text ", '<text data-scope="true" ');
      y += 3.2 * K;
    }
    y += 1.5;
  }
  y += 4;

  // The BoQ at the firm's rates: REF, description, qty, unit, rate, total — no
  // source, no tier, no QS mark. Derived quantities keep their flag and note.
  const rows: Row[] = [];
  for (const s of sortSections(boq.sections)) {
    rows.push({ kind: "section", title: s.work_section });
    s.lines.forEach((l, idx) => {
      const note = derivedLineNote(l);
      rows.push({ kind: "line", line: l, desc: wrap(clientDescription(l.description), 46).slice(0, 4), sub: note ? wrap(note, 70) : [], ref: refs[`${s.work_section}-${idx}`]! });
    });
    rows.push({ kind: "section_total", title: s.work_section, total: s.section_total_aed });
  }
  const DESC_H = 3.4 * K;
  const SUB_H = 3 * K;
  const rowH = (r: Row) => (r.kind === "section" ? 9 : r.kind === "section_total" ? 8 : DESC_H * r.desc.length + SUB_H * r.sub.length + 2.6);
  const colHead = (yy: number) =>
    t(M + 4, yy, "REF", { size: 2.1, fill: INK_500, spacing: "0.06em" }) +
    t(M + 18, yy, "DESCRIPTION", { size: 2.1, fill: INK_500, spacing: "0.06em" }) +
    t(128, yy, "QTY", { size: 2.1, fill: INK_500, anchor: "end" }) +
    t(131, yy, "UNIT", { size: 2.1, fill: INK_500 }) +
    (showRates ? t(162, yy, "RATE", { size: 2.1, fill: INK_500, anchor: "end" }) + t(BOQ_PAGE_W - M, yy, "TOTAL", { size: 2.1, fill: INK_500, anchor: "end" }) : "") +
    `<line x1="${M}" y1="${f1(yy + 1.6)}" x2="${BOQ_PAGE_W - M}" y2="${f1(yy + 1.6)}" stroke="${INK_100}" stroke-width="0.3"/>`;
  if (y + 30 > bottom) flush();
  svg += t(M, y, showRates ? "PRICED SCHEDULE OF WORKS" : "SCHEDULE OF WORKS · PRICED BY SECTION", { size: 2.7, fill: BRASS, weight: 700, spacing: "0.05em" });
  y += 6;
  svg += colHead(y);
  y += 6;
  const flushTable = () => {
    flush();
    svg += colHead(y + 2);
    y += 8;
  };
  for (const r of rows) {
    if (y + rowH(r) > bottom) flushTable();
    if (r.kind === "section") {
      svg += t(M, y + 4, r.title.toUpperCase(), { size: 2.6, fill: INK_900, weight: 700, spacing: "0.05em" });
      y += 8;
    } else if (r.kind === "section_total") {
      svg += `<line x1="120" y1="${f1(y)}" x2="${BOQ_PAGE_W - M}" y2="${f1(y)}" stroke="${INK_100}" stroke-width="0.3"/>`;
      svg += t(162, y + 4, `${r.title} total`, { size: 2.4, fill: INK_500, anchor: "end" });
      svg += t(BOQ_PAGE_W - M, y + 4, aed(r.total), { size: 2.6, font: FONT_MONO, anchor: "end", weight: 700 });
      y += 7;
    } else {
      const l = r.line;
      svg += t(M + 4, y + 2.6, r.ref, { size: 2.2, fill: INK_500, font: FONT_MONO }).replace("<text ", `<text data-ref="${esc(r.ref)}" `);
      r.desc.forEach((d, i) => {
        svg += t(M + 18, y + 2.6 + i * DESC_H, d, { size: 2.55 });
      });
      svg += t(128, y + 2.6, `${l.qty_derived ? "≈ " : ""}${l.quantity}`, { size: 2.55, font: FONT_MONO, anchor: "end", fill: l.qty_derived ? TERRACOTTA : INK_900 });
      svg += t(131, y + 2.6, l.unit, { size: 2.4, fill: INK_700 });
      // K4: with line rates off the client reads the work and its quantity; the money is per section.
      if (showRates) {
        svg += t(162, y + 2.6, aed(l.rate_aed), { size: 2.55, font: FONT_MONO, anchor: "end" });
        svg += t(BOQ_PAGE_W - M, y + 2.6, aed(l.total_aed), { size: 2.55, font: FONT_MONO, anchor: "end" });
      }
      let sy = y + 2.6 + r.desc.length * DESC_H;
      for (const s of r.sub) {
        svg += t(M + 18, sy - 0.4, s, { size: 2.1, fill: TERRACOTTA });
        sy += SUB_H;
      }
      y += rowH(r);
    }
  }

  // Summary: subtotal → OH&P (the firm's, as its own row) → contingency → VAT → total.
  if (y + 46 > bottom) flush();
  y += 4;
  const sumRow = (label: string, value: string, attr: string, bold = false) => {
    svg += t(162, y, label, { size: 2.7, fill: bold ? INK_900 : INK_700, anchor: "end", weight: bold ? 700 : undefined });
    svg += t(BOQ_PAGE_W - M, y, value, { size: bold ? 3.4 : 2.7, font: FONT_MONO, anchor: "end", weight: bold ? 700 : undefined }).replace("<text ", `<text ${attr} `);
    y += bold ? 7 : 5;
  };
  svg += `<line x1="110" y1="${f1(y - 3)}" x2="${BOQ_PAGE_W - M}" y2="${f1(y - 3)}" stroke="${INK_900}" stroke-width="0.35"/>`;
  sumRow("Subtotal", aed(boq.subtotal_aed), 'data-summary="subtotal"');
  if (boq.ohp_aed && boq.ohp_aed > 0) sumRow(`${OHP_LINE_LABEL} ${boq.ohp_pct}%`, aed(boq.ohp_aed), `data-ohp="${boq.ohp_aed}"`);
  sumRow(`Contingency ${boq.contingency_pct}%`, aed(boq.contingency_aed), 'data-summary="contingency"');
  sumRow(`VAT ${boq.vat_pct}%`, aed(boq.vat_aed), 'data-summary="vat"');
  sumRow("Proposed contract sum", total.text, `data-grand-total="${boq.grand_total_aed}"`, true);
  if (total.excludes) {
    svg += t(BOQ_PAGE_W - M, y, total.excludes, { size: 2.4, fill: TERRACOTTA, anchor: "end", weight: 700 }).replace("<text ", '<text data-headline-excludes="true" ');
    y += 5;
  }

  // K4: what the sum leaves out, named (D4), and what it rests on — a client
  // reads both before the terms. Absent when there is nothing to say.
  const block = (title: string, paras: string[], attr: string) => {
    if (paras.length === 0) return;
    if (y + 16 > bottom) flush();
    y += 6;
    svg += t(M, y, title, { size: 2.7, fill: BRASS, weight: 700, spacing: "0.05em" });
    y += 6;
    for (const para of paras) {
      for (const line of wrap(para, 96)) {
        if (y + 4 > bottom) flush();
        svg += t(M, y, line, { size: 2.6, fill: INK_700 }).replace("<text ", `<text ${attr} `);
        y += 3.2 * K;
      }
      y += 1.2;
    }
  };
  if (input.showLineRates !== undefined) {
    block("EXCLUSIONS & TO BE PRICED", total.excluded.map((x) => `${x.work_section} — ${clientDescription(x.description)}: not in the sum above; priced when confirmed.`), 'data-excluded="true"');
    const assumptions: string[] = [];
    if (statement) assumptions.push(statement);
    if (info.derivedLines > 0) assumptions.push(`${info.derivedLines} quantit${info.derivedLines === 1 ? "y is" : "ies are"} derived from the plan (marked ≈) and firm after site verification.`);
    block("ASSUMPTIONS", assumptions, 'data-assumption="true"');
  }
  push(svg);

  // --- terms (validity, payment terms, the firm's words) ---------------------------------------
  const hasTerms = !!(input.termsText && input.termsText.trim());
  if (hasTerms || input.validity || input.paymentTerms) {
    ({ svg, y } = header());
    y += 6;
    svg += t(M, y, "TERMS", { size: 2.7, fill: BRASS, weight: 700, spacing: "0.05em" });
    y += 6;
    if (input.validity) {
      svg += t(M, y, input.validity, { size: 2.6, fill: INK_900 }).replace("<text ", '<text data-validity="true" ');
      y += 3.4 * K + 2;
    }
    if (input.paymentTerms) {
      svg += t(M, y, "Payment terms", { size: 2.6, fill: INK_900, weight: 700 });
      y += 3.4 * K;
      for (const line of wrap(input.paymentTerms, 96)) {
        svg += t(M, y, line, { size: 2.6, fill: INK_700 }).replace("<text ", '<text data-payment-terms="true" ');
        y += 3.2 * K;
      }
      y += 3;
    }
    for (const para of hasTerms ? input.termsText!.split(/\r?\n/) : []) {
      if (!para.trim()) {
        y += 2.5;
        continue;
      }
      for (const line of wrap(para, 96)) {
        if (y + 4 > bottom) {
          push(svg);
          ({ svg, y } = header());
          y += 6;
        }
        svg += t(M, y, line, { size: 2.5, fill: INK_700 }).replace("<text ", '<text data-terms="true" ');
        y += 3.2 * K;
      }
      y += 1.5;
    }
    push(svg);
  }

  // --- programme (indicative) -----------------------------------------------------------------
  const prog = boq.programme;
  if (prog && prog.phases.length) {
    ({ svg, y } = header());
    y += 6;
    svg += t(M, y, "INDICATIVE PROGRAMME", { size: 2.7, fill: BRASS, weight: 700, spacing: "0.05em" });
    y += 5;
    svg += t(M, y, `${prog.total_days} days, indicative — the phases are sized by the value of their work; dates are agreed at contract.`, { size: 2.3, fill: INK_700 });
    y += 7;
    const barX = 70;
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
    push(svg);
  }

  return pages;
}
