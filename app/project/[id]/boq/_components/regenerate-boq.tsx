"use client";

// =============================================================================
// Regenerate — the payoff loop on the BoQ page (H4): change a rate or the plan,
// regenerate, and see exactly what moved (the U4 revision diff against the
// revision this one superseded).
//
// Runs the existing generation path (POST /api/generate-boq, trigger
// "regenerate") — the route enforces who may store a revision and records the
// event with the actor. The server decides "may I" (lib/boq/regenerate.ts) and
// the page passes that answer in, so a disabled control always names the same
// reason the route would have refused with.
// =============================================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AnalyticsEvent, track } from "@/lib/analytics";
import { formatAed } from "@/lib/format/aed";

export interface RegenerateBlockView {
  code: string;
  reason: string;
  fix?: { label: string; href: string };
}

type Result = { boqId: string; total: number; previousId: string | null; previousTotal: number | null; seconds: number };

export function RegenerateBoq({ projectId, block }: { projectId: string; block: RegenerateBlockView | null }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<RegenerateBlockView | null>(null);
  const started = useRef(0);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [running]);

  async function regenerate() {
    started.current = Date.now();
    setElapsed(0);
    setRunning(true);
    setFailure(null);
    setResult(null);
    try {
      const res = await fetch("/api/generate-boq", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, trigger: "regenerate" }),
      });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        code?: string;
        boq_id?: string;
        grand_total_aed?: number;
        previous_boq_id?: string | null;
        previous_total_aed?: number | null;
      } | null;
      if (!res.ok || !body?.success || !body.boq_id) {
        const code = body?.code ?? `http_${res.status}`;
        setFailure({
          code,
          reason: body?.error ?? `Regeneration failed (${res.status}).`,
          fix: code === "plan_has_overlaps" ? { label: "Fix overlaps on the plan", href: `/project/${projectId}/plan` } : undefined,
        });
        return;
      }
      setResult({
        boqId: body.boq_id,
        total: body.grand_total_aed ?? 0,
        previousId: body.previous_boq_id ?? null,
        previousTotal: body.previous_total_aed ?? null,
        seconds: Math.max(1, Math.round((Date.now() - started.current) / 1000)),
      });
      track(AnalyticsEvent.BoqGenerated, { project_id: projectId, trigger: "regenerate" });
      // The page re-renders with the new revision; this component keeps its state.
      router.refresh();
    } catch (e) {
      setFailure({ code: "network", reason: e instanceof Error ? e.message : "Regeneration failed." });
    } finally {
      setRunning(false);
    }
  }

  const disabled = running || block !== null;
  const delta = result && result.previousTotal !== null ? result.total - result.previousTotal : null;

  return (
    <div className="mt-lg max-w-[900px]" data-testid="regenerate" data-regenerate-state={running ? "running" : result ? "done" : failure ? "failed" : block ? "blocked" : "ready"}>
      <div className="flex flex-wrap items-center gap-md">
        <button
          type="button"
          onClick={regenerate}
          disabled={disabled}
          aria-describedby={block ? "regenerate-block" : undefined}
          data-testid="regenerate-button"
          className="focus-ring inline-flex h-11 items-center gap-sm rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant"
        >
          <span className={`material-symbols-outlined text-[18px] ${running ? "animate-spin" : ""}`} aria-hidden="true">
            {running ? "progress_activity" : "refresh"}
          </span>
          {running ? "Regenerating…" : "Regenerate BoQ"}
        </button>
        {running && (
          <p className="font-body text-body-sm text-on-surface-variant" role="status" aria-live="polite">
            Re-measuring the plan and pricing it against the current rates — <span className="font-mono tabular-nums">{elapsed}s</span>
          </p>
        )}
        {!running && block && (
          <p id="regenerate-block" className="font-body text-body-sm text-on-surface-variant" data-testid="regenerate-block" data-block-code={block.code}>
            {block.reason}
            {block.fix && (
              <>
                {" "}
                <Link href={block.fix.href} className="font-semibold text-brass-600 underline-offset-2 hover:underline">
                  {block.fix.label}
                </Link>
              </>
            )}
          </p>
        )}
      </div>

      {result && (
        <div className="mt-md rounded-md border border-ink-100 bg-paper px-lg py-md" role="status" data-testid="regenerate-result" data-boq-id={result.boqId}>
          <p className="font-body text-body-md text-ink-900">
            New revision priced in <span className="font-mono tabular-nums">{result.seconds}s</span> —{" "}
            <span className="font-mono tabular-nums">{formatAed(result.total)}</span>
            {delta !== null && (
              <span className="text-on-surface-variant">
                {" "}
                (<span className="font-mono tabular-nums">{delta === 0 ? "no change" : formatAed(delta, "signed")}</span> on the previous revision)
              </span>
            )}
          </p>
          {result.previousId ? (
            <Link
              href={`/project/${projectId}/boq/revisions?from=${result.previousId}&to=${result.boqId}`}
              className="focus-ring mt-sm inline-flex items-center gap-xs font-body-sm text-body-sm font-semibold text-brass-600 hover:underline"
              data-testid="regenerate-diff-link"
            >
              See exactly what moved
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                arrow_forward
              </span>
            </Link>
          ) : (
            <p className="mt-sm font-body text-body-sm text-on-surface-variant">This is the project&apos;s first revision — there is nothing earlier to compare.</p>
          )}
        </div>
      )}

      {failure && !running && (
        <p className="mt-md font-body text-body-sm text-error" role="alert" data-testid="regenerate-failure" data-failure-code={failure.code}>
          {failure.reason}
          {failure.fix && (
            <>
              {" "}
              <Link href={failure.fix.href} className="font-semibold underline-offset-2 hover:underline">
                {failure.fix.label}
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
