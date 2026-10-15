"use client";

// =============================================================================
// components/blueprint/plan/PlanRules.tsx — the plan rules on 01 Plan (15 Oct).
//
// Two views of ONE list (lib/plan/plan-rules.ts → lib/plan/plan-issues.ts), no
// new screen: the top bar's "⚑ N TO FIX" (the K11 Issues navigator, with the
// step's own reason merged in) and a "PLAN RULES" block in the plan check
// column. A row selects its room (Plan layer) or opening (Openings layer); a
// soft rule offers "Keep anyway" (POST /api/plan-rules/keep → spec.kept_rules),
// and a kept one can be taken back. Hard rules are fixed on the plan — the
// editor refuses to make a new one.
// =============================================================================

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { IssueList, IssueRow } from "@/lib/boq/issues";
import type { Violation } from "@/lib/plan/plan-rules";
import { subjectKey } from "@/lib/plan/plan-issues";

import { Icon } from "../Icon";
import { IssuesNavigator } from "../shell/IssuesNavigator";
import { TopBarActions } from "../shell/TopBar";
import { OPENINGS_FOCUS_EVENT } from "./OpeningsCheckPanel";
import { PLAN_SELECT_ROOMS_EVENT } from "./PlanCheckPanel";

function show(key: string | null) {
  if (!key) return;
  const [kind, id] = key.split(":");
  if (kind === "opening") window.dispatchEvent(new CustomEvent(OPENINGS_FOCUS_EVENT, { detail: { id } }));
  else if (kind === "room") window.dispatchEvent(new CustomEvent(PLAN_SELECT_ROOMS_EVENT, { detail: { ids: [id] } }));
}

function useKeep(planId: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const keep = async (v: Pick<Violation, "rule" | "room_id" | "opening_id">, on = true) => {
    setError(null);
    const res = await fetch("/api/plan-rules/keep", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: planId, rule: v.rule, ...(v.opening_id ? { opening_id: v.opening_id } : { room_id: v.room_id }), keep: on }),
    });
    if (!res.ok) {
      setError("Could not record that — try again.");
      return;
    }
    router.refresh();
  };
  return { keep, error };
}

/** The top bar's "⚑ N TO FIX" for 01 Plan. */
export function PlanRulesNavigator({ planId, issues, violations }: { planId: string; issues: IssueList; violations: Violation[] }) {
  const { keep } = useKeep(planId);
  const byRow = (row: IssueRow) => violations.find((v) => `${v.rule}:${subjectKey(v)}` === row.id) ?? null;
  return (
    <TopBarActions>
      <IssuesNavigator
        issues={issues}
        onRow={(row) => show(row.lineKey)}
        onAction={(row, action) => {
          if (action === "show") show(row.lineKey);
          if (action === "keep") {
            const v = byRow(row);
            if (v) void keep(v);
          }
        }}
      />
    </TopBarActions>
  );
}

const SEVERITY_LABEL: Record<Violation["severity"], string> = { blocks: "BLOCKS REGENERATE", hard: "NOT ALLOWED", soft: "CHECK" };

/** The "PLAN RULES" block in the plan check column. */
export function PlanRulesPanel({ planId, violations }: { planId: string; violations: Violation[] }) {
  const { keep, error } = useKeep(planId);
  const open = violations.filter((v) => !v.kept);
  const kept = violations.filter((v) => v.kept);
  if (violations.length === 0) return null;
  return (
    <section className="border border-bp-line-strong bg-bp-surface-raised p-5" aria-labelledby="plan-rules-h" data-plan-rules={open.length}>
      <h2 id="plan-rules-h" className="t-label-caps flex items-center gap-2 text-bp-ink-primary">
        <Icon name="flag" size={18} />
        PLAN RULES · {open.length}
      </h2>
      <ul className="mt-2">
        {open.map((v, i) => (
          <li key={`${v.rule}:${subjectKey(v) ?? i}`} className="border-b border-bp-line-hairline py-2 last:border-b-0" data-plan-rule={v.rule} data-severity={v.severity}>
            <p className="t-label-caps text-bp-ink-tertiary">
              R{v.n} · {SEVERITY_LABEL[v.severity]}
            </p>
            <p className="t-body-sm mt-1 text-bp-ink-primary">{v.message}</p>
            <span className="mt-1 flex gap-5">
              {subjectKey(v) ? (
                <button type="button" onClick={() => show(subjectKey(v))} className="t-nav-item-active text-bp-ink-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring">
                  Show
                </button>
              ) : null}
              {v.severity === "soft" ? (
                <button type="button" onClick={() => void keep(v)} className="t-nav-item-active text-bp-ink-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring" data-keep-anyway="">
                  Keep anyway
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {kept.length ? (
        <details className="mt-3">
          <summary className="t-label-md cursor-pointer text-bp-ink-secondary">Kept anyway · {kept.length}</summary>
          <ul className="mt-1">
            {kept.map((v, i) => (
              <li key={`${v.rule}:${subjectKey(v) ?? i}`} className="t-body-sm flex items-start justify-between gap-3 py-1 text-bp-ink-secondary">
                <span>{v.message}</span>
                <button type="button" onClick={() => void keep(v, false)} className="t-label-md shrink-0 text-bp-ink-primary underline-offset-2 hover:underline">
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {error ? (
        <p role="alert" className="t-body-sm mt-2 text-bp-ink-primary">
          {error}
        </p>
      ) : null}
    </section>
  );
}
