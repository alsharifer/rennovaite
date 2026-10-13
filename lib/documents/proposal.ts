// =============================================================================
// lib/documents/proposal.ts — the firm's client-facing proposal, as pages (L4;
// K4 setup; K8 #15 Blueprint paper — Figma 67:1396 cover, 67:1436 price
// summary, spec §6.9).
//
// The firm is the brand. A cover with the firm's logo slot or display name, the
// project, who it is for, the date, validity and the BoQ revision it is based
// on, and what is inside; then numbered sections — scope of works (the cover
// note, the scope, the schedule), price summary (section totals → subtotal →
// the firm's OH&P as its own row → contingency → VAT → total, to the fil),
// exclusions & assumptions, programme, terms (the firm's words). RenovAIte is
// a discreet "Prepared with" mark in the footer, nothing more.
//
// What a client-facing proposal does NOT print: provenance marks, rate
// sources, resolution tiers, QS status, the reference label, a contractor or
// supplier identity — and no line rates unless the firm ticked "show line
// rates". What it DOES keep from the BoQ's honesty: the derived-quantity flag
// and note (≈), the derived total convention (≈ … *), the D4 lines still to be
// priced, named, and the DRAFT statement on every page while boundary-critical
// dimensions remain derived — a client sees a draft as a draft.
//
// Pure (A4 SVG pages, lib/documents/doc-style); the rasteriser is in
// proposal-pdf.ts. Always light.
// =============================================================================

import { assignRefs } from "@/lib/boq/refs";
import { sortSections } from "@/lib/boq/section-order";
import { esc } from "@/lib/drawings/sheet";
import { formatAed } from "@/lib/format/aed";
import { OHP_LINE_LABEL } from "@/lib/rates/ohp";

import { boqDerivedInfo, derivedLineNote, derivedTotal } from "./boq-derived";
import { BOQ_PAGE_H as H, BOQ_PAGE_W as W, type BoqPdfInput } from "./boq-pdf";
import { DOC, PAGE_COUNT_TOKEN, docPage, hline, inverseBand, label, longDate, n1, text, wrapWords } from "./doc-style";
import { PREPARED_WITH_MARK } from "./reference-basis-types";
import { summaryChainOf } from "@/lib/boq/totals";

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
  /** K8: "Based on — Bill of quantities, revision N". Absent = not printed. */
  revision?: number | null;
  /**
   * K9: the firm's reference for this proposal, "MFO-P-0001" (054) — cover top
   * right, a cover fact, and every page header. Null on a preview before the
   * first issue (the cover says it is assigned on issue).
   */
  reference?: string | null;
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

// H7: the proposal's figures to the fils, like the firm's own BoQ PDF.
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

const M = 19; // the frame's 72 px margin on a 794 px A4
const R = W - M;
const BOTTOM = H - 26;

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
  const showRates = input.showLineRates !== false;
  const setup = input.showLineRates !== undefined;
  const sections = sortSections(boq.sections);
  const prog = boq.programme && boq.programme.phases.length ? boq.programme : null;
  const hasTerms = !!(input.termsText && input.termsText.trim()) || !!input.validity || !!input.paymentTerms;

  // The numbered sections, as the cover lists them — only those this proposal has.
  const exclusions = setup ? total.excluded.map((x) => `${clientDescription(x.description)} (${x.work_section})`) : [];
  const assumptions: string[] = [];
  if (setup && statement) assumptions.push(statement);
  if (setup && info.derivedLines > 0) assumptions.push(`${info.derivedLines} quantit${info.derivedLines === 1 ? "y is" : "ies are"} derived from the plan (marked ≈) and firm after site verification.`);
  const toc: { key: string; title: string }[] = [
    { key: "scope", title: "Scope of works" },
    { key: "price", title: "Price summary" },
    ...(exclusions.length || assumptions.length ? [{ key: "exclusions", title: "Exclusions & assumptions" }] : []),
    ...(prog ? [{ key: "programme", title: "Programme" }] : []),
    ...(hasTerms ? [{ key: "terms", title: "Terms" }] : []),
  ];
  const num = (key: string) => toc.findIndex((s) => s.key === key) + 1;

  const pages: string[] = [];
  const previewMark = input.preview
    ? `<text x="${n1(W / 2)}" y="${n1(H / 2)}" text-anchor="middle" transform="rotate(-35 ${n1(W / 2)} ${n1(H / 2)})" font-size="11" fill="${DOC.INK_3}" fill-opacity="0.28" style="font-family:${DOC.MONO};letter-spacing:0.1em" data-preview="true">${esc(PREVIEW_MARK)}</text>`
    : "";
  const push = (body: string) => pages.push(docPage(W, H, body + previewMark));
  const draftBand = (y: number, extra = "") => (statement ? inverseBand(M, y, R - M, wrapWords(statement, 92), `data-boq-draft="true"${extra}`) : null);

  // Every page's footer: the firm, and the discreet mark.
  const footer = () =>
    hline(M, R, H - 17, DOC.STRONG, 0.35) +
    text(M, H - 11, `${brand}${input.community ? ` · ${input.community}` : ""}`, { size: 2.6, fill: DOC.INK_2, font: DOC.MONO }) +
    text(R, H - 11, PREPARED_WITH_MARK, { size: 2.4, fill: DOC.INK_3, font: DOC.MONO, anchor: "end", attrs: 'data-prepared-with="true"' });

  // --- cover (67:1396) ------------------------------------------------------------------
  let svg = "";
  let y = 26;
  if (input.logoDataUri) {
    svg += `<image x="${M}" y="${y - 8}" width="44" height="14" preserveAspectRatio="xMinYMin meet" href="${input.logoDataUri}" data-logo="present"/>`;
    y += 12;
  }
  svg += text(M, y, brand, { size: 5.8, weight: 500, attrs: `data-firm-brand="cover" data-logo="${input.logoDataUri ? "present" : "none"}" data-proposal-cover="true"` });
  if (input.reference) svg += text(R, 24, input.reference, { size: 3.4, weight: 500, font: DOC.MONO, anchor: "end", attrs: 'data-proposal-ref="cover"' });
  else if (input.preview) svg += text(R, 24, "Reference assigned on issue", { size: 2.6, fill: DOC.INK_3, font: DOC.MONO, anchor: "end", attrs: 'data-proposal-ref="pending"' });
  if (input.revision) svg += text(R, 29.5, `BoQ rev ${input.revision}`, { size: 2.6, fill: DOC.INK_3, font: DOC.MONO, anchor: "end" });
  y = 74;
  svg += label(M, y, "Proposal");
  y += 15;
  for (const line of wrapWords(input.projectName, 30).slice(0, 3)) {
    svg += text(M, y, line, { size: 10.6, font: DOC.SERIF });
    y += 13;
  }
  y += 4;
  const facts: [string, string, string?][] = [
    ...(input.reference ? ([["Reference", input.reference, 'data-proposal-ref="fact"']] as [string, string, string][]) : []),
    ...(input.clientLabel ? ([["Prepared for", input.clientLabel, 'data-client="true"']] as [string, string, string][]) : []),
    ["Date", longDate(input.dateISO)],
    ...(input.community ? ([["Location", input.community]] as [string, string][]) : []),
    ...(input.validity ? ([["Validity", input.validity, 'data-validity="true"']] as [string, string, string][]) : []),
    ...(input.revision ? ([["Based on", `Bill of quantities, revision ${input.revision}`]] as [string, string][]) : []),
  ];
  for (const [k, v, attrs] of facts) {
    svg += text(M, y, k, { size: 2.9, fill: DOC.INK_2 });
    const lines = wrapWords(v, 46);
    lines.forEach((l, i) => (svg += text(M + 37, y + i * 4.2, l, { size: 2.9, attrs })));
    y += 4 + (lines.length - 1) * 4.2;
    svg += hline(M, M + 111, y);
    y += 6.3;
  }
  const band = draftBand(Math.max(y + 6, 196), ' data-draft-cover="true"');
  if (band) svg += band.svg;
  let ty = H - 54;
  svg += label(M, ty, "What’s inside");
  ty += 6;
  toc.forEach((s, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    svg += text(M + col * 56.6, ty + row * 6.3, `${i + 1}  ${s.title}`, { size: 2.9 });
  });
  svg += footer();
  push(svg);

  // --- the numbered sections ------------------------------------------------------------
  const header = () => {
    let s = text(M, 16, `${brand} · ${input.projectName}`, { size: 2.6, fill: DOC.INK_2, font: DOC.MONO, attrs: 'data-firm-brand="header"' });
    s += text(R, 16, `${input.reference ? `${input.reference} · ` : ""}page ${pages.length + 1} of ${PAGE_COUNT_TOKEN}`, { size: 2.6, fill: DOC.INK_2, font: DOC.MONO, anchor: "end", attrs: input.reference ? 'data-proposal-ref="header"' : undefined });
    s += hline(M, R, 20);
    let yy = 28;
    const b = draftBand(24);
    if (b) {
      s += b.svg;
      yy = 24 + b.h + 6;
    }
    return { svg: s + footer(), y: yy };
  };
  const flush = () => {
    push(svg);
    ({ svg, y } = header());
  };
  const sectionHead = (key: string, title: string) => {
    if (y + 26 > BOTTOM) flush();
    svg += text(M, y + 4, String(num(key)), { size: 4.4, fill: DOC.INK_2, weight: 300 });
    svg += text(M, y + 12.5, title, { size: 5.8, weight: 500 });
    y += 21;
  };
  const para = (s: string, o: { size?: number; fill?: string; attrs?: string; max?: number } = {}) => {
    for (const line of wrapWords(s, o.max ?? 92)) {
      if (y + 5 > BOTTOM) flush();
      svg += text(M, y, line, { size: o.size ?? 3.1, fill: o.fill ?? DOC.INK_2, attrs: o.attrs });
      y += 5.2;
    }
    y += 1.6;
  };

  // 1 Scope of works -----------------------------------------------------------------------
  ({ svg, y } = header());
  sectionHead("scope", "Scope of works");
  if (input.coverNote && input.coverNote.trim()) {
    for (const p of input.coverNote.split(/\r?\n/)) {
      if (!p.trim()) {
        y += 2;
        continue;
      }
      para(p, { fill: DOC.INK, attrs: 'data-cover-note="true"' });
    }
    y += 3;
  }
  if (input.rooms.length) para(`${input.rooms.length} area${input.rooms.length === 1 ? "" : "s"}: ${input.rooms.map((r) => `${r.name}${r.area_m2 != null ? ` (${Math.round(r.area_m2 * 10) / 10} m²)` : ""}`).join(", ")}.`, { attrs: 'data-scope="true"' });
  para(`${sections.length} work sections, ${sections.reduce((k, s) => k + s.lines.length, 0)} items: ${sections.map((s) => s.work_section).join(" · ")}.`, { attrs: 'data-scope="true"' });
  const g = boq.garden;
  if (g?.kept?.length) para(`Existing on site, kept and excluded from the works: ${g.kept.map((k) => k.name).join(", ")}.`, { attrs: 'data-scope="true"' });
  if (g?.removals?.length) para(`Existing on site, taken out: ${g.removals.map((r) => `${r.name} (${r.disposition})`).join(", ")}.`, { attrs: 'data-scope="true"' });
  y += 3;

  // The schedule: REF, description, qty, unit — and the rate and amount only
  // when the firm chose to show them. Derived quantities keep their ≈ and note.
  const rows: Row[] = [];
  for (const s of sections) {
    rows.push({ kind: "section", title: s.work_section });
    s.lines.forEach((l, idx) => {
      const note = derivedLineNote(l);
      rows.push({ kind: "line", line: l, desc: wrapWords(clientDescription(l.description), showRates ? 52 : 68).slice(0, 4), sub: note ? wrapWords(note, 70) : [], ref: refs[`${s.work_section}-${idx}`]! });
    });
    rows.push({ kind: "section_total", title: s.work_section, total: s.section_total_aed });
  }
  const QX = showRates ? 133 : R - 16; // quantity column (right edge)
  const UX = QX + 2;
  const rowH = (r: Row) => (r.kind === "section" ? 9 : r.kind === "section_total" ? 8 : 4.4 * r.desc.length + 3.8 * r.sub.length + 3.2);
  const colHead = () => {
    let s = `<rect x="${M}" y="${n1(y - 4.6)}" width="${R - M}" height="7" fill="${DOC.HAIR}" fill-opacity="0.45"/>`;
    s += label(M + 2, y, "Ref") + label(M + 18, y, "Description") + label(QX, y, "Qty", { anchor: "end" }) + label(UX, y, "Unit");
    if (showRates) s += label(165, y, "Rate", { anchor: "end" }) + label(R - 2, y, "Amount", { anchor: "end" });
    svg += s;
    y += 7;
  };
  if (y + 30 > BOTTOM) flush();
  svg += label(M, y, showRates ? "Schedule of works" : "Schedule of works · priced by section", { fill: DOC.INK_2 });
  y += 7;
  colHead();
  for (const r of rows) {
    // A section heading keeps its first line with it (no orphan at the foot of a page).
    if (y + rowH(r) + (r.kind === "section" ? 12 : 0) > BOTTOM) {
      flush();
      colHead();
    }
    if (r.kind === "section") {
      svg += label(M + 2, y + 4.5, r.title, { fill: DOC.INK });
      y += 9;
    } else if (r.kind === "section_total") {
      svg += hline(M + 18, R, y);
      svg += text(showRates ? 165 : QX, y + 4.6, `${r.title} total`, { size: 2.8, fill: DOC.INK_2, anchor: "end" });
      svg += text(R - 2, y + 4.6, aed(r.total), { size: 2.9, font: DOC.MONO, anchor: "end", weight: 500 });
      y += 8;
    } else {
      const l = r.line;
      svg += text(M + 2, y + 3, r.ref, { size: 2.6, fill: DOC.INK_3, font: DOC.MONO, attrs: `data-ref="${esc(r.ref)}"` });
      r.desc.forEach((d, i) => (svg += text(M + 18, y + 3 + i * 4.4, d, { size: 2.9 })));
      svg += text(QX, y + 3, `${l.qty_derived ? "≈ " : ""}${l.quantity}`, { size: 2.9, font: DOC.MONO, anchor: "end" });
      svg += text(UX, y + 3, l.unit, { size: 2.7, fill: DOC.INK_2 });
      if (showRates) {
        svg += text(165, y + 3, aed(l.rate_aed), { size: 2.9, font: DOC.MONO, anchor: "end" });
        svg += text(R - 2, y + 3, aed(l.total_aed), { size: 2.9, font: DOC.MONO, anchor: "end" });
      }
      let sy = y + 3 + r.desc.length * 4.4;
      for (const s of r.sub) {
        svg += text(M + 18, sy - 0.4, s, { size: 2.6, fill: DOC.INK_3 });
        sy += 3.8;
      }
      y += rowH(r);
    }
  }
  push(svg);

  // 2 Price summary (67:1436) ----------------------------------------------------------------
  ({ svg, y } = header());
  sectionHead("price", "Price summary");
  para(`Section totals for the scope in section ${num("scope")}. Quantities are measured from your drawings; rates are ${brand}’s.${showRates ? "" : " Line rates are not shown in this proposal."}`);
  y += 3;
  svg += label(M, y, "Section") + label(R, y, "AED", { anchor: "end" });
  y += 2.4;
  svg += hline(M, R, y, DOC.STRONG, 0.5);
  const sumRow = (k: string, v: string, attrs: string, bold = false) => {
    if (y + 10 > BOTTOM) flush();
    svg += text(M, y + 6.4, k, { size: 3.1, weight: bold ? 600 : undefined, fill: DOC.INK });
    svg += text(R, y + 6.4, v, { size: 3.1, font: DOC.MONO, anchor: "end", attrs });
    y += 10.3;
    svg += hline(M, R, y);
  };
  for (const s of sections) sumRow(s.work_section, aed(s.section_total_aed), `data-section-total="${esc(s.work_section)}"`);
  // K10: the same chain reader as the BoQ page (summaryChainOf) — one revision, one set of figures.
  const chain = summaryChainOf(boq);
  sumRow("Subtotal", aed(chain.subtotal), `data-summary="subtotal" data-value="${chain.subtotal}"`, true);
  if (chain.ohp > 0) sumRow(`${OHP_LINE_LABEL} ${chain.ohpPct}%`, aed(chain.ohp), `data-ohp="${chain.ohp}"`);
  sumRow(`Contingency (${chain.contingencyPct}%)`, aed(chain.contingency), `data-summary="contingency" data-value="${chain.contingency}"`);
  sumRow(`VAT (${chain.vatPct}%)`, aed(chain.vat), `data-summary="vat" data-value="${chain.vat}"`);
  svg += hline(M, R, y, DOC.STRONG, 0.5);
  if (y + 14 > BOTTOM) flush();
  svg += text(M, y + 7.6, "Total", { size: 3.1, weight: 600 });
  // To the fil, so the column adds up (spec §6.9); a draft keeps its ≈ and *.
  const exact = `${total.derived ? "≈ " : ""}AED ${aed(chain.grand)}${total.derived ? "*" : ""}`;
  svg += text(R, y + 8.6, exact, { size: 5.8, font: DOC.MONO, anchor: "end", attrs: `data-grand-total="${chain.grand}"` });
  y += 13;
  svg += hline(M, R, y, DOC.STRONG, 0.5);
  y += 9;
  if (total.excludes) {
    const named = total.excluded.map((x) => clientDescription(x.description)).join("; ");
    para(`The total ${total.excludes}${named ? `: ${named}` : ""} — priced separately on request.${num("exclusions") ? ` See section ${num("exclusions")}.` : ""}`, { attrs: 'data-headline-excludes="true"' });
  }
  if (total.footnote) para(total.footnote, { size: 2.8 });
  y += 2;
  for (const line of wrapWords(`All amounts in UAE dirhams.${input.validity ? ` ${input.validity}.` : ""}`, 92)) {
    svg += text(M, y, line, { size: 2.7, fill: DOC.INK_2, font: DOC.MONO });
    y += 4.6;
  }
  push(svg);

  // 3 Exclusions & assumptions (K4) ------------------------------------------------------------
  if (num("exclusions")) {
    ({ svg, y } = header());
    sectionHead("exclusions", "Exclusions & assumptions");
    if (exclusions.length) {
      svg += label(M, y, "Excluded and to be priced");
      y += 6;
      for (const x of exclusions) para(`${x} — not in the total; priced when confirmed.`, { fill: DOC.INK, attrs: 'data-excluded="true"' });
      y += 3;
    }
    if (assumptions.length) {
      svg += label(M, y, "Assumptions");
      y += 6;
      for (const a of assumptions) para(a, { fill: DOC.INK, attrs: 'data-assumption="true"' });
    }
    push(svg);
  }

  // 4 Programme (indicative) — ink bars (brass draws lines only) ------------------------------
  if (prog) {
    ({ svg, y } = header());
    sectionHead("programme", "Programme");
    para(`${prog.total_days} days, indicative — the phases are sized by the value of their work; dates are agreed at contract.`);
    y += 3;
    const barX = 82;
    const barW = R - barX;
    for (const ph of prog.phases) {
      svg += text(M, y + 3.4, ph.name, { size: 2.9 });
      svg += text(barX - 3, y + 3.4, `${ph.days} d`, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
      svg += hline(barX, R, y + 2.2);
      const x0 = barX + ((ph.start_day - 1) / prog.total_days) * barW;
      const w = Math.max(0.8, (ph.days / prog.total_days) * barW);
      svg += `<rect x="${n1(x0)}" y="${n1(y + 0.6)}" width="${n1(w)}" height="3.2" fill="${DOC.INK}" data-programme-phase="${esc(ph.name)}"/>`;
      y += 7.4;
    }
    svg += text(barX, y + 2, "day 1", { size: 2.6, fill: DOC.INK_3, font: DOC.MONO });
    svg += text(R, y + 2, `day ${prog.total_days}`, { size: 2.6, fill: DOC.INK_3, font: DOC.MONO, anchor: "end" });
    push(svg);
  }

  // 5 Terms (validity, payment terms, the firm's words) ----------------------------------------
  if (hasTerms) {
    ({ svg, y } = header());
    sectionHead("terms", "Terms");
    if (input.validity) para(input.validity, { fill: DOC.INK, attrs: 'data-validity="true"' });
    if (input.paymentTerms) {
      svg += label(M, y, "Payment terms");
      y += 6;
      para(input.paymentTerms, { fill: DOC.INK, attrs: 'data-payment-terms="true"' });
      y += 2;
    }
    for (const p of input.termsText && input.termsText.trim() ? input.termsText.split(/\r?\n/) : []) {
      if (!p.trim()) {
        y += 2;
        continue;
      }
      para(p, { fill: DOC.INK, attrs: 'data-terms="true"' });
    }
    push(svg);
  }

  return pages.map((p) => p.replaceAll(PAGE_COUNT_TOKEN, String(pages.length)));
}
