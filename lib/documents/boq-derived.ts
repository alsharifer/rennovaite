// =============================================================================
// lib/documents/boq-derived.ts — how a BoQ total says it is not measured (G5).
//
// A BoQ whose quantities rest on derived dimensions must never print its total as
// a bare confident number. The convention, shared by the BoQ page, the BoQ PDF
// and the pack so it cannot drift between them:
//
//   ≈ AED 148,200*
//   * 9 lines carry quantities derived from the reference layout — firm after
//     site verification.
//
// "≈" and the rounding to the nearest AED 100 say "about"; the asterisk points at
// the reason. A BoQ with no derived line prints exactly as before.
// =============================================================================

// Imports only the pure site-reference vocabulary: this module reaches the
// client bundle, and the landscape take-off (with its rate provenance) must not.
import { DERIVED_QTY_NOTE, DRAFT_STATEMENT } from "@/lib/plan/site-reference";
import { formatAed } from "@/lib/format/aed";

interface LineLike {
  qty_derived?: boolean;
  notes?: string | null;
  description?: string;
  rate_aed?: number;
  rate_status?: string;
}

interface BoqLike {
  sections: { work_section?: string; lines: LineLike[] }[];
  garden?: { draft?: { draft?: boolean; statement?: string | null } | null; derived_lines?: number } | null;
}

export interface BoqDerivedInfo {
  /** Lines whose quantity is derived or inferred, not measured. */
  derivedLines: number;
  /** The plan behind this BoQ is a draft on derived dimensions. */
  draft: boolean;
  /** The verbatim draft statement, or null. */
  statement: string | null;
  /**
   * D4: lines still TO BE PRICED — QS-to-price (needs_qs) at rate 0. They add
   * nothing to the total, and a total that silently counts them at zero reads
   * as if that work were covered. The headline says it excludes them, and
   * names them.
   */
  unpriced: { work_section: string; description: string }[];
}

/** D4: a line with no price yet — QS-to-price at rate 0. */
export function isUnpricedLine(l: LineLike): boolean {
  return l.rate_status === "needs_qs" && (l.rate_aed ?? 0) === 0;
}

export function boqDerivedInfo(boq: BoqLike): BoqDerivedInfo {
  const derivedLines = boq.sections.reduce((n, s) => n + s.lines.filter((l) => l.qty_derived === true).length, 0);
  const draft = boq.garden?.draft?.draft === true;
  const unpriced = boq.sections.flatMap((s) =>
    s.lines.filter(isUnpricedLine).map((l) => ({ work_section: s.work_section ?? "", description: l.description ?? "" })),
  );
  return { derivedLines, draft, statement: draft ? boq.garden?.draft?.statement ?? DRAFT_STATEMENT : null, unpriced };
}

const aed = (n: number) => formatAed(n);

export interface HeadlineTotal {
  /** The figure alone: "AED 116,679" or "≈ AED 116,700*". */
  text: string;
  /** D4: the figure with its exclusion: "≈ AED 116,700* · excludes 3 lines to be priced". */
  headline: string;
  derived: boolean;
  footnote: string | null;
  /** "excludes 3 lines to be priced", or null when every line is priced. */
  excludes: string | null;
  /** The excluded lines, named. */
  excluded: { work_section: string; description: string }[];
}

/** The total as it must be printed. */
export function derivedTotal(amountAed: number, info: BoqDerivedInfo): HeadlineTotal {
  const excluded = info.unpriced ?? [];
  const k = excluded.length;
  const excludes = k > 0 ? `excludes ${k} line${k === 1 ? "" : "s"} to be priced` : null;
  const withExcludes = (text: string) => (excludes ? `${text} · ${excludes}` : text);
  if (info.derivedLines === 0 && !info.draft) {
    const text = aed(amountAed);
    return { text, headline: withExcludes(text), derived: false, footnote: null, excludes, excluded };
  }
  const n = info.derivedLines;
  const footnote = info.draft
    ? `* Draft on derived dimensions: ${n} line${n === 1 ? "" : "s"} carry quantities derived from the reference layout — firm after site verification.`
    : `* ${n} line${n === 1 ? "" : "s"} carry a quantity inferred rather than measured — confirm on site.`;
  const text = `≈ ${aed(Math.round(amountAed / 100) * 100)}*`;
  return { text, headline: withExcludes(text), derived: true, footnote, excludes, excluded };
}

/** What a derived line says under its description. */
export function derivedLineNote(line: LineLike): string | null {
  if (!line.qty_derived) return null;
  return line.notes?.includes(DERIVED_QTY_NOTE)
    ? "≈ Derived from the reference layout — firm after site verification."
    : "Quantity inferred, not measured — confirm on site.";
}
