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

interface LineLike {
  qty_derived?: boolean;
  notes?: string | null;
}

interface BoqLike {
  sections: { lines: LineLike[] }[];
  garden?: { draft?: { draft?: boolean; statement?: string | null } | null; derived_lines?: number } | null;
}

export interface BoqDerivedInfo {
  /** Lines whose quantity is derived or inferred, not measured. */
  derivedLines: number;
  /** The plan behind this BoQ is a draft on derived dimensions. */
  draft: boolean;
  /** The verbatim draft statement, or null. */
  statement: string | null;
}

export function boqDerivedInfo(boq: BoqLike): BoqDerivedInfo {
  const derivedLines = boq.sections.reduce((n, s) => n + s.lines.filter((l) => l.qty_derived === true).length, 0);
  const draft = boq.garden?.draft?.draft === true;
  return { derivedLines, draft, statement: draft ? boq.garden?.draft?.statement ?? DRAFT_STATEMENT : null };
}

const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`;

/** The total as it must be printed. */
export function derivedTotal(amountAed: number, info: BoqDerivedInfo): { text: string; derived: boolean; footnote: string | null } {
  if (info.derivedLines === 0 && !info.draft) return { text: aed(amountAed), derived: false, footnote: null };
  const n = info.derivedLines;
  const footnote = info.draft
    ? `* Draft on derived dimensions: ${n} line${n === 1 ? "" : "s"} carry quantities derived from the reference layout — firm after site verification.`
    : `* ${n} line${n === 1 ? "" : "s"} carry a quantity inferred rather than measured — confirm on site.`;
  return { text: `≈ ${aed(Math.round(amountAed / 100) * 100)}*`, derived: true, footnote };
}

/** What a derived line says under its description. */
export function derivedLineNote(line: LineLike): string | null {
  if (!line.qty_derived) return null;
  return line.notes?.includes(DERIVED_QTY_NOTE)
    ? "≈ Derived from the reference layout — firm after site verification."
    : "Quantity inferred, not measured — confirm on site.";
}
