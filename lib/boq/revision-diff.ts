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
import { lineTotal, money2 } from "./money";
import { sortSections } from "./section-order";
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
  /** The engine that produced the revision (H7 reads its version). */
  engine?: { version?: string } | null;
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
  /** The stored engine version; null for a document that carries none. */
  engine_version: string | null;
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
    engine_version: typeof boq.engine?.version === "string" ? boq.engine.version : null,
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
  /** K11 #4: the stable line keys a record names exactly (an applied correction). */
  line_keys?: string[];
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
    const byLine = (c.line_keys ?? []).includes(line.key);
    if (byKey || byDesc || byLine) out.push({ kind: c.kind, at: c.at, summary: c.summary });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The first engine version that prices to the fils (lib/boq/rules.ts ENGINE_VERSION). */
export const H7_ENGINE_VERSION = "0.3.0";

const semver = (v: string | null): number[] => (v ?? "0").split(".").map((x) => Number.parseInt(x, 10) || 0);
/** Is version `v` (null = unrecorded = oldest) before `target`? */
const versionBefore = (v: string | null, target: string) => {
  const [a = 0, b = 0, c = 0] = semver(v);
  const [x = 0, y = 0, z = 0] = semver(target);
  return a !== x ? a < x : b !== y ? b < y : c < z;
};
const before3 = (v: string | null) => versionBefore(v, H7_ENGINE_VERSION);

/** C1: the first engine version that prices glazing from the plan, not from the reference villa's order. */
export const C1_ENGINE_VERSION = "0.4.0";
export const C1_REMOVED_CAUSE = "Removed reference-project glazing lines (defect, C1)";
export const C1_ADDED_CAUSE = "Glazing priced from this plan's windows and doors (C1)";
/** How a removed reference-order line reads in the diff: its amount and cause stay, its room and item text do not. */
export const C1_REMOVED_LABEL = "Reference-project glazing line (removed)";
const C1_GLAZING_KEYS = new Set(["alum.window", "alum.external_door"]);
/** The S6-pre lines that share the section and are NOT the reference order (shower glass, mirrors). */
const NOT_THE_ORDER = /^(Frameless shower glass|Bathroom mirror)/i;

/**
 * C1: a line's movement is the glazing fix — and named so — only when the
 * RECORDS say so: the two revisions' stored engine versions straddle 0.4.0,
 * and the line is either an Aluminum & Glass line of the reference order that
 * the later revision no longer has, or a glazing line (alum.window /
 * alum.external_door) the earlier one did not have. Anything else keeps
 * whatever cause a record gives it, or none.
 */
export function c1GlazingCause(beforeVersion: string | null, afterVersion: string | null, o: RevisionLine | null, n: RevisionLine | null): string | null {
  if (!(versionBefore(beforeVersion, C1_ENGINE_VERSION) && !versionBefore(afterVersion, C1_ENGINE_VERSION))) return null;
  if (o && !n && /^alumin/i.test(o.section) && !NOT_THE_ORDER.test(o.description) && !C1_GLAZING_KEYS.has(o.item_key ?? "")) return C1_REMOVED_CAUSE;
  if (!o && n && C1_GLAZING_KEYS.has(n.item_key ?? "")) return C1_ADDED_CAUSE;
  return null;
}

/** K10: was this revision priced before the H7 rounding? (No engine version recorded = yes.) */
export const predatesRounding = (version: string | null | undefined): boolean => !version || before3(version);

/**
 * H7: a line's movement is the H7 rounding — and named so — only when the
 * RECORDS say so: the two revisions' stored engine versions straddle 0.3.0,
 * the quantity is unchanged, the new rate is the old rate to 2 dp, the new
 * total is quantity × that rate to the fils, and the move is no larger than
 * rounding can make it (whole-dirham rounding of the total ≤ 0.50, plus the
 * rate's third and fourth decimals × the quantity). Anything else keeps
 * whatever cause a record gives it, or none.
 */
export function isH7Rounding(beforeVersion: string | null, afterVersion: string | null, o: RevisionLine, n: RevisionLine): boolean {
  if (!(before3(beforeVersion) && !before3(afterVersion))) return false;
  if (o.quantity !== n.quantity) return false;
  if (n.rate_aed !== money2(o.rate_aed)) return false;
  if (n.total_aed !== lineTotal(n.quantity, n.rate_aed)) return false;
  const bound = 0.5 + Math.abs(n.quantity) * Math.abs(o.rate_aed - n.rate_aed) + 0.01;
  return Math.abs(n.total_aed - o.total_aed) <= bound;
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

  let c1Removed = 0;
  const emit = (o: RevisionLine | null, n: RevisionLine | null) => {
    const ref = (n ?? o)!;
    const oq = o?.quantity ?? 0;
    const nq = n?.quantity ?? 0;
    const cls: DiffClass = !o ? "added" : !n ? "removed" : o.quantity !== n.quantity && o.rate_aed !== n.rate_aed ? "both" : o.quantity !== n.quantity ? "quantity" : o.rate_aed !== n.rate_aed ? "rate" : "total";
    const rounding = !!o && !!n && isH7Rounding(before.engine_version, after.engine_version, o, n);
    const c1 = c1GlazingCause(before.engine_version, after.engine_version, o, n);
    // C1: a removed reference-order line is shown with its amount and its cause,
    // never with the reference project's room or item text (nor in its key).
    const masked = c1 === C1_REMOVED_CAUSE;
    const shown = masked ? { ...o!, key: `${o!.section}|c1-removed-${++c1Removed}`, description: C1_REMOVED_LABEL, item_key: null } : null;
    lines.push({
      key: masked ? shown!.key : ref.key,
      section: ref.section,
      description: masked ? C1_REMOVED_LABEL : ref.description,
      unit: ref.unit,
      item_key: masked ? null : ref.item_key ?? o?.item_key ?? null,
      class: cls,
      old: masked ? shown : o,
      new: n,
      delta_qty: r2(nq - oq),
      delta_pct: o && o.quantity ? r2(((nq - oq) / o.quantity) * 100) : null,
      delta_rate_aed: r2((n?.rate_aed ?? 0) - (o?.rate_aed ?? 0)),
      delta_aed: r2((n?.total_aed ?? 0) - (o?.total_aed ?? 0)),
      causes: [
        ...causesFor(ref, window),
        ...(rounding
          ? [{ kind: "engine_rounding" as const, at: after.created_at, summary: `H7 rounding — rate to 2 dp, total = quantity × rate to the fils (engine ${before.engine_version ?? "pre-0.3"} → ${after.engine_version})` }]
          : []),
        ...(c1 ? [{ kind: "engine_change" as const, at: after.created_at, summary: c1 }] : []),
      ],
    });
  };

  // `to` order first; removed lines follow the last survivor of their section.
  // H7: sections in THE canonical order (stable: a section the order does not
  // name keeps its `to`-then-`from` position after the named ones).
  const sectionsInOrder = sortSections([...new Set([...after.lines.map((l) => l.section), ...before.lines.map((l) => l.section)])].map((work_section) => ({ work_section }))).map((s) => s.work_section);
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
      .filter((c) => c.revision_level || (!(c.item_keys?.length) && !(c.descriptions?.length) && !(c.line_keys?.length)))
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
