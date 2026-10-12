// =============================================================================
// components/blueprint/RegenerateControl.tsx — the regenerate control SHELL
// (R7 §2, 15:292). Presentational: K3 wires it to H4's path
// (lib/boq/regenerate.ts readiness + POST /api/generate-boq) and owns the
// state machine. Member gating is the caller's (H5) — a non-member gets
// `blocked` with the server's reason.
//
//   unchanged  disabled + "Nothing has changed since rev N"
//   ready      Primary + what changed
//   running    progress + what it is doing — announced (aria-live polite)
//   done       "rev N+1 created · ≈ total (Δ)" + View diff
//   blocked    lock + the exact reason + where to fix it
// =============================================================================

import { useId } from "react";

import { formatAED, formatDelta } from "@/lib/format/aed";

import { Button } from "./Button";
import { Icon } from "./Icon";

export type RegenerateState =
  | { state: "unchanged"; rev: number }
  | { state: "ready"; changed: string }
  | { state: "running"; doing: string }
  | { state: "done"; newRev: number; total: number; delta: number; previousRev: number; diffHref: string }
  | { state: "blocked"; reason: string; fixLabel?: string; fixHref?: string };

export function RegenerateControl({ value, onRegenerate }: { value: RegenerateState; onRegenerate?: () => void }) {
  const reasonId = useId();
  const label = (
    <>
      <Icon name={value.state === "running" ? "progress_activity" : "refresh"} className={`text-[18px]${value.state === "running" ? " animate-spin motion-reduce:animate-none" : ""}`} />
      {value.state === "running" ? "Regenerating…" : "Regenerate"}
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-3" data-regenerate={value.state} data-testid="regenerate" data-regenerate-state={value.state}>
      {value.state === "done" ? (
        <p className="flex items-center gap-2" aria-live="polite" data-testid="regenerate-result">
          <Icon name="check" className="text-[18px] text-bp-ink-secondary" />
          <span>
            <span className="t-label-caps block text-bp-ink-secondary">Rev {value.newRev} created</span>
            <span className="t-label-md text-bp-ink-primary">
              ≈ {formatAED(value.total)} ({formatDelta(value.delta)} vs rev {value.previousRev})
            </span>
          </span>
        </p>
      ) : value.state === "ready" ? (
        <Button kind="primary" onClick={onRegenerate} testId="regenerate-button">
          {label}
        </Button>
      ) : (
        <Button kind="secondary" disabled={{ reason: reasonText(value), reasonId }} testId="regenerate-button">
          {label}
        </Button>
      )}

      {value.state === "done" ? (
        <Button kind="quiet" href={value.diffHref} testId="regenerate-diff-link">
          View diff
        </Button>
      ) : value.state === "ready" ? (
        <span className="bp-reason t-label-md text-bp-ink-secondary">{value.changed}</span>
      ) : value.state === "running" ? (
        <span id={reasonId} className="t-label-md text-bp-ink-secondary" aria-live="polite">
          {value.doing}
        </span>
      ) : value.state === "blocked" ? (
        <span className="inline-flex items-center gap-2">
          <Icon name="lock" className="text-[18px] text-bp-ink-secondary" />
          <span id={reasonId} className="t-label-md text-bp-ink-secondary" data-testid="regenerate-block">
            {value.reason}
          </span>
          {value.fixHref ? (
            <Button kind="quiet" href={value.fixHref}>
              {value.fixLabel ?? "Fix it"}
            </Button>
          ) : null}
        </span>
      ) : (
        <span id={reasonId} className="bp-reason t-label-md text-bp-ink-secondary">
          {reasonText(value)}
        </span>
      )}
    </div>
  );
}

function reasonText(v: RegenerateState): string {
  if (v.state === "unchanged") return `Nothing has changed since rev ${v.rev}`;
  if (v.state === "blocked") return v.reason;
  if (v.state === "running") return v.doing;
  return "";
}
