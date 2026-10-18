// =============================================================================
// lib/boq/revisions-view.ts — Revisions & Approval, as the screen reads it
// (K4, R7 §3.5, Figma 21:450). SERVER-ONLY: tierOf() reaches the provenance
// module.
//
// One diff object (U4's buildProjectRevisionDiff) → one client-safe view: the
// revision picker labels ("rev 2 · 19 Sep 2026 · 04:57"), the summary chain A /
// B / Δ, every moved line with its marks and its RECORDED causes (or "none
// recorded" — never a story), the reconciliation sentence, the window events no
// line names, and the approval trail of the later revision. Member identities
// never leave the server (approved_by is dropped here).
// =============================================================================

import { approvalLabel } from "@/lib/boq/approval-label";
import type { DiffLine } from "@/lib/boq/revision-diff";
import { CAUSE_KIND_LABEL, DIFF_CLASS_LABEL, type CauseKind, type DiffClass } from "@/lib/boq/revision-diff-types";
import type { ProjectRevisionDiff, RevisionSummary } from "@/lib/boq/revisions";
import { sumMoney } from "@/lib/boq/money";
import { formatAED, formatDelta } from "@/lib/format/aed";
import type { ProvLine } from "@/lib/provenance/boq";
import { tierOf, type ProvTier } from "@/lib/provenance/tier";

export interface RevisionOption {
  boqId: string;
  rev: number;
  label: string;
  total: number;
  draft: boolean;
  approved: boolean;
}

export interface ChainRow {
  key: "subtotal" | "ohp" | "contingency" | "vat" | "total";
  label: string;
  old: number | null;
  new: number | null;
  delta: number;
}

export interface ViewCause {
  kind: CauseKind;
  label: string;
  day: string;
  summary: string;
  href: string | null;
}

export interface ViewLine {
  key: string;
  ref: string;
  section: string;
  description: string;
  unit: string;
  cls: DiffClass;
  classLabel: string;
  qty: { old: number | null; new: number | null; tier: ProvTier };
  rate: { old: number | null; new: number | null; tier: ProvTier };
  amount: { old: number | null; new: number | null; tier: ProvTier };
  delta: number;
  causes: ViewCause[];
}

export interface WindowEvent {
  time: string;
  kind: string;
  summary: string;
}

export interface ApprovalRow {
  id: string;
  kind: "firm" | "client";
  label: string;
  note: string | null;
}

export interface RevisionsView {
  projectId: string;
  revisions: RevisionOption[];
  from: RevisionOption;
  to: RevisionOption;
  chain: ChainRow[];
  totalDeltaPct: number | null;
  counts: { changed: number; unchanged: number; added: number; removed: number; withCause: number };
  /** "all 6 on quantity" / "4 on quantity · 2 on rate". */
  classSummary: string;
  lines: ViewLine[];
  reconciliation: string;
  window: WindowEvent[];
  approvals: ApprovalRow[];
  watermarkDrops: boolean;
  pdfHref: string;
}

const TZ = "Asia/Dubai";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });

/** Revisions numbered oldest = rev 1 (the rail's convention: rev N = the N-th BoQ). */
export function revisionOptions(revisions: readonly RevisionSummary[]): RevisionOption[] {
  const n = revisions.length;
  return revisions.map((r, i) => ({
    boqId: r.boq_id,
    rev: n - i,
    label: `rev ${n - i} · ${dayOf(r.created_at)} · ${timeOf(r.created_at)}`,
    total: r.grand_total_aed,
    draft: r.draft,
    approved: !!r.approvals.firm,
  }));
}

/** Where a recorded cause can be looked at — the record's own page. */
function causeHref(projectId: string, kind: CauseKind): string | null {
  if (kind === "firm_rate") return `/project/${projectId}/rates`;
  if (kind === "correction" || kind === "applied_correction" || kind === "reverted_correction") return `/project/${projectId}/boq`;
  if (kind === "plan_edit" || kind === "scope_change" || kind === "openings_confirmed" || kind === "openings_need_wall" || kind === "session_decision") return `/project/${projectId}/plan`;
  return null;
}

const CLASS_WORD: Record<DiffClass, string> = { quantity: "on quantity", rate: "on rate", both: "on quantity and rate", total: "on rounding", added: "added", removed: "removed" };

export function classSummary(lines: readonly { class: DiffClass }[]): string {
  const moved = lines.filter((l) => l.class !== "added" && l.class !== "removed");
  if (moved.length === 0) return "";
  const by = new Map<DiffClass, number>();
  for (const l of moved) by.set(l.class, (by.get(l.class) ?? 0) + 1);
  if (by.size === 1) return `all ${moved.length} ${CLASS_WORD[moved[0]!.class]}`;
  return [...by.entries()].map(([c, k]) => `${k} ${CLASS_WORD[c]}`).join(" · ");
}

/**
 * The sentence under the lines table: Σ of the line deltas against Δ of the
 * counted subtotal. It says when they agree and NAMES the difference when they
 * do not — the screen never asserts a reconciliation it did not do.
 */
export function reconciliation(deltas: readonly number[], subtotalDelta: number, hasOhp: boolean): string {
  if (deltas.length === 0) return subtotalDelta === 0 ? "No line moved, and the counted subtotal is unchanged." : `No line moved, but the counted subtotal moved ${formatDelta(subtotalDelta)}.`;
  const sum = sumMoney(deltas);
  const terms = deltas.length <= 8 ? deltas.map((d, i) => (i === 0 ? formatDelta(d) : `${d < 0 ? "−" : "+"} ${formatAED(Math.abs(d))}`)).join(" ") : `Σ of ${deltas.length} line changes`;
  const markups = `${hasOhp ? "OH&P, " : ""}contingency and VAT follow on the subtotal, each rounded once to the fil (H7).`;
  if (sum === subtotalDelta) return `${terms} = ${formatDelta(sum)} = Δ counted subtotal · ${markups}`;
  return `${terms} = ${formatDelta(sum)}, but the counted subtotal moved ${formatDelta(subtotalDelta)} — ${formatDelta(sumMoney([subtotalDelta, -sum]))} is not explained by a line.`;
}

function storedLine(doc: ProjectRevisionDiff["before"], section: string, index: number): ProvLine | null {
  const s = doc.boq.sections.find((x) => x.work_section === section);
  return (s?.lines[index] as ProvLine | undefined) ?? null;
}

export function buildRevisionsView(projectId: string, revisions: readonly RevisionSummary[], result: ProjectRevisionDiff): RevisionsView {
  const options = revisionOptions(revisions);
  const { diff, before, after } = result;
  const opt = (id: string, created: string): RevisionOption => options.find((o) => o.boqId === id) ?? { boqId: id, rev: 0, label: `${dayOf(created)} · ${timeOf(created)}`, total: 0, draft: false, approved: false };
  const from = opt(before.boq_id, before.created_at);
  const to = opt(after.boq_id, after.created_at);
  const ctx = result.tierCtx;

  const s = diff.summary;
  const pct = (n: number | undefined) => (n == null ? "" : ` ${n}%`);
  const hasOhp = s.ohp.old !== 0 || s.ohp.new !== 0;
  const chain: ChainRow[] = [
    { key: "subtotal", label: "Counted subtotal", old: s.subtotal.old, new: s.subtotal.new, delta: s.subtotal.delta },
    hasOhp
      ? { key: "ohp", label: `OH&P${pct(after.boq.ohp_pct ?? before.boq.ohp_pct)}`, old: s.ohp.old, new: s.ohp.new, delta: s.ohp.delta }
      : { key: "ohp", label: "OH&P", old: null, new: null, delta: 0 },
    { key: "contingency", label: `Contingency${pct(after.boq.contingency_pct)}`, old: s.contingency.old, new: s.contingency.new, delta: s.contingency.delta },
    { key: "vat", label: `VAT${pct(after.boq.vat_pct)}`, old: s.vat.old, new: s.vat.new, delta: s.vat.delta },
    { key: "total", label: "Project total", old: s.grand.old, new: s.grand.new, delta: s.grand.delta },
  ];

  const lines: ViewLine[] = diff.lines.map((l: DiffLine) => {
    const oldStored = l.old ? storedLine(before, l.section, l.old.index) : null;
    const newStored = l.new ? storedLine(after, l.section, l.new.index) : null;
    const tOld = oldStored ? tierOf(oldStored, l.section, ctx) : null;
    const tNew = newStored ? tierOf(newStored, l.section, ctx) : null;
    const t = tNew ?? tOld!;
    const ref = l.new ? after.refs[`${l.section}-${l.new.index}`] ?? "" : `${before.refs[`${l.section}-${l.old!.index}`] ?? ""}†`;
    return {
      key: l.key,
      ref,
      section: l.section,
      description: l.description,
      unit: l.unit,
      cls: l.class,
      classLabel: DIFF_CLASS_LABEL[l.class],
      qty: { old: l.old?.quantity ?? null, new: l.new?.quantity ?? null, tier: t.qty },
      rate: { old: l.old?.rate_aed ?? null, new: l.new?.rate_aed ?? null, tier: t.rate },
      amount: { old: l.old?.total_aed ?? null, new: l.new?.total_aed ?? null, tier: t.amount },
      delta: l.delta_aed,
      causes: l.causes.map((c) => ({ kind: c.kind, label: CAUSE_KIND_LABEL[c.kind], day: dayOf(c.at), summary: c.summary, href: causeHref(projectId, c.kind) })),
    };
  });

  return {
    projectId,
    revisions: options,
    from,
    to,
    chain,
    totalDeltaPct: s.delta_pct,
    counts: { changed: diff.counts.moved, unchanged: diff.unchanged, added: diff.counts.added, removed: diff.counts.removed, withCause: diff.counts.with_cause },
    classSummary: classSummary(diff.lines),
    lines,
    reconciliation: reconciliation(
      diff.lines.map((l) => l.delta_aed),
      s.subtotal.delta,
      hasOhp,
    ),
    window: diff.window_causes.map((c) => ({ time: `${dayOf(c.at)} · ${timeOf(c.at)}`, kind: CAUSE_KIND_LABEL[c.kind], summary: c.summary })),
    approvals: result.approvals.after.trail.map((a) => ({ id: a.id, kind: a.kind, label: approvalLabel(a), note: a.note })),
    watermarkDrops: diff.watermark_drops,
    pdfHref: `/api/projects/${projectId}/boq-diff?from=${before.boq_id}&to=${after.boq_id}&format=pdf`,
  };
}
