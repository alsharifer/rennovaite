// =============================================================================
// components/blueprint/shell/StepFooter.tsx — the step footer (K11 #2, spec
// §7.2, Figma component 80:944).
//
// Bottom of every journey step page, owner and firm: "← PREVIOUS <step>" (a
// quiet link) · "NEXT <step>" + Secondary "Continue to <step>". When the next
// step is Blocked the button is disabled with the RAIL's reason — the same
// StepStatus the rail draws (lib/journey-state.ts), never a rule of its own.
// The walkthrough had no way from 04 Cost to 05 Timeline.
// =============================================================================

import Link from "next/link";

import { Button } from "../Button";
import { Icon } from "../Icon";
import type { RailStep } from "./StepList";

/** The steps either side of the active one, in journey order. */
export function footerSteps(steps: readonly RailStep[], activeKey: string | null): { previous: RailStep | null; next: RailStep | null } {
  const i = activeKey ? steps.findIndex((s) => s.key === activeKey) : -1;
  if (i < 0) return { previous: null, next: null };
  return { previous: steps[i - 1] ?? null, next: steps[i + 1] ?? null };
}

/** "Continue to timeline" / "Continue to BoQ & review" — plain words lower-cased after the verb; an acronym (BoQ, 3D) keeps its capitals. */
export const continueLabel = (s: RailStep) => `Continue to ${s.label.split(" ").map((w) => (/^[A-Z][a-z]*$/.test(w) ? w.toLowerCase() : w)).join(" ")}`;

export function StepFooter({ steps, activeKey }: { steps: readonly RailStep[]; activeKey: string | null }) {
  const { previous, next } = footerSteps(steps, activeKey);
  if (!previous && !next) return null;
  const blocked = next?.status.state === "blocked";
  const reasonId = "bp-step-footer-next-why";
  return (
    <nav aria-label="Previous and next step" className="bp-step-footer mt-12 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-bp-line-strong px-6 py-3 md:px-8" data-step-footer="">
      {previous ? (
        <Link href={previous.href} className="group flex items-center gap-3 py-1 text-bp-ink-secondary hover:text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring" data-step-previous={previous.key}>
          <Icon name="arrow_back" size={20} />
          <span className="flex flex-col">
            <span className="t-label-caps text-bp-ink-tertiary">PREVIOUS</span>
            <span className="t-body-sm">
              {previous.number} {previous.label}
            </span>
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2" data-step-next={next.key} data-next-state={next.status.state}>
          <span className="flex flex-col text-right">
            <span className="t-label-caps text-bp-ink-tertiary">NEXT</span>
            <span className="t-nav-item-active text-bp-ink-primary">
              {next.number} {next.label}
            </span>
          </span>
          <Button kind="secondary" href={blocked ? undefined : next.href} disabled={blocked ? { reason: next.status.reason ?? "This step is blocked", reasonId } : false} testId="step-footer-continue">
            {continueLabel(next)}
          </Button>
          {blocked ? (
            <p id={reasonId} className="t-label-md w-full text-right text-bp-ink-tertiary" data-step-next-reason="">
              {next.status.reason ?? "This step is blocked"}
              {next.status.fix ? (
                <>
                  {" · "}
                  <Link href={next.status.fix.href} className="text-bp-ink-primary underline underline-offset-2">
                    {next.status.fix.label}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
