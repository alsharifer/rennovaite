// =============================================================================
// lib/documents/boq-pdf-pages.ts — the BoQ PDF's pages (G5 document; K8 #16
// Blueprint paper, Figma 68:1396, spec §6.9). A4 LANDSCAPE.
//
// An internal / owner document, so unlike the client proposal it KEEPS the
// marks: every line prints its quantity and rate marks (tierOf, the same
// function the BoQ screen uses) and the amount's tier in words; each section
// opens with its REF code, its line count, its total and the weakest mark of
// what it counts (R1). The legend and "every figure reconciles to the BoQ"
// sit in the footer of every page. Page 1 is the summary: the total in the
// derived convention (≈ … * on a draft) with the lines still to be priced
// named (D4), the chain to the fil, existing-on-site notes and the indicative
// programme. Then each section; then the REF changes (D5).
//
// What it never prints: a supplier or contractor (the curated BoQ reaches it;
// the line's source is the mark, not a name), a status hue (colour draws
// marks only — the draft statement is the inverse band), a size under 2.6 mm.
// =============================================================================

import { assignRefs, refMigration } from "@/lib/boq/refs";
import { sortSections } from "@/lib/boq/section-order";
import { esc } from "@/lib/drawings/sheet";
import { formatAed } from "@/lib/format/aed";
import { tierOf, type TierContext } from "@/lib/provenance/tier";
import { tierLabel, weakest, type ProvTier } from "@/lib/provenance/tier-vocab";
import { OHP_LINE_LABEL } from "@/lib/rates/ohp";

import { boqDerivedInfo, derivedLineNote, derivedTotal } from "./boq-derived";
import type { BoqPdfInput } from "./boq-pdf";
import { DOC, PAGE_COUNT_TOKEN, docPage, hline, inverseBand, label, longDate, markGlyph, text, wrapWords, type PaperTier } from "./doc-style";

export const BOQ_LAND_W = 297;
export const BOQ_LAND_H = 210;
const W = BOQ_LAND_W;
const H = BOQ_LAND_H;
const M = 12.7;
const R = W - M;
const BOTTOM = H - 30;

// Columns (68:1396, 1123 px wide → mm).
const X = { ref: M, desc: 34.4, qty: 155.6, unit: 158.5, rate: 206.6, amount: 241.5, basis: 244.7 } as const;

// H7: every BoQ figure on paper to the fils, so rate × qty = amount can be checked.
const aed = (n: number) => formatAed(n, "money");

const LEGEND: [PaperTier, string][] = [
  ["measured", "measured / own basis"],
  ["validated", "QS validated"],
  ["market", "market reference"],
  ["derived", "derived / fallback"],
  ["unpriced", "to be priced — excluded"],
];

/** The section's REF code: the prefix of its lines' REFs ("HRD-01" → "HRD"). */
/** B5: the rate basis in words (lib/boq/rate-basis.ts RATE_BASIS_LABEL). */
const BASIS_WORD: Record<string, string> = { calibrated: "calibrated (reference villa)", market: "market rate book", firm: "your rate book", allowance: "allowance", tbc: "to be priced" };

const codeOf = (ref: string | undefined) => (ref ? ref.replace(/-\d+$/, "") : "");

export function buildBoqPdfPages(input: BoqPdfInput & { revision?: number | null; qsValidated?: TierContext["qsValidated"] }): string[] {
  const { boq } = input;
  const info = boqDerivedInfo(boq);
  const total = derivedTotal(boq.grand_total_aed, info);
  const statement = info.draft ? info.statement : null;
  const refs = assignRefs(boq.sections);
  const ctx: TierContext = { qsValidated: input.qsValidated };
  const rev = input.revision ? `rev ${input.revision}` : null;
  const sections = sortSections(boq.sections).map((s) => {
    const lines = s.lines.map((l, idx) => ({ line: l, ref: refs[`${s.work_section}-${idx}`]!, tiers: tierOf(l as never, s.work_section, ctx) }));
    const counted = lines.filter((x) => x.tiers.amount !== "unpriced").map((x) => x.tiers.amount as ProvTier);
    return { s, lines, code: codeOf(lines[0]?.ref), tier: (weakest(counted) ?? (lines.length ? "unpriced" : null)) as ProvTier | null };
  });

  const pages: string[] = [];
  const page = () => {
    let s = text(M, 12.4, `Bill of quantities · ${input.projectName}${rev ? ` · ${rev}` : ""}`, { size: 3, fill: DOC.INK_2, font: DOC.MONO });
    s += text(R, 12.4, "line amounts excl. VAT · AED", { size: 3, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
    s += hline(M, R, 17);
    let y = 24;
    if (statement) {
      const b = inverseBand(M, 20, R - M, wrapWords(statement, 140), 'data-boq-draft="true"');
      s += b.svg;
      y = 20 + b.h + 6;
    }
    // Footer: the legend, and the reconciliation line.
    s += hline(M, R, H - 23);
    let lx = M;
    for (const [tier, words] of LEGEND) {
      s += markGlyph(lx + 1.3, H - 18.4, tier);
      s += text(lx + 4, H - 17.4, words, { size: 2.6, fill: DOC.INK_2, font: DOC.MONO });
      lx += 4 + words.length * 1.62 + 6;
    }
    s += text(R, H - 17.4, "Q quantity · R rate · amount = the weaker", { size: 2.6, fill: DOC.INK_3, font: DOC.MONO, anchor: "end" });
    s += text(M, H - 9.6, `Generated ${longDate(input.dateISO)}${rev ? ` · ${rev}` : ""} · every figure reconciles to the BoQ`, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO });
    s += text(R, H - 9.6, `Page ${pages.length + 1} of ${PAGE_COUNT_TOKEN}`, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
    return { svg: s, y };
  };
  let { svg, y } = page();
  const flush = () => {
    pages.push(docPage(W, H, svg));
    ({ svg, y } = page());
  };

  // --- page 1: the summary --------------------------------------------------------------
  svg += text(M, y + 9, "Bill of quantities", { size: 8.5, font: DOC.SERIF });
  svg += text(M, y + 16, [input.projectName, input.community].filter(Boolean).join(" · "), { size: 3.2, fill: DOC.INK_2 });
  svg += text(R, y + 9, total.text, { size: 6.4, font: DOC.MONO, anchor: "end", attrs: `data-derived-total="${boq.grand_total_aed}"` });
  svg += text(R, y + 15, "grand total incl. contingency and VAT", { size: 2.7, fill: DOC.INK_2, anchor: "end" });
  // D4: a total never silently counts a to-be-priced line at zero.
  if (total.excludes) svg += text(R, y + 19.6, total.excludes, { size: 2.8, fill: DOC.INK, anchor: "end", weight: 600, attrs: 'data-headline-excludes="true"' });
  y += 27;
  const note = (s: string, o: { fill?: string } = {}) => {
    for (const line of wrapWords(s, 150)) {
      svg += text(M, y, line, { size: 2.8, fill: o.fill ?? DOC.INK_2 });
      y += 4.4;
    }
    y += 1;
  };
  if (total.footnote) note(total.footnote);
  const g = boq.garden;
  if (g?.kept?.length) note(`Existing on site, kept and excluded from demolition and new work: ${g.kept.map((k) => k.name).join(", ")}.`);
  if (g?.removals?.length) note(`Existing on site, taken out (in the demolition line): ${g.removals.map((r) => `${r.name} (${r.disposition})`).join(", ")}.`);
  if (g?.undecided?.length) note(`Not yet decided (in no quantity): ${g.undecided.map((u) => u.name).join(", ")}.`);
  y += 3;

  // The summary table: each section with its count, total and weakest mark; then the chain.
  svg += label(M, y, "Ref") + label(X.desc, y, "Section") + label(X.rate, y, "Lines", { anchor: "end" }) + label(X.amount, y, "Amount", { anchor: "end" }) + label(X.basis, y, "Basis");
  y += 2.4;
  svg += hline(M, R, y, DOC.STRONG, 0.5);
  // B5: the summary is ONE page — a BoQ with many sections (a wet room has 14) gets tighter rows.
  const ROW = sections.length > 10 ? 5.0 : 7.5;
  const BASE_Y = ROW * 0.67;
  const sumRow = (ref: string, k: string, count: string, v: string, tier: ProvTier | null, attrs = "", bold = false) => {
    if (y + ROW > BOTTOM) flush();
    svg += text(M, y + BASE_Y, ref, { size: 2.8, fill: DOC.INK_3, font: DOC.MONO });
    svg += text(X.desc, y + BASE_Y, k, { size: 3, weight: bold ? 600 : undefined });
    if (count) svg += text(X.rate, y + BASE_Y, count, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
    svg += text(X.amount, y + BASE_Y, v, { size: 3, font: DOC.MONO, anchor: "end", weight: bold ? 600 : undefined, attrs });
    if (tier) {
      svg += markGlyph(X.basis + 1.3, y + BASE_Y - 1, tier as PaperTier);
      svg += text(X.basis + 4, y + BASE_Y, tierLabel(tier).toLowerCase(), { size: 2.8, fill: DOC.INK_2, font: DOC.MONO });
    }
    y += ROW;
    svg += hline(M, R, y);
  };
  for (const x of sections) sumRow(x.code, x.s.work_section, `${x.lines.length}`, aed(x.s.section_total_aed), x.tier, `data-section-total="${esc(x.s.work_section)}"`);
  sumRow("", "Subtotal", "", aed(boq.subtotal_aed), null, 'data-summary="subtotal"', true);
  if (boq.ohp_aed && boq.ohp_aed > 0) sumRow("", `${OHP_LINE_LABEL} ${boq.ohp_pct}%`, "", aed(boq.ohp_aed), null, `data-ohp="${boq.ohp_aed}"`);
  sumRow("", `Contingency ${boq.contingency_pct}%`, "", aed(boq.contingency_aed), null, 'data-summary="contingency"');
  sumRow("", `VAT ${boq.vat_pct}%`, "", aed(boq.vat_aed), null, 'data-summary="vat"');
  sumRow("", "Grand total", "", `AED ${aed(boq.grand_total_aed)}`, null, `data-grand-total="${boq.grand_total_aed}"`, true);
  // B5: options — priced, never in the total. "Total moves by" runs the same chain (contingency, VAT).
  const options = boq.options ?? [];
  if (options.length) {
    if (y + 10 + options.length * ROW > BOTTOM) flush();
    y += 6;
    svg += label(M, y, "Options — priced separately, not in the total", { fill: DOC.INK });
    svg += label(X.rate, y, "Net", { anchor: "end" }) + label(X.amount, y, "Total moves by", { anchor: "end" });
    y += 2.4;
    svg += hline(M, R, y, DOC.STRONG, 0.5);
    for (const o of options) {
      svg += text(M, y + BASE_Y, o.label, { size: 3, weight: 500 });
      svg += text(X.rate, y + BASE_Y, aed(o.net_aed), { size: 3, font: DOC.MONO, anchor: "end" });
      svg += text(X.amount, y + BASE_Y, o.delta_total_aed != null ? `+ ${aed(o.delta_total_aed)}` : "—", { size: 3, font: DOC.MONO, anchor: "end", attrs: `data-option="${esc(o.key)}" data-option-delta="${o.delta_total_aed ?? ""}"` });
      svg += text(X.basis, y + BASE_Y, "incl. contingency + VAT", { size: 2.7, fill: DOC.INK_2, font: DOC.MONO });
      y += ROW;
      svg += hline(M, R, y);
    }
    y += 2;
  }

  y += 3;
  if (total.excluded.length) {
    if (y + 5 > BOTTOM) flush();
    note(`Not in the total — to be priced: ${total.excluded.map((x) => `${x.description} (${x.work_section})`).join(" · ")}`, { fill: DOC.INK });
  }

  // B5: what the rates rest on, by line count and amount.
  const allLines = boq.sections.flatMap((s) => s.lines);
  if (allLines.some((l) => l.rate_basis)) {
    const by = new Map<string, { n: number; aed: number }>();
    for (const l of allLines) {
      const k = l.rate_basis ?? "market";
      const c = by.get(k) ?? { n: 0, aed: 0 };
      by.set(k, { n: c.n + 1, aed: c.aed + l.total_aed });
    }
    const SHORT: Record<string, string> = { calibrated: "calibrated", market: "market", firm: "your book", allowance: "allowance", tbc: "to be priced" };
    const words = ["calibrated", "market", "firm", "allowance", "tbc"].filter((k) => by.has(k)).map((k) => `${SHORT[k]} ${by.get(k)!.n}${k === "tbc" ? "" : ` · AED ${aed(by.get(k)!.aed)}`}`);
    // A one-line note may use the footer's margin above the legend rule (H − 23).
    if (y > H - 27) flush();
    note(`Rate basis (lines · amount) — ${words.join(" | ")}`, { fill: DOC.INK });
  }


  // G5d: an INDICATIVE delivery programme, never a line. Ink bars — brass draws lines only.
  const prog = boq.programme;
  if (prog && prog.phases.length) {
    const basis = wrapWords(prog.basis, 150);
    if (y + 16 + prog.phases.length * 6.5 + basis.length * 4.4 > BOTTOM) flush();
    y += 4;
    svg += label(M, y, "Indicative delivery programme", { fill: DOC.INK });
    svg += text(R, y, `≈ ${prog.total_days} days · indicative · derived`, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
    y += 5;
    const barX = 110;
    const barW = R - barX;
    for (const ph of prog.phases) {
      svg += text(M, y + 3.2, ph.name, { size: 2.9 });
      svg += text(barX - 3, y + 3.2, `${ph.days} d`, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
      svg += hline(barX, R, y + 2.2);
      const x0 = barX + ((ph.start_day - 1) / prog.total_days) * barW;
      const w = Math.max(0.8, (ph.days / prog.total_days) * barW);
      svg += `<rect x="${x0.toFixed(1)}" y="${(y + 0.6).toFixed(1)}" width="${w.toFixed(1)}" height="3.2" fill="${DOC.INK}" data-programme-phase="${esc(ph.name)}"/>`;
      y += 6.5;
    }
    svg += text(barX, y + 2, "day 1", { size: 2.6, fill: DOC.INK_3, font: DOC.MONO });
    svg += text(R, y + 2, `day ${prog.total_days}`, { size: 2.6, fill: DOC.INK_3, font: DOC.MONO, anchor: "end" });
    y += 7;
    for (const line of basis) {
      svg += text(M, y, line, { size: 2.7, fill: DOC.INK_2 });
      y += 4.4;
    }
  }
  flush();

  // --- the sections (68:1396): each opens a page ------------------------------------------
  const colHead = () => {
    svg += label(X.ref, y, "Ref") + label(X.desc, y, "Description") + label(X.qty, y, "Qty", { anchor: "end" }) + label(X.unit, y, "Unit") + label(X.rate, y, "Rate", { anchor: "end" }) + label(X.amount, y, "Amount", { anchor: "end" }) + label(X.basis, y, "Basis");
    y += 5;
  };
  const sectionHead = (x: (typeof sections)[number], cont: boolean) => {
    svg += text(X.ref, y + 4, x.code, { size: 2.8, fill: DOC.INK_3, font: DOC.MONO });
    svg += text(21.7, y + 4.4, `${x.s.work_section}${cont ? " (continued)" : ""}`, { size: 4.8, weight: 500 });
    svg += text(X.amount, y + 4, `${x.lines.length} line${x.lines.length === 1 ? "" : "s"}`, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
    svg += text(R - 4.5, y + 4.4, aed(x.s.section_total_aed), { size: 4, font: DOC.MONO, anchor: "end" });
    if (x.tier) svg += markGlyph(R - 1.3, y + 3.2, x.tier as PaperTier);
    y += 7.6;
    svg += hline(M, R, y, DOC.STRONG, 0.5);
    y += 6.6;
    colHead();
  };
  sections.forEach((x, si) => {
    if (si > 0) flush();
    sectionHead(x, false);
    for (const { line: l, ref, tiers } of x.lines) {
      const desc = wrapWords(l.description, 64).slice(0, 3);
      const sub = [derivedLineNote(l), l.stated_zero && l.notes ? l.notes : null, l.rate_basis && l.rate_basis !== "market" ? `rate: ${BASIS_WORD[l.rate_basis] ?? l.rate_basis}` : null].filter(Boolean).join(" · ");
      const subLines = sub ? wrapWords(sub, 80) : [];
      const h = 4.6 * desc.length + 3.8 * subLines.length + 4.4;
      if (y + h > BOTTOM) {
        flush();
        sectionHead(x, true);
      }
      const base = y + 4;
      const unpriced = tiers.amount === "unpriced";
      svg += text(X.ref, base, ref, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO, attrs: `data-ref="${esc(ref)}"` });
      desc.forEach((d, i) => (svg += text(X.desc, base + i * 4.6, d, { size: 3 })));
      svg += text(X.qty, base, `${l.qty_derived ? "≈ " : ""}${l.quantity}`, { size: 3, font: DOC.MONO, anchor: "end" });
      svg += text(X.unit, base, l.unit.replace(/\bm2\b/g, "m²").replace(/\bm3\b/g, "m³"), { size: 2.9, fill: DOC.INK_2 });
      svg += text(X.rate, base, unpriced ? "—" : aed(l.rate_aed), { size: 3, font: DOC.MONO, anchor: "end" });
      svg += text(X.amount, base, unpriced ? "to be priced" : aed(l.total_aed), { size: unpriced ? 2.8 : 3, font: DOC.MONO, anchor: "end", fill: unpriced ? DOC.INK_3 : DOC.INK });
      // Basis: Q ◯ R ◑ = derived — the amount takes the weaker of the two (R1).
      svg += text(X.basis, base, "Q", { size: 2.8, fill: DOC.INK_3, font: DOC.MONO });
      svg += markGlyph(X.basis + 4.3, base - 1, tiers.qty as PaperTier);
      svg += text(X.basis + 7, base, "R", { size: 2.8, fill: DOC.INK_3, font: DOC.MONO });
      svg += markGlyph(X.basis + 11.3, base - 1, tiers.rate as PaperTier);
      svg += text(X.basis + 14, base, `= ${tierLabel(tiers.amount).toLowerCase()}`, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO });
      let sy = base + desc.length * 4.6;
      for (const s of subLines) {
        svg += text(X.desc, sy - 0.4, s, { size: 2.6, fill: DOC.INK_3 });
        sy += 3.8;
      }
      y += h;
      svg += hline(M, R, y);
    }
  });
  pages.push(docPage(W, H, svg));

  // D5: REF changes — a screen reference in the old scheme ("P-01", ambiguous
  // across Plaster / Plumbing / Preliminaries) can still find its line.
  const migration = refMigration(boq.sections).filter((m) => m.legacy_ref !== m.ref);
  if (migration.length > 0) {
    ({ svg, y } = page());
    const head = () => {
      svg += text(M, y + 4, "REF CHANGES — OLD CODE → NEW CODE", { size: 3.4, weight: 500 });
      svg += text(M, y + 10, "Before 22 Sep 2026 a REF was its section's initials + line number, so different sections could share a code. Read the old code together with its section.", { size: 2.8, fill: DOC.INK_2 });
      y += 17;
      svg += label(M, y, "Section") + label(90, y, "Old") + label(115, y, "New") + label(140, y, "Line");
      y += 5;
    };
    head();
    for (const m of migration) {
      if (y + 5 > BOTTOM) {
        pages.push(docPage(W, H, svg));
        ({ svg, y } = page());
        head();
      }
      svg += text(M, y, m.work_section, { size: 2.9, fill: DOC.INK_2 });
      svg += text(90, y, m.legacy_ref, { size: 2.9, font: DOC.MONO, fill: DOC.INK_3 });
      svg += text(115, y, m.ref, { size: 2.9, font: DOC.MONO, attrs: `data-ref-map="${esc(m.legacy_ref)}→${esc(m.ref)}"` });
      svg += text(140, y, m.description.length > 90 ? `${m.description.slice(0, 89)}…` : m.description, { size: 2.9 });
      y += 5;
    }
    pages.push(docPage(W, H, svg));
  }
  return pages.map((p) => p.replaceAll(PAGE_COUNT_TOKEN, String(pages.length)));
}

