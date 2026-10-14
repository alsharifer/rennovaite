"use client";

// =============================================================================
// components/blueprint/intake/ReadingPlan.tsx — "Reading your plan" (K8 #12,
// spec §6.8, Figma 63:4510). Replaces the intake's "Reading your plan…" label
// (and, before K5, an infinite spinner) with the parse's REAL stages:
//
//   Uploaded            — done: the plan is stored with the project
//   Finding rooms       } one model pass (/api/parse-plan's provider.parse):
//   Measuring walls …   } both in progress together, both done on its answer
//   Checking overlaps   — the deterministic repair + the plan check, done with
//                         the answer (its pairs counted by the route)
//
// The list is aria-live="polite". Past three minutes the wait is the inverse
// block "This is taking longer than usual" with Open plan (the plan page shows
// where the parse got to, and re-runs it — re-posting here could insert the
// rooms twice). A failed parse opens the plan, whose parse-failure state
// (24:814) says what to do. Done → the plan opens.
// =============================================================================

import { startOpeningsDetection } from "@/components/blueprint/plan/OpeningsAutoDetect";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AnalyticsEvent, track } from "@/lib/analytics";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { StateBlock } from "../StateBlock";

type Answer = { rooms: number; statedAreas: number | null; overlapPairs: number | null };
type Phase = { kind: "reading" } | { kind: "done"; answer: Answer } | { kind: "failed" };

const SLOW_MS = 3 * 60 * 1000;
const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;

function Stage({ state, title, detail }: { state: "done" | "active" | "next"; title: string; detail: string }) {
  const label = state === "done" ? "DONE" : state === "active" ? "IN PROGRESS" : "NEXT";
  return (
    <li className="flex items-start gap-4 border-b border-bp-line-hairline py-4" data-stage={state}>
      <span className="mt-0.5 shrink-0 text-bp-ink-primary">
        {state === "done" ? <Icon name="check" className="text-[20px]" /> : state === "active" ? <Icon name="progress_activity" className="text-[20px] motion-safe:animate-spin" /> : <Icon name="radio_button_unchecked" className="text-[20px] text-bp-ink-tertiary" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`t-nav-item-active block ${state === "next" ? "text-bp-ink-secondary" : "text-bp-ink-primary"}`}>{title}</span>
        <span className="t-body-sm mt-0.5 block text-bp-ink-secondary">{detail}</span>
      </span>
      <span className="t-label-caps shrink-0 text-bp-ink-tertiary">{label}</span>
    </li>
  );
}

export function ReadingPlan({ projectId, planId, subtitle, eyebrow, slowAfterMs = SLOW_MS }: { projectId: string; planId: string; subtitle: string; eyebrow: string; /** The dev sandbox shows the slow state without waiting three minutes. */ slowAfterMs?: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });
  const [slow, setSlow] = useState(false);
  const started = useRef(false);
  const planHref = `/project/${projectId}/plan`;

  useEffect(() => {
    if (started.current) return; // one parse per mount, StrictMode included
    started.current = true;
    const timer = window.setTimeout(() => setSlow(true), slowAfterMs);
    (async () => {
      try {
        const r = await fetch("/api/parse-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: planId }) });
        const b = (await r.json().catch(() => null)) as { success?: boolean; rooms?: number; stated_areas?: number; overlap_pairs?: number } | null;
        window.clearTimeout(timer);
        if (!r.ok || !b?.success) {
          setPhase({ kind: "failed" });
          router.push(planHref);
          return;
        }
        track(AnalyticsEvent.PlanParsed, { project_id: projectId });
        // R10b: the plan is read — look for its windows and doors (the Plan page shows the run).
        startOpeningsDetection(planId);
        setPhase({ kind: "done", answer: { rooms: b.rooms ?? 0, statedAreas: b.stated_areas ?? null, overlapPairs: b.overlap_pairs ?? null } });
        window.setTimeout(() => router.push(planHref), 1200);
      } catch {
        window.clearTimeout(timer);
        setPhase({ kind: "failed" });
        router.push(planHref);
      }
    })();
  }, [planId, planHref, projectId, router, slowAfterMs]);

  const done = phase.kind === "done" ? phase.answer : null;
  const reading = phase.kind === "reading";

  return (
    <div data-reading-plan>
      <p className="t-label-caps text-bp-brass-text">{eyebrow}</p>
      <h1 className="t-display-serif mt-3 text-bp-ink-primary">Reading your plan</h1>
      <p className="t-body-md mt-3 text-bp-ink-secondary">{subtitle}</p>

      <ol className="mt-8 max-w-[720px] border-t border-bp-line-hairline" aria-live="polite" aria-label="Reading your plan">
        <Stage state="done" title="Uploaded" detail="Saved to your project." />
        <Stage state={done ? "done" : reading ? "active" : "next"} title="Finding rooms" detail={done ? `${n(done.rooms, "room")} found` : "Reading the rooms and their names off the drawing."} />
        <Stage
          state={done ? "done" : reading ? "active" : "next"}
          title="Measuring walls and openings"
          detail={done && done.statedAreas != null ? `Printed dimensions win over what we measure — ${done.statedAreas} of ${n(done.rooms, "room")} kept the area the drawing states.` : "Printed dimensions win over what we measure."}
        />
        <Stage
          state={done ? "done" : "next"}
          title="Checking for overlaps"
          detail={done && done.overlapPairs != null ? (done.overlapPairs === 0 ? "No rooms overlap." : `${n(done.overlapPairs, "pair")} of rooms overlap — you’ll fix them on the plan before costing.`) : "If two rooms overlap you’ll fix them on the plan before costing."}
        />
      </ol>

      {slow && reading ? (
        <div className="mt-8 max-w-[720px]">
          <StateBlock kind="error" title="This is taking longer than usual" actions={<Button kind="secondary" tone="inverse" href={planHref}>Open plan</Button>}>
            <p>Reading a plan usually takes about a minute. Open the plan to see where it got to — you can run the reading again from there.</p>
          </StateBlock>
        </div>
      ) : (
        <p className="t-body-sm mt-8 flex max-w-[720px] items-center gap-3 bg-bp-surface-sunken px-4 py-3 text-bp-ink-secondary">
          <Icon name="schedule" className="text-[20px]" />
          {done ? "Done — opening your plan." : "Usually about a minute. Keep this page open — the plan opens when it’s ready."}
        </p>
      )}

      {slow && reading ? null : (
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button kind="primary" href={done ? planHref : undefined} disabled={done ? false : { reason: "The plan opens when the reading is done", reasonId: "open-plan-why", showReason: true }}>
          Open plan
        </Button>
      </div>
      )}
    </div>
  );
}
