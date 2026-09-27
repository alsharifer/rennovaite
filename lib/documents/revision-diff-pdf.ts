// =============================================================================
// lib/documents/revision-diff-pdf.ts — the revision diff as an A4 document (U4).
//
// The SAME RevisionDiff object the in-app view renders, on paper: header (project,
// the two revisions, old → new total), the approval trail of both revisions, then
// every line that moved — REF, description, old → new quantity, old → new rate,
// AED delta, class, and the recorded cause(s) beneath — section by section, then
// the summary chain old → new. What was recorded between the two revisions but
// names no line (plan edits, decisions, the generation) closes the document.
//
// Pure page builder + the shared rasteriser (lib/documents/boq-pdf.ts). No rate
// source, no member identity, no firm name reaches a page: the input is the
// curated diff, and the route scans the printed pages before serving.
// =============================================================================

import { esc } from "@/lib/drawings/sheet";
import { formatAed } from "@/lib/format/aed";

import { approvalLabel, type RevisionApprovalStatus } from "@/lib/boq/approvals";
import { CAUSE_KIND_LABEL, DIFF_CLASS_LABEL, type DiffLine, type RevisionDiff } from "@/lib/boq/revision-diff";

import { A4_PDF, BOQ_PAGE_H, BOQ_PAGE_W, a4Num as f1, a4Page as page, a4Text as t, a4Wrap as wrap, rasteriseA4Pages } from "./boq-pdf";

const { M, INK_900, INK_700, INK_500, INK_100, BRASS, TERRACOTTA, FONT_MONO, FONT_DISPLAY, K } = A4_PDF;

export interface RevisionDiffPdfInput {
  projectName: string;
  community: string;
  dateISO: string;
  diff: RevisionDiff;
  /** `${work_section}-${idx}` → REF, for the AFTER revision (a removed line uses the BEFORE codes). */
  refs: { before: Record<string, string>; after: Record<string, string> };
  approvals: { before: RevisionApprovalStatus; after: RevisionApprovalStatus };
}

const aed = (n: number) => formatAed(n, "amount");
const signed = (n: number) => formatAed(n, "signed");
const day = (iso: string) => iso.slice(0, 10);
const qty = (n: number | null) => (n == null ? "—" : String(n));

type Row =
  | { kind: "section"; title: string }
  | { kind: "line"; line: DiffLine; ref: string; desc: string[]; sub: string[] };

export function buildRevisionDiffPages(input: RevisionDiffPdfInput): string[] {
  const { diff } = input;
  const rows: Row[] = [];
  const sections = [...new Set(diff.lines.map((l) => l.section))];
  for (const section of sections) {
    rows.push({ kind: "section", title: section });
    for (const l of diff.lines.filter((x) => x.section === section)) {
      const ref = l.new ? input.refs.after[`${l.section}-${l.new.index}`] : l.old ? `${input.refs.before[`${l.section}-${l.old.index}`] ?? ""}†` : "";
      const sub: string[] = [];
      for (const c of l.causes) sub.push(...wrap(`${CAUSE_KIND_LABEL[c.kind]} · ${day(c.at)} — ${c.summary}`, 78));
      if (l.causes.length === 0) sub.push("no cause recorded between these revisions");
      rows.push({ kind: "line", line: l, ref: ref ?? "", desc: wrap(l.description, 40).slice(0, 3), sub });
    }
  }
  const DESC_H = 3.4 * K;
  const SUB_H = 3 * K;
  const rowH = (r: Row) => (r.kind === "section" ? 9 : DESC_H * Math.max(r.desc.length, 2) + SUB_H * r.sub.length + 2.6);

  const header = (n: number) => {
    let s = t(M, 14, "RennovAIte", { size: 4.4, fill: BRASS, font: FONT_DISPLAY });
    s += t(BOQ_PAGE_W - M, 14, `${input.projectName} · BoQ revision diff`, { size: 2.6, fill: INK_500, anchor: "end" });
    s += `<line x1="${M}" y1="18" x2="${BOQ_PAGE_W - M}" y2="18" stroke="${INK_100}" stroke-width="0.3"/>`;
    s += t(BOQ_PAGE_W - M, BOQ_PAGE_H - 8, `${n}`, { size: 2.4, fill: INK_500, font: FONT_MONO, anchor: "end" });
    s += t(M, BOQ_PAGE_H - 8, `revision ${diff.from.boq_id.slice(0, 8)} → ${diff.to.boq_id.slice(0, 8)} · AED · dated ${input.dateISO}`, { size: 2.2, fill: INK_500 });
    return { svg: s, y: 21 };
  };
  const colHead = (y: number) =>
    t(M, y, "REF", { size: 2.1, fill: INK_500, spacing: "0.06em" }) +
    t(M + 16, y, "DESCRIPTION", { size: 2.1, fill: INK_500, spacing: "0.06em" }) +
    t(112, y, "QTY OLD → NEW", { size: 2.1, fill: INK_500, anchor: "end" }) +
    t(150, y, "RATE OLD → NEW", { size: 2.1, fill: INK_500, anchor: "end" }) +
    t(BOQ_PAGE_W - M, y, "Δ TOTAL", { size: 2.1, fill: INK_500, anchor: "end" }) +
    `<line x1="${M}" y1="${f1(y + 1.6)}" x2="${BOQ_PAGE_W - M}" y2="${f1(y + 1.6)}" stroke="${INK_100}" stroke-width="0.3"/>`;

  const pages: string[] = [];
  let n = 1;
  let { svg, y } = header(n);

  // Title block.
  svg += t(M, y + 12, "Revision diff", { size: 9, font: FONT_DISPLAY });
  svg += t(M, y + 19, `${input.projectName} · ${input.community}`, { size: 3.2, fill: INK_700 });
  svg += t(BOQ_PAGE_W - M, y + 12, signed(diff.summary.grand.delta), { size: 7.5, font: FONT_MONO, anchor: "end", fill: diff.summary.grand.delta === 0 ? INK_500 : INK_900 }).replace("<text ", '<text data-diff-delta="true" ');
  svg += t(BOQ_PAGE_W - M, y + 19, `${aed(diff.summary.grand.old)} → ${aed(diff.summary.grand.new)} grand total${diff.summary.delta_pct != null ? ` (${diff.summary.delta_pct >= 0 ? "+" : ""}${diff.summary.delta_pct}%)` : ""}`, { size: 2.4, fill: INK_500, anchor: "end" });
  y += 26;
  const rev = (label: string, r: { boq_id: string; created_at: string; draft: boolean }, a: RevisionApprovalStatus) => {
    svg += t(M, y, `${label}  revision ${r.boq_id.slice(0, 8)} · ${day(r.created_at)}${r.draft ? " · DRAFT" : ""}`, { size: 2.6, fill: INK_900, weight: 700 }).replace("<text ", `<text data-revision="${label.toLowerCase()}" `);
    y += 3.4 * K;
    const trail = a.trail.length ? a.trail.map(approvalLabel) : ["not approved"];
    for (const line of trail) {
      svg += t(M + 4, y, line, { size: 2.3, fill: a.trail.length ? INK_700 : INK_500 }).replace("<text ", '<text data-approval="true" ');
      y += 3 * K;
    }
    y += 1.5;
  };
  rev("FROM", diff.from, input.approvals.before);
  rev("TO", diff.to, input.approvals.after);
  svg += t(M, y, `${diff.counts.moved} moved · ${diff.counts.added} added · ${diff.counts.removed} removed · ${diff.unchanged} unchanged · ${diff.counts.with_cause} with a recorded cause`, { size: 2.4, fill: INK_500 });
  if (diff.watermark_drops) {
    y += 3.2 * K;
    svg += t(M, y, "The draft watermark drops between these revisions: derived dimensions became measured.", { size: 2.4, fill: TERRACOTTA });
  }
  y += 6;
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

  if (rows.length === 0) {
    svg += t(M, y + 3, "No line moved between these two revisions.", { size: 2.8, fill: INK_500 });
    y += 8;
  }
  for (const r of rows) {
    if (y + rowH(r) > bottom) flush();
    if (r.kind === "section") {
      svg += t(M, y + 4, r.title.toUpperCase(), { size: 2.7, fill: BRASS, weight: 700, spacing: "0.05em" });
      y += 8;
      continue;
    }
    const l = r.line;
    const dim = l.class === "removed";
    svg += t(M, y + 2.6, r.ref, { size: 2.2, fill: INK_500, font: FONT_MONO }).replace("<text ", `<text data-ref="${esc(r.ref)}" `);
    r.desc.forEach((d, i) => {
      svg += t(M + 16, y + 2.6 + i * DESC_H, d, { size: 2.55, fill: dim ? INK_500 : INK_900 });
    });
    svg += t(M + 16, y + 2.6 + Math.max(r.desc.length, 1) * DESC_H, DIFF_CLASS_LABEL[l.class], { size: 2.1, fill: l.class === "added" ? BRASS : l.class === "removed" ? TERRACOTTA : INK_500 }).replace("<text ", `<text data-class="${l.class}" `);
    const q = `${qty(l.old?.quantity ?? null)} → ${qty(l.new?.quantity ?? null)} ${l.unit}`;
    svg += t(112, y + 2.6, q, { size: 2.55, font: FONT_MONO, anchor: "end" }).replace("<text ", `<text data-qty="${esc(q)}" `);
    const rate = `${l.old ? aed(l.old.rate_aed) : "—"} → ${l.new ? aed(l.new.rate_aed) : "—"}`;
    svg += t(150, y + 2.6, rate, { size: 2.55, font: FONT_MONO, anchor: "end", fill: l.class === "rate" || l.class === "both" ? INK_900 : INK_700 });
    svg += t(BOQ_PAGE_W - M, y + 2.6, signed(l.delta_aed), { size: 2.55, font: FONT_MONO, anchor: "end", weight: 700 }).replace("<text ", `<text data-delta-aed="${l.delta_aed}" `);
    let sy = y + 2.6 + (Math.max(r.desc.length, 2) + 0.4) * DESC_H;
    for (const s of r.sub) {
      svg += t(M + 16, sy - 0.4, s, { size: 2.1, fill: s.startsWith("no cause") ? INK_500 : INK_700 }).replace("<text ", `<text data-cause="${s.startsWith("no cause") ? "none" : "recorded"}" `);
      sy += SUB_H;
    }
    y += rowH(r);
  }

  // Summary chain old → new.
  if (y + 46 > bottom) flush();
  y += 4;
  svg += `<line x1="100" y1="${f1(y - 3)}" x2="${BOQ_PAGE_W - M}" y2="${f1(y - 3)}" stroke="${INK_900}" stroke-width="0.35"/>`;
  const sumRow = (label: string, d: { old: number; new: number; delta: number }, bold = false) => {
    svg += t(120, y, label, { size: 2.7, fill: bold ? INK_900 : INK_700, anchor: "end", weight: bold ? 700 : undefined });
    svg += t(165, y, `${aed(d.old)} → ${aed(d.new)}`, { size: 2.5, font: FONT_MONO, anchor: "end", fill: INK_700 });
    svg += t(BOQ_PAGE_W - M, y, signed(d.delta), { size: bold ? 3.4 : 2.7, font: FONT_MONO, anchor: "end", weight: bold ? 700 : undefined }).replace("<text ", `<text data-summary="${esc(label)}" `);
    y += bold ? 7 : 5;
  };
  sumRow("Subtotal", diff.summary.subtotal);
  if (diff.summary.ohp.old !== 0 || diff.summary.ohp.new !== 0) sumRow("Overheads & profit", diff.summary.ohp);
  sumRow("Contingency", diff.summary.contingency);
  sumRow("VAT", diff.summary.vat);
  sumRow("Grand total", diff.summary.grand, true);

  // Recorded between the revisions, naming no line.
  if (diff.window_causes.length > 0) {
    if (y + 14 + diff.window_causes.length * 3.6 > bottom) flush();
    y += 4;
    svg += t(M, y, "RECORDED BETWEEN THESE REVISIONS", { size: 2.7, fill: BRASS, weight: 700, spacing: "0.05em" });
    y += 5;
    for (const c of diff.window_causes) {
      for (const line of wrap(`${day(c.at)} · ${CAUSE_KIND_LABEL[c.kind]} — ${c.summary}`, 96)) {
        if (y + 4 > bottom) flush();
        svg += t(M, y, line, { size: 2.3, fill: INK_700 }).replace("<text ", '<text data-window-cause="true" ');
        y += 3.2 * K;
      }
    }
  }
  y += 4;
  if (y + 8 > bottom) flush();
  svg += t(M, y, "A cause is printed only where a correction, a rate-book entry or a plan event was recorded between the two revisions and names the line. † a REF from the earlier revision (the line is gone from the later one).", { size: 2.1, fill: INK_500 });

  pages.push(page(svg));
  return pages;
}

/** Server-only. */
export async function renderRevisionDiffPdf(input: RevisionDiffPdfInput): Promise<{ pdf: Uint8Array; pages: string[] }> {
  const pages = buildRevisionDiffPages(input);
  return { pdf: await rasteriseA4Pages(pages, `${input.projectName} — BoQ revision diff`), pages };
}
