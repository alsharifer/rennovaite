// =============================================================================
// lib/boq/issues.ts — the Issues navigator's list (K11 #3, spec §7.1, Figma
// 80:49). CLIENT-SAFE and pure: it reads the BoQ & Review model the server
// built and the rail's StepStatus — never a rule of its own.
//
//   NOT PRICED — LEFT OUT OF THE TOTAL   every excluded line (isUnpricedLine —
//                                       the same lines the rail counts as
//                                       "N items not priced"), action Add a price
//   POSSIBLY COUNTED TWICE              the component-dedupe findings
//   DERIVED — CONFIRM ON SITE           ONE row for every line whose quantity
//                                       is derived (confirm on a site visit)
//   RATE BASIS                          the reference-basis gate, while open
//   <the step's own reason>             the rail's attention / blocked reason
//                                       for this step (plan check, changed
//                                       since rev N) — the unpriced reason is
//                                       already the first group
//
// N = the rows (the derived group counts once). Groups with 0 are left out;
// N = 0 hides the button.
// =============================================================================

import type { StepStatus } from "@/lib/journey-state";

import type { ReviewModel } from "./review-types";

export type IssueGroupKey = "unmatched" | "unpriced" | "duplicates" | "derived" | "basis" | "step";

export interface IssueRow {
  id: string;
  ref: string | null;
  title: string;
  detail: string | null;
  /** The action's words ("Add a price", "Site visit", the fix's label). */
  action: string;
  /** The line the row selects (null = a link). */
  lineKey: string | null;
  /** What the inspector opens on: the price form, or the line. */
  open: "price" | "line" | null;
  href: string | null;
  /** K11: an applied price that no longer matches a line — Remove / Re-apply to…. */
  correctionId?: string;
  actions?: { key: "release" | "retarget"; label: string }[];
}

export interface IssueGroup {
  key: IssueGroupKey;
  title: string;
  /** Lines in the group (the derived group counts lines, its row counts once). */
  count: number;
  rows: IssueRow[];
}

export interface IssueList {
  groups: IssueGroup[];
  /** The button's N. */
  count: number;
  /** Every line an issue names, in BoQ order — "Show only these lines" and J / Shift+J. */
  lineKeys: string[];
}

export const GROUP_TITLE: Record<IssueGroupKey, string> = {
  unmatched: "YOUR PRICES — NO LONGER MATCHED",
  unpriced: "NOT PRICED — LEFT OUT OF THE TOTAL",
  duplicates: "POSSIBLY COUNTED TWICE",
  derived: "DERIVED — CONFIRM ON SITE",
  basis: "RATE BASIS",
  step: "THIS STEP",
};

/** The rail's own words for the unpriced lines — already the first group, so not repeated as the step's reason. */
const UNPRICED_REASON = /^\d+ items? not priced$/;

export function boqIssues(model: ReviewModel, step: StepStatus | null = null): IssueList {
  const lines = model.sections.flatMap((s) => s.lines);
  const order = new Map(lines.map((l, i) => [l.key, i]));
  const groups: IssueGroup[] = [];

  // K11: a price someone added whose line is gone (or no longer unique) after a regenerate —
  // it prices nothing and is never attached elsewhere; it waits here until removed or re-applied.
  const lost = model.unmatchedPrices ?? [];
  if (lost.length > 0) {
    groups.push({
      key: "unmatched",
      title: GROUP_TITLE.unmatched,
      count: lost.length,
      rows: lost.map((u) => ({
        id: `unmatched:${u.correctionId}`,
        ref: null,
        title: `Your price for ${u.item} no longer matches a line`,
        detail: [`${u.type === "rate" ? "rate" : "quantity"} ${u.value.toLocaleString("en-US", { minimumFractionDigits: u.type === "rate" ? 2 : 0, maximumFractionDigits: 2 })}`, u.basis, u.by ? `added by ${u.by}` : null].filter(Boolean).join(" · "),
        action: "Re-apply to…",
        lineKey: null,
        open: null,
        href: null,
        correctionId: u.correctionId,
        actions: [
          { key: "release", label: "Remove" },
          { key: "retarget", label: "Re-apply to…" },
        ],
      })),
    });
  }

  const unpriced = lines.filter((l) => l.unpriced);
  if (unpriced.length > 0) {
    groups.push({
      key: "unpriced",
      title: GROUP_TITLE.unpriced,
      count: unpriced.length,
      rows: unpriced.map((l) => ({ id: `unpriced:${l.key}`, ref: l.ref, title: l.description, detail: l.unpricedReason, action: "Add a price", lineKey: l.key, open: "price", href: null })),
    });
  }

  const dups = model.notices.duplicates;
  if (dups.length > 0) {
    groups.push({
      key: "duplicates",
      title: GROUP_TITLE.duplicates,
      count: dups.length,
      rows: dups.map((d, i) => {
        const key = d.lineKeys?.find((k) => order.has(k)) ?? null;
        const line = key ? lines[order.get(key)!] : null;
        return { id: `dup:${i}`, ref: line?.ref ?? null, title: d.label, detail: model.persona === "firm" ? d.detail : "We’ll confirm before tender", action: "Review", lineKey: key, open: key ? "line" : null, href: null };
      }),
    });
  }

  const derived = lines.filter((l) => !l.unpriced && l.tiers.qty === "derived");
  if (derived.length > 0) {
    const reference = derived.some((l) => /reference layout/i.test(l.derivedNote ?? ""));
    groups.push({
      key: "derived",
      title: GROUP_TITLE.derived,
      count: derived.length,
      rows: [
        {
          id: "derived",
          ref: `${derived.length} line${derived.length === 1 ? "" : "s"}`,
          title: reference ? "Quantities from the reference layout" : "Quantities inferred, not measured",
          detail: null,
          action: "Site visit",
          lineKey: derived[0]!.key,
          open: "line",
          href: null,
        },
      ],
    });
  }

  const ref = model.notices.reference;
  if (ref && ref.status === "open") {
    groups.push({
      key: "basis",
      title: GROUP_TITLE.basis,
      count: 1,
      rows: [{ id: "basis", ref: null, title: `${ref.referenceLines} of ${ref.totalLines} lines priced from the market reference`, detail: "Review your rates, or accept the market basis for this revision", action: "Review rates", lineKey: null, open: null, href: `/project/${model.projectId}/rates#reference-basis` }],
    });
  }

  if (step && (step.state === "attention" || step.state === "blocked") && step.reason && !UNPRICED_REASON.test(step.reason)) {
    groups.push({
      key: "step",
      title: step.state === "blocked" ? "BLOCKED" : GROUP_TITLE.step,
      count: 1,
      rows: [{ id: "step", ref: null, title: step.reason, detail: null, action: step.fix?.label ?? "Open", lineKey: null, open: null, href: step.fix?.href ?? null }],
    });
  }

  const keys = new Set<string>([...unpriced.map((l) => l.key), ...dups.flatMap((d) => (d.lineKeys ?? []).filter((k) => order.has(k))), ...derived.map((l) => l.key)]);
  return {
    groups,
    count: groups.reduce((n, g) => n + g.rows.length, 0),
    lineKeys: [...keys].sort((a, b) => order.get(a)! - order.get(b)!),
  };
}

/** Any other step page: the rail's reason for it, as one issue (spec §7.1 "and on any step page that has reasons"). */
export function stepIssues(step: StepStatus | null | undefined, stepLabel: string): IssueList {
  if (!step || (step.state !== "attention" && step.state !== "blocked") || !step.reason) return { groups: [], count: 0, lineKeys: [] };
  return {
    groups: [{ key: "step", title: step.state === "blocked" ? `BLOCKED — ${stepLabel.toUpperCase()}` : stepLabel.toUpperCase(), count: 1, rows: [{ id: "step", ref: null, title: step.reason, detail: null, action: step.fix?.label ?? "Open", lineKey: null, open: null, href: step.fix?.href ?? null }] }],
    count: 1,
    lineKeys: [],
  };
}

/** J / Shift+J: the next (or previous) issue line after `current`, wrapping. */
export function nextIssueKey(keys: readonly string[], current: string | null, back = false): string | null {
  if (keys.length === 0) return null;
  const i = current ? keys.indexOf(current) : -1;
  if (i < 0) return back ? keys.at(-1)! : keys[0]!;
  return keys[(i + (back ? -1 : 1) + keys.length) % keys.length]!;
}
