"use client";

// =============================================================================
// components/blueprint/plan/PlanCheckPanel.tsx — the plan page's right panel
// (K5, R7 §3.8, Figma 24:814).
//
// A plan with overlapping rooms can't be priced (the BoQ 409 — the same
// detector, lib/plan/plan-check.ts over lib/plan/overlaps.ts). The panel says
// so as the inverse block — how many pairs, how much floor is counted twice,
// what it would do to the price — with the two ways out: Fix overlaps (the
// editor trims shared floor, no room moves, then Save) and Re-run parse (a parsed drawing
// only). The overlaps are listed largest first; choosing one selects BOTH
// rooms on the canvas. Below, what is blocked downstream — the rail's own
// reasons, never a rule of its own.
//
// The panel talks to the editor through two window events (the editor is a
// separate client tree inside PlanLayers): `rv:plan-fix-overlaps` and
// `rv:plan-select-rooms` { ids }.
// =============================================================================

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Coverage } from "@/lib/plan/coverage";
import type { PlanCheckPair } from "@/lib/plan/plan-check";

import { Button } from "../Button";
import { Icon } from "../Icon";

export const PLAN_FIX_OVERLAPS_EVENT = "rv:plan-fix-overlaps";
export const PLAN_SELECT_ROOMS_EVENT = "rv:plan-select-rooms";

export interface PlanCheckPanelProps {
  planId: string;
  pairs: PlanCheckPair[];
  sentence: string | null;
  /** A parsed drawing can be re-parsed; an authored plan cannot. */
  canReparse: boolean;
  /** Downstream steps the plan blocks, with the rail's reason. */
  blocked: { step: string; reason: string }[];
  summary: { rooms: number; area: string; label: string };
  /** 15 Oct: rooms against the reading's whole-floor estimate (lib/plan/coverage.ts). */
  coverage?: Coverage | null;
}

export function PlanCheckPanel({ planId, pairs, sentence, canReparse, blocked, summary, coverage }: PlanCheckPanelProps) {
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reparse = async () => {
    if (!window.confirm("Re-run the parse? The rooms on this plan are replaced by a fresh analysis of the drawing; edits you saved are lost.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/parse-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id: planId }) });
      const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!res.ok || !body?.success) throw new Error(body?.error ?? `The parse failed (${res.status}).`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The parse failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="min-w-0 space-y-6" aria-label="Plan check" data-plan-check={pairs.length ? "overlaps" : "clean"}>
      {pairs.length ? (
        <section className="surface-inverse bg-bp-alert-surface p-5 text-bp-alert-ink" aria-labelledby="plancheck-h">
          <h2 id="plancheck-h" className="t-label-caps flex items-center gap-2">
            <Icon name="error" size={18} />
            PLAN CAN&rsquo;T BE PRICED YET
          </h2>
          <p className="t-body-sm mt-3">{sentence}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button kind="secondary" tone="inverse" onClick={() => window.dispatchEvent(new CustomEvent(PLAN_FIX_OVERLAPS_EVENT))} testId="fix-overlaps">
              Fix overlaps · {pairs.length}
            </Button>
            {canReparse ? (
              <Button kind="quiet" tone="inverse" onClick={() => void reparse()} disabled={busy ? { reason: "Parsing…", reasonId: "reparse-why", showReason: true } : false} testId="rerun-parse">
                {busy ? "Parsing…" : "Re-run parse"}
              </Button>
            ) : null}
          </div>
          <p className="t-label-md mt-3 opacity-80">Fix overlaps trims the shared floor from one room of each pair — no room moves; then save. Nothing is priced until no two rooms share floor.</p>
          {error ? (
            <p role="alert" className="t-body-sm mt-2">
              {error}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="border border-bp-line-hairline bg-bp-surface-raised p-5" aria-labelledby="plancheck-h">
          <h2 id="plancheck-h" className="t-label-caps flex items-center gap-2 text-bp-ink-tertiary">
            <Icon name="check_circle" size={18} />
            PLAN CHECK · CAN BE PRICED
          </h2>
          <p className="t-body-sm mt-3 text-bp-ink-secondary">
            No two rooms share floor: {summary.rooms} {summary.label} · {summary.area}. Every area-based line is measured once.
          </p>
        </section>
      )}

      {coverage?.warn ? (
        <section className="border border-bp-line-strong bg-bp-surface-raised p-5" aria-labelledby="coverage-h" data-plan-coverage="warn">
          <h2 id="coverage-h" className="t-label-caps flex items-center gap-2 text-bp-ink-primary">
            <Icon name="flag" size={18} />
            PLAN CHECK · A ROOM MAY BE MISSING
          </h2>
          <p className="t-body-sm mt-3 text-bp-ink-primary">{coverage.sentence}</p>
          <p className="t-label-md mt-2 text-bp-ink-secondary">
            The whole-floor figure is the reading&rsquo;s own estimate of the drawing. Add the missing space on the Plan layer, or re-run the parse if a room was not read.
          </p>
        </section>
      ) : null}

      {pairs.length ? (
        <section aria-labelledby="overlaps-h">
          <h2 id="overlaps-h" className="t-label-caps text-bp-ink-tertiary">
            OVERLAPS · LARGEST FIRST
          </h2>
          <ul className="mt-2" data-testid="overlap-list">
            {pairs.map((p) => {
              const key = `${p.aId}|${p.bId}`;
              return (
                <li key={key} className="border-b border-bp-line-hairline">
                  <button
                    type="button"
                    aria-pressed={picked === key}
                    onClick={() => {
                      setPicked(key);
                      window.dispatchEvent(new CustomEvent(PLAN_SELECT_ROOMS_EVENT, { detail: { ids: [p.aId, p.bId] } }));
                    }}
                    className={`t-body-sm flex min-h-11 w-full items-center gap-3 px-1 text-left text-bp-ink-primary hover:bg-bp-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring ${picked === key ? "bg-bp-surface-raised" : ""}`}
                    data-overlap={key}
                  >
                    <Icon name="join" size={18} className="text-bp-ink-secondary" />
                    <span className="flex-1">
                      {p.aName} <span aria-hidden="true">↔</span>
                      <span className="sr-only"> and </span> {p.bName}
                    </span>
                    <Icon name="chevron_right" size={18} className="text-bp-ink-tertiary" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {blocked.length ? (
        <section aria-labelledby="blocked-h" className="border-t border-bp-line-hairline pt-4">
          <h2 id="blocked-h" className="t-label-caps text-bp-ink-tertiary">
            BLOCKED DOWNSTREAM
          </h2>
          <p className="t-body-sm mt-2 text-bp-ink-secondary">
            {blocked.map((b) => b.step).join(", ")} wait for a plan that can be priced. Nothing already generated changes.
          </p>
        </section>
      ) : null}
    </aside>
  );
}
