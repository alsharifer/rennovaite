// =============================================================================
// components/blueprint/shell/StepList.tsx — the numbered journey (R7 §2 8:132).
//
// One list for the rail (full + compact) and the phone step drawer. Every step
// is a link — a Blocked step stays navigable, because its page explains why.
// The state is in the accessible name, reason included: "08 Proposal —
// blocked: review rates or accept market basis" (spec §2 Journey step).
// Active = aria-current="step" + the brass 2 px left rule + the raised wash.
// =============================================================================

import Link from "next/link";

import type { StepStatus } from "@/lib/journey-state";

import { Icon } from "../Icon";

export interface RailStep {
  key: string;
  number: string;
  label: string;
  href: string;
  status: StepStatus;
}

const ICON: Record<StepStatus["state"], string | null> = { done: "check", attention: "flag", blocked: "lock", available: null };
const SPOKEN: Record<StepStatus["state"], string> = { done: "done", attention: "needs attention", blocked: "blocked", available: "" };

export function stepAccessibleName(s: RailStep): string {
  const head = `${s.number} ${s.label}`;
  const state = SPOKEN[s.status.state];
  if (!state) return head;
  return `${head} — ${state}${s.status.reason ? `: ${s.status.reason.charAt(0).toLowerCase()}${s.status.reason.slice(1)}` : ""}`;
}

export function StepList({ steps, activeKey, onNavigate }: { steps: RailStep[]; activeKey: string | null; onNavigate?: () => void }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s) => {
        const active = s.key === activeKey;
        const blocked = s.status.state === "blocked";
        const icon = ICON[s.status.state];
        return (
          <li key={s.key}>
            <Link
              href={s.href}
              onClick={onNavigate}
              aria-current={active ? "step" : undefined}
              aria-label={stepAccessibleName(s)}
              data-step={s.key}
              data-state={s.status.state}
              {...(active ? { "data-active": "" } : {})}
              className={`bp-step relative flex items-start gap-3 px-6 py-2.5 outline-offset-[-2px] hover:bg-bp-surface-raised ${
                active ? "bg-bp-surface-raised before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-bp-brass" : ""
              }`}
            >
              <span className={`t-label-md pt-0.5 ${active ? "text-bp-brass-text" : "text-bp-ink-tertiary"}`}>{s.number}</span>
              <span className="bp-rail-x min-w-0 flex-1 flex-col">
                <span className={`block ${active ? "t-nav-item-active text-bp-ink-primary" : `t-nav-item ${blocked ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}`}>{s.label}</span>
                {s.status.reason && s.status.state !== "done" ? (
                  <span className="t-label-md mt-0.5 block text-bp-ink-tertiary">{s.status.reason}</span>
                ) : null}
              </span>
              {icon ? <Icon name={icon} className={`pt-0.5 text-[16px] ${blocked ? "text-bp-ink-tertiary" : "text-bp-ink-secondary"}`} /> : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
