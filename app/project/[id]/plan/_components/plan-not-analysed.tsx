"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  EMPTY_PLOT,
  parsePlot,
  PlotSizeFields,
  type PlotDraft,
} from "@/components/plan/plot-size-fields";
import { Button } from "@/components/ui/button";

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

  return (
    <div className="rounded-xl border border-ink-100 bg-paper p-12">
      <div className="mx-auto max-w-[620px] text-center">
        <span
          className="material-symbols-outlined mb-md text-[32px] text-brass-600"
          aria-hidden="true"
        >
          {parseRan ? "search_off" : "draft"}
        </span>
        <h2 className="mb-sm font-display text-headline-md text-ink-900">{headline}</h2>
        <p className="mb-lg font-body text-body-md text-on-surface-variant">{body}</p>

        {error && (
          <p className="mb-md font-body-sm text-body-sm text-status-error">{error}</p>
        )}

        {drawing ? (
          <div className="mx-auto max-w-[440px] rounded-lg border border-ink-100 bg-canvas p-lg text-left">
            <p className="mb-md font-body-sm text-body-sm text-ink-700">
              Drawing by hand keeps this project, the uploaded file and anything
              already attached to it. All it needs is the one thing the analysis
              could not give us — a scale.
            </p>
            <PlotSizeFields
              value={plot}
              onChange={setPlot}
              idPrefix="takeover"
              disabled={busy === "draw"}
            />
            <div className="mt-lg flex items-center gap-md">
              <Button
                type="button"
                onClick={takeOver}
                disabled={!parsePlot(plot) || busy === "draw"}
              >
                {busy === "draw" ? "Switching…" : "Start drawing"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDrawing(false)}
                disabled={busy === "draw"}
                className="text-on-surface-variant hover:text-ink-900"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-md">
            {hasDrawing && (
              <Button type="button" onClick={analyse} disabled={busy !== null}>
                {busy === "parse"
                  ? "Analysing…"
                  : parseRan
                    ? "Run the analysis again"
                    : "Run the analysis"}
              </Button>
            )}
            {canDraw && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDrawing(true)}
                disabled={busy !== null}
                className="border-ink-100 bg-paper text-ink-900 hover:bg-surface-container"
              >
                Draw the layout by hand
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
