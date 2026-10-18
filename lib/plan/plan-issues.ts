// =============================================================================
// lib/plan/plan-issues.ts — the plan rules as the Issues navigator's list
// (K11 #3 shape; 15 Oct). PURE.
//
// Three groups, in the order a person fixes them: what BLOCKS REGENERATE (an
// unnamed room), what is NOT ALLOWED (hard rules: an opening that needs a wall,
// does not fit, overlaps, an archway onto nothing …), what to CHECK — OR KEEP
// ANYWAY (soft rules). A kept soft rule is not an issue any more. Each row
// selects its room or opening on 01 Plan (`lineKey` "room:<id>" / "opening:<id>");
// a soft row also offers "Keep anyway". Merged with the step's own reason, so
// the navigator never disagrees with the rail.
// =============================================================================

import { GROUP_TITLE, type IssueGroup, type IssueList, type IssueRow } from "@/lib/boq/issues";

import type { Violation } from "./plan-rules";

export const subjectKey = (v: Pick<Violation, "room_id" | "opening_id">) => (v.opening_id ? `opening:${v.opening_id}` : v.room_id ? `room:${v.room_id}` : null);

export function planRuleIssues(violations: readonly Violation[], step: IssueList | null = null): IssueList {
  const open = violations.filter((v) => !v.kept);
  const row = (v: Violation, i: number): IssueRow => ({
    id: `${v.rule}:${subjectKey(v) ?? i}`,
    ref: `R${v.n}`,
    title: v.message,
    detail: null,
    action: "Show",
    lineKey: subjectKey(v),
    open: null,
    href: null,
    ...(v.severity === "soft" ? { actions: [{ key: "show" as const, label: "Show" }, { key: "keep" as const, label: "Keep anyway" }] } : {}),
  });
  const group = (key: IssueGroup["key"], list: Violation[]): IssueGroup[] => (list.length ? [{ key, title: GROUP_TITLE[key], count: list.length, rows: list.map(row) }] : []);
  const groups: IssueGroup[] = [
    ...group("plan_blocks", open.filter((v) => v.severity === "blocks")),
    ...group("plan_hard", open.filter((v) => v.severity === "hard")),
    ...group("plan_soft", open.filter((v) => v.severity === "soft")),
    ...(step?.groups ?? []),
  ];
  return { groups, count: groups.reduce((n, g) => n + g.count, 0), lineKeys: open.map(subjectKey).filter((k): k is string => !!k) };
}
