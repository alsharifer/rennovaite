// =============================================================================
// lib/boq/own-basis.ts — prices added on review and corrections that apply,
// laid over a BoQ document (K11 #4, spec §7.3; migration 057).
//
// ONE function — `applyOwnBasis` — puts every applied, un-reverted correction
// of a project onto a document. Both roads to a revision use it:
//
//   apply   (lib/boq/apply-correction.ts) the latest STORED revision + the
//           corrections → the next revision; nothing else moves, so the
//           subtotal moves by exactly the line's change and the chain
//           (OH&P, contingency, VAT) recomputes to the fil (`rechain`);
//   regenerate (lib/boq/assemble.ts) the freshly priced document + the same
//           corrections, before OH&P — a regenerated BoQ never silently drops a
//           price someone added.
//
// A correction finds its line by the line's STABLE identity (line-identity.ts:
// `${section}|${identity}[#n]`), never by REF or position. A rate correction
// makes the line YOUR PRICE — rate_tier own_price (tierOf → measured, "own
// basis"), rate_status priced (so a QS-to-price line is no longer excluded),
// the curated source label, and `price_basis` (what the popover and the diff
// print). A quantity correction sets the quantity as measured (`qty_basis`).
// Pure.
// =============================================================================

import { lineIdentity, stableLineKeys } from "./line-identity";
import { lineTotal, money2 } from "./money";
import { OWN_PRICE_SOURCE, OWN_PRICE_TIER, type BasisKind, type CorrectionOrigin } from "./own-basis-vocab";
import { rechain, type ChainedDoc } from "./totals";

export interface AppliedCorrection {
  id: string;
  type: "rate" | "quantity";
  /** Stable line identity. */
  lineKey: string;
  value: number;
  origin: CorrectionOrigin;
  basisKind: BasisKind | null;
  note: string | null;
  byName: string | null;
  appliedAt: string;
}

/** What a priced-on-review line carries (also its quantity's `qty_basis`). */
export interface OwnBasisRecord {
  correction_id: string;
  origin: CorrectionOrigin;
  kind: BasisKind | null;
  note: string | null;
  by: string | null;
  at: string;
}

type Line = {
  description: string;
  quantity: number;
  rate_aed: number;
  total_aed: number;
  rule_id?: string;
  item_key?: string;
  rate_tier?: string;
  rate_status?: string;
  vendor_or_source?: string;
  qty_derived?: boolean;
  price_basis?: OwnBasisRecord;
  qty_basis?: OwnBasisRecord;
};
/** A BoQ document as this module reads it (the chain fields + its lines). */
export type OwnBasisDoc = Omit<ChainedDoc, "sections"> & { sections: { work_section: string; lines: Line[]; section_total_aed: number }[] };
type Doc = OwnBasisDoc;

// The provenance aside a QS-to-price line's description carries — false once it is priced.
const QS_ASIDE = /\s*\(([^()]*\bQS to (?:price|confirm)\b[^()]*)\)\s*$/;

const record = (c: AppliedCorrection): OwnBasisRecord => ({ correction_id: c.id, origin: c.origin, kind: c.basisKind, note: c.note, by: c.byName, at: c.appliedAt });

/** One line with one correction applied. */
export function applyToLine<L extends Line>(line: L, c: AppliedCorrection): L {
  if (c.type === "rate") {
    const rate_aed = money2(c.value);
    // The aside goes only when the line keeps its identity without it — a line named by its
    // description (a garden label) keeps the words, or the next revision could not find it.
    const stripped = line.description.replace(QS_ASIDE, "").trim();
    const description = lineIdentity({ ...line, description: stripped }) === lineIdentity(line) ? stripped : line.description;
    return { ...line, description, rate_aed, total_aed: lineTotal(line.quantity, rate_aed), rate_tier: OWN_PRICE_TIER, rate_status: "priced", vendor_or_source: OWN_PRICE_SOURCE, price_basis: record(c) };
  }
  const quantity = Number(c.value);
  return { ...line, quantity, total_aed: lineTotal(quantity, line.rate_aed), qty_derived: false, qty_basis: record(c) };
}

/**
 * Every correction onto the document, oldest application first (a later one on
 * the same line and figure wins). Returns the new document (re-chained when
 * anything applied; the input untouched otherwise), the ids applied, and the
 * ids whose line is no longer in this BoQ.
 */
export function applyOwnBasis<T extends Doc>(boq: T, corrections: readonly AppliedCorrection[]): { boq: T; applied: string[]; missing: string[] } {
  if (corrections.length === 0) return { boq, applied: [], missing: [] };
  const keys = stableLineKeys(boq.sections);
  const byKey = new Map<string, { s: number; i: number }>();
  boq.sections.forEach((s, si) => s.lines.forEach((_, li) => byKey.set(keys[`${s.work_section}-${li}`]!, { s: si, i: li })));
  const sections = boq.sections.map((s) => ({ ...s, lines: [...s.lines] }));
  const applied: string[] = [];
  const missing: string[] = [];
  for (const c of [...corrections].sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.id.localeCompare(b.id))) {
    const at = byKey.get(c.lineKey);
    if (!at || !Number.isFinite(c.value) || c.value < 0) {
      missing.push(c.id);
      continue;
    }
    sections[at.s]!.lines[at.i] = applyToLine(sections[at.s]!.lines[at.i]!, c);
    applied.push(c.id);
  }
  if (applied.length === 0) return { boq, applied, missing };
  return { boq: rechain({ ...boq, sections } as unknown as ChainedDoc) as unknown as T, applied, missing };
}

/** The stable key of the line at a BoQ view row key (`${section}-${idx}`), or null. */
export function lineKeyAt(boq: { sections: { work_section: string; lines: Line[] }[] }, rowKey: string): string | null {
  return stableLineKeys(boq.sections)[rowKey] ?? null;
}
