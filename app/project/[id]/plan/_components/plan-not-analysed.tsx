"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/blueprint/Button";
import { Icon } from "@/components/blueprint/Icon";
import { PlotSizeFields } from "@/components/blueprint/plan/PlotSizeFields";
import { EMPTY_PLOT, parsePlot, type PlotDraft } from "@/lib/plan/plot";

/**
 * What the plan page shows when it has no rooms to edit.
 *
 * It used to show `<ParseLoading />` — a spinner — on the assumption that a
 * plan without rooms was mid-parse. Nothing in this app parses asynchronously:
 * intake POSTs to /api/parse-plan and only navigates here once it returns, so
 * arriving with no rooms means the parse failed, came back empty, or was never
 * run. The spinner was therefore permanent, and it was the one state a user
 * could reach with no way out of it.
 *
 * So: say which of those happened, and offer the two things that actually help.
 * Blueprint (K8, the parse-failure state of 24:814): a dashed-hairline empty
 * state, a failed action is the inverse block, a disabled action says why.
 */
export function PlanNotAnalysed({
  planId,
  hasDrawing,
  parseRan,
  canDraw,
}: {
  planId: string;
  /** A floorplan file is attached, so re-running the parse is possible. */
  hasDrawing: boolean;
  /** The parser ran and returned a result — it just found no rooms. */
  parseRan: boolean;
  /** Garden pilot on: taking the plan over by hand is available. */
  canDraw: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"parse" | "draw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [plot, setPlot] = useState<PlotDraft>(EMPTY_PLOT);

  const analyse = async () => {
    setBusy("parse");
    setError(null);
    try {
      const res = await fetch("/api/parse-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `Analysis failed (${res.status}).`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setBusy(null);
    }
  };

  const takeOver = async () => {
    const size = parsePlot(plot);
    if (!size) return;
    setBusy("draw");
    setError(null);
    try {
      const res = await fetch("/api/draw-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, ...size }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `Could not switch to drawing (${res.status}).`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch to drawing.");
    } finally {
      setBusy(null);
    }
  };

  const headline = parseRan
    ? "We couldn't find any rooms in this drawing"
    : hasDrawing
      ? "This plan hasn't been analysed yet"
      : "This plan has no drawing attached";

  const body = parseRan
    ? "The analysis ran and came back empty. That usually means the sheet is a section, a detail, or too low-resolution to read."
    : hasDrawing
      ? "The upload finished but the analysis never ran, or it didn't complete."
      : "There is nothing here to read, so the layout has to be drawn by hand.";

  // Disabled controls name their reason (K7): the busy line below is the reason.
  const busyReason = busy === "parse" ? "The analysis is running." : busy === "draw" ? "Switching to drawing…" : "";
  const busyOff = busy !== null ? { reason: busyReason, reasonId: "plan-not-analysed-busy" } : false;
  const plotReady = parsePlot(plot) !== null;
  const startOff = busy !== null ? busyOff : !plotReady ? { reason: "Enter the plot's width and depth first.", reasonId: "takeover-needs-plot", showReason: true } : false;

  return (
    <section aria-labelledby="plan-not-analysed-h" className="border border-dashed border-bp-line-strong bg-bp-surface-raised p-6 md:p-10" data-plan-not-analysed>
      <div className="max-w-[620px]">
        <Icon name={parseRan ? "search_off" : "draft"} className="mb-3 text-[28px] text-bp-ink-secondary" />
        <h2 id="plan-not-analysed-h" className="t-heading-md text-bp-ink-primary">
          {headline}
        </h2>
        <p className="t-body-md mt-2 text-bp-ink-secondary">{body}</p>

        {error ? (
          <div role="alert" className="surface-inverse mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
            <p className="t-body-sm">{error}</p>
          </div>
        ) : null}
        <p id="plan-not-analysed-busy" className="sr-only" aria-live="polite">
          {busyReason}
        </p>

        {drawing ? (
          <div className="mt-6 max-w-[480px] border border-bp-line-hairline bg-bp-surface-base p-5">
            <p className="t-body-sm mb-4 text-bp-ink-secondary">
              Drawing by hand keeps this project, the uploaded file and anything
              already attached to it. All it needs is the one thing the analysis
              could not give us — a scale.
            </p>
            <PlotSizeFields value={plot} onChange={setPlot} idPrefix="takeover" disabled={busy === "draw"} />
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button kind="primary" onClick={takeOver} disabled={startOff}>
                {busy === "draw" ? "Switching…" : "Start drawing"}
              </Button>
              <Button kind="quiet" onClick={() => setDrawing(false)} disabled={busy === "draw" ? busyOff : false}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap items-center gap-4">
            {hasDrawing && (
              <Button kind="primary" onClick={analyse} disabled={busyOff}>
                {busy === "parse" ? "Analysing…" : parseRan ? "Run the analysis again" : "Run the analysis"}
              </Button>
            )}
            {canDraw && (
              <Button kind={hasDrawing ? "secondary" : "primary"} onClick={() => setDrawing(true)} disabled={busyOff}>
                Draw the layout by hand
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
