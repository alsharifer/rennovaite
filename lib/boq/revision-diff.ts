// =============================================================================
// lib/boq/revision-diff.ts — any two BoQ revisions of one project, line by line
// (U4 / L3). The garden change-report engine (lib/pilot/change-report.ts),
// generalised:
//
//   · keyed on the STABLE line identity (lib/boq/line-identity.ts), not on REF
//     codes and not on the engine's rule_id with its rate-note suffix;
//   · every line that moved — old → new quantity, rate and total — classified
//     quantity | rate | both | added | removed;
//   · a CAUSE only where a record says so: a correction, a firm rate entry or a
//     plan event recorded between the two revisions and naming the line's item.
//     A line with no such record has no cause. It is never given a story;
//   · the summary chain (subtotal → OH&P → contingency → VAT → total), old → new.
//
// Pure. The in-app view and the PDF both render the object this returns; the
// server assembles its inputs (lib/boq/revisions.ts, lib/boq/revision-causes.ts).
// =============================================================================

import { lineItemKey, stableLineKeys } from "./line-identity";
import { CAUSE_KIND_LABEL, DIFF_CLASS_LABEL, type CauseKind, type DiffClass } from "./revision-diff-types";

export { CAUSE_KIND_LABEL, DIFF_CLASS_LABEL };
export type { CauseKind, DiffClass };

// --- Inputs ------------------------------------------------------------------

export interface RevisionBoqLine {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  rule_id?: string;
  item_key?: string;
  rate_status?: string;
  qty_derived?: boolean;
  vendor_or_source?: string;
}

/** The stored BoQ document (boqs.sections jsonb) of one revision. */
export interface RevisionBoq {
  sections: { work_section: string; lines: RevisionBoqLine[]; section_total_aed: number }[];
  subtotal_aed: number;
  ohp_pct?: number;
  ohp_aed?: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
  garden?: { draft?: { draft?: boolean } | null } | null;
}

export interface RevisionLine {
  /** Stable key: `${work_section}|${identity}[#n]`. */
  key: string;
  section: string;
  /** Position within its section — the BoQ view's row key is `${section}-${index}`. */
  index: number;
  item_key: string | null;
  description: string;
  unit: string;
  quantity: number;
  rate_aed: number;
  total_aed: number;
  rate_status: string | null;
  qty_derived: boolean;
}

export interface RevisionSnapshot {
  boq_id: string;
  created_at: string;
  draft: boolean;
  lines: RevisionLine[];
  summary: { subtotal_aed: number; ohp_aed: number; contingency_aed: number; vat_aed: number; grand_total_aed: number };
}

export function snapshotRevision(boqId: string, createdAt: string, boq: RevisionBoq): RevisionSnapshot {
  const keys = stableLineKeys(boq.sections);
  const lines: RevisionLine[] = [];
  for (const s of boq.sections) {
    s.lines.forEach((l, index) => {
      lines.push({
        key: keys[`${s.work_section}-${index}`]!,
        section: s.work_section,
        index,
        // The resolved item — a BoQ stored before U4 names it through its rule id.
        item_key: lineItemKey(l),
        description: l.description,
        unit: l.unit,
        quantity: Number(l.quantity),
        rate_aed: Number(l.rate_aed),
        total_aed: Number(l.total_aed),
        rate_status: l.rate_status ?? null,
        qty_derived: l.qty_derived === true,
      });
    });
  }
  return {
    boq_id: boqId,
    created_at: createdAt,
    draft: boq.garden?.draft?.draft === true,
    lines,
    summary: {
      subtotal_aed: Number(boq.subtotal_aed),
      ohp_aed: Number(boq.ohp_aed ?? 0),
      contingency_aed: Number(boq.contingency_aed),
      vat_aed: Number(boq.vat_aed),
      grand_total_aed: Number(boq.grand_total_aed),
    },
  };
}

// --- Causes -------------------------------------------------------------------


/**
 * Something RECORDED between two revisions that can explain a movement. The
 * server builds these from boq_corrections, firm_rate_entries and pilot_events;
 * a test builds them by hand. `item_keys` / `descriptions` say which lines the
 * record names; a record naming nothing is a window-level cause only.
 */
export interface RecordedCause {
  kind: CauseKind;
  at: string;
  summary: string;
  item_keys?: string[];
  descriptions?: string[];
  /** `true` = explains the whole revision (e.g. the generation that produced it). */
  revision_level?: boolean;
}

export interface Cause {
  kind: CauseKind;
  at: string;
  summary: string;
}

// --- Output -------------------------------------------------------------------


export interface DiffLine {
  key: string;
  section: string;
  description: string;
  unit: string;
  item_key: string | null;
  class: DiffClass;
  old: RevisionLine | null;
  new: RevisionLine | null;
  delta_qty: number;
  delta_pct: number | null;
  delta_rate_aed: number;
  delta_aed: number;
  /** Recorded causes naming this line. Empty = none recorded — not "unknown", RECORDED NONE. */
  causes: Cause[];
}

export interface SummaryDelta {
  old: number;
  new: number;
  delta: number;
}

export interface RevisionDiff {
  from: { boq_id: string; created_at: string; draft: boolean };
  to: { boq_id: string; created_at: string; draft: boolean };
  /** Every line that moved, in BoQ order of the `to` revision (removed lines after their section's survivors). */
  lines: DiffLine[];
  unchanged: number;
  summary: {
    subtotal: SummaryDelta;
    ohp: SummaryDelta;
    contingency: SummaryDelta;
    vat: SummaryDelta;
    grand: SummaryDelta;
    delta_pct: number | null;
  };
  /** Causes recorded in the window that name no line (plan edits, decisions, the generation itself). */
  window_causes: Cause[];
  counts: { moved: number; added: number; removed: number; with_cause: number };
  /** The draft watermark is dropping between the two (derived → measured). */
  watermark_drops: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.trim().toLowerCase();

function causesFor(line: RevisionLine, recorded: readonly RecordedCause[]): Cause[] {
  const out: Cause[] = [];
  for (const c of recorded) {
    if (c.revision_level) continue;
    const byKey = line.item_key != null && (c.item_keys ?? []).includes(line.item_key);
    const byDesc = (c.descriptions ?? []).some((d) => norm(d) === norm(line.description));
    if (byKey || byDesc) out.push({ kind: c.kind, at: c.at, summary: c.summary });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

function inWindow(c: RecordedCause, from: string, to: string): boolean {
  // (from, to]: a record made at exactly the earlier revision's instant belongs to
  // it, not to the movement after it.
  return c.at > from && c.at <= to;
}

export function diffRevisions(before: RevisionSnapshot, after: RevisionSnapshot, recorded: readonly RecordedCause[] = []): RevisionDiff {
  const window = recorded.filter((c) => inWindow(c, before.created_at, after.created_at));
  const a = new Map(before.lines.map((l) => [l.key, l]));
  const b = new Map(after.lines.map((l) => [l.key, l]));
  const lines: DiffLine[] = [];
  let unchanged = 0;

  const emit = (o: RevisionLine | null, n: RevisionLine | null) => {
    const ref = (n ?? o)!;
    const oq = o?.quantity ?? 0;
    const nq = n?.quantity ?? 0;
    const cls: DiffClass = !o ? "added" : !n ? "removed" : o.quantity !== n.quantity && o.rate_aed !== n.rate_aed ? "both" : o.quantity !== n.quantity ? "quantity" : "rate";
    lines.push({
      key: ref.key,
      section: ref.section,
      description: ref.description,
      unit: ref.unit,
      item_key: ref.item_key ?? o?.item_key ?? null,
      class: cls,
      old: o,
      new: n,
      delta_qty: r2(nq - oq),
      delta_pct: o && o.quantity ? r2(((nq - oq) / o.quantity) * 100) : null,
      delta_rate_aed: r2((n?.rate_aed ?? 0) - (o?.rate_aed ?? 0)),
      delta_aed: r2((n?.total_aed ?? 0) - (o?.total_aed ?? 0)),
      causes: causesFor(ref, window),
    });
  };

  // `to` order first; removed lines follow the last survivor of their section.
  const sectionsInOrder = [...new Set([...after.lines.map((l) => l.section), ...before.lines.map((l) => l.section)])];
  for (const section of sectionsInOrder) {
    for (const n of after.lines.filter((l) => l.section === section)) {
      const o = a.get(n.key) ?? null;
      if (o && o.quantity === n.quantity && o.rate_aed === n.rate_aed && o.total_aed === n.total_aed) {
        unchanged++;
        continue;
      }
      emit(o, n);
    }
    for (const o of before.lines.filter((l) => l.section === section)) if (!b.has(o.key)) emit(o, null);
  }

  const sd = (o: number, n: number): SummaryDelta => ({ old: o, new: n, delta: r2(n - o) });
  const grand = sd(before.summary.grand_total_aed, after.summary.grand_total_aed);
  return {
    from: { boq_id: before.boq_id, created_at: before.created_at, draft: before.draft },
    to: { boq_id: after.boq_id, created_at: after.created_at, draft: after.draft },
    lines,
    unchanged,
    summary: {
      subtotal: sd(before.summary.subtotal_aed, after.summary.subtotal_aed),
      ohp: sd(before.summary.ohp_aed, after.summary.ohp_aed),
      contingency: sd(before.summary.contingency_aed, after.summary.contingency_aed),
      vat: sd(before.summary.vat_aed, after.summary.vat_aed),
      grand,
      delta_pct: before.summary.grand_total_aed ? r2((grand.delta / before.summary.grand_total_aed) * 100) : null,
    },
    window_causes: window
      .filter((c) => c.revision_level || (!(c.item_keys?.length) && !(c.descriptions?.length)))
      .map((c) => ({ kind: c.kind, at: c.at, summary: c.summary }))
      .sort((x, y) => x.at.localeCompare(y.at)),
    counts: {
      moved: lines.filter((l) => l.class !== "added" && l.class !== "removed").length,
      added: lines.filter((l) => l.class === "added").length,
      removed: lines.filter((l) => l.class === "removed").length,
      with_cause: lines.filter((l) => l.causes.length > 0).length,
    },
    watermark_drops: before.draft && !after.draft,
  };
}
