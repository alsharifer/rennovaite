"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  runBatch,
  type BatchEvent,
  type BatchPreset,
  type GenerateResponse,
  type JobProgress,
} from "@/lib/render-batch/client";
import type { BatchJob, RenderView, SceneOutcome } from "@/lib/render-batch/plan";

// G4 "Generate all" (Newspace ask #2). One action queues every zone and view
// that has not been rendered yet; each result lands in the zone's own chain, so
// editing afterwards is the ordinary per-zone tweak flow.

type Row = { room_id: string; room_name: string; view: RenderView; state: JobProgress; note: string | null; outcome: SceneOutcome | null; by_choice: boolean };

const key = (roomId: string, view: RenderView) => `${roomId}:${view}`;

function rowsFrom(jobs: BatchJob[]): Row[] {
  return jobs.map((j) => ({
    room_id: j.room_id,
    room_name: j.room_name,
    view: j.view,
    state: j.status === "done" ? "done" : j.status === "blocked" ? "blocked" : j.status === "in_flight" ? "running" : "queued",
    note: j.reason,
    outcome: j.outcome ?? null,
    by_choice: j.by_choice === true,
  }));
}

// G4b: a garden render that failed the faithfulness check is withheld and its 3D
// design view ships instead — "Done" would hide that.
const BY_CHOICE_NOTE = "No camera position on this plot gives a styled render a clean view, so the 3D design view ships and no render was attempted.";
const SUBSTITUTED_NOTE = "Render withheld: it did not pass the faithfulness check, so the 3D design view ships in its place.";

function stateLabel(r: Row): string {
  if (r.state === "done" && r.outcome === "substituted") return r.by_choice ? "3D view · by choice" : "3D view";
  if (r.state === "done" && r.outcome === "passed") return "Checked";
  return STATE_LABEL[r.state];
}

const STATE_LABEL: Record<JobProgress, string> = {
  queued: "Queued",
  running: "Rendering",
  done: "Done",
  failed: "Failed",
  blocked: "Waiting",
};

export function GenerateAllPanel({
  projectId,
  initialJobs,
  onResult,
}: {
  projectId: string;
  initialJobs: BatchJob[];
  onResult: (roomId: string, view: RenderView, result: GenerateResponse) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(initialJobs));
  const [running, setRunning] = useState(false);
  const [preset, setPreset] = useState<BatchPreset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const outstanding = rows.filter((r) => r.state !== "done").length;
  const done = rows.length - outstanding;
  const substituted = rows.filter((r) => r.state === "done" && r.outcome === "substituted").length;
  const scene = rows.some((r) => r.outcome != null);

  async function handleGenerateAll() {
    setRunning(true);
    setError(null);
    try {
      await runBatch(
        projectId,
        (plan) => {
          setPreset(plan.preset);
          setRows((prev) => {
            // Keep a failure visible across the re-plan; otherwise trust the server.
            const failed = new Map(prev.filter((r) => r.state === "failed").map((r) => [key(r.room_id, r.view), r]));
            return rowsFrom(plan.jobs).map((r) => failed.get(key(r.room_id, r.view)) && r.state === "queued" ? failed.get(key(r.room_id, r.view))! : r);
          });
        },
        (e: BatchEvent) => {
          setRows((prev) =>
            prev.map((r) =>
              r.room_id === e.room_id && r.view === e.view
                ? { ...r, state: e.state, note: e.error ?? (e.state === "done" ? null : r.note), outcome: e.result?.outcome ?? r.outcome, by_choice: e.result?.by_choice ?? r.by_choice }
                : r,
            ),
          );
          if (e.state === "done" && e.result) onResult(e.room_id, e.view, e.result);
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch failed.");
    } finally {
      setRunning(false);
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className="mb-lg rounded-md border border-ink-100 bg-canvas p-md" aria-label="Generate all views">
      <div className="flex items-baseline justify-between">
        <p className="label-caps text-ink-500">All views</p>
        <p className="font-mono text-[12px] tabular-nums text-ink-500">
          {done}/{rows.length}
        </p>
      </div>
      <button
        type="button"
        onClick={handleGenerateAll}
        disabled={running || outstanding === 0}
        className="focus-ring mt-sm inline-flex w-full items-center justify-center gap-xs rounded-lg bg-brass-600 px-md py-sm font-body-sm text-body-sm font-semibold text-on-primary transition-opacity disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          {running ? "progress_activity" : "burst_mode"}
        </span>
        {running ? "Generating…" : outstanding === 0 ? "Every view rendered" : `Generate all (${outstanding})`}
      </button>
      <p className="mt-xs font-body-sm text-[12px] leading-4 text-ink-500">
        Day view for every zone, then an evening view wherever lighting is on the plan. Up to three render at once; edit any
        of them afterwards from its zone.
      </p>
      {scene && (
        <p className="mt-xs font-body-sm text-[12px] leading-4 text-ink-700">
          Every garden render is checked against the 3D design model before it is kept.
          {substituted > 0 && ` ${substituted} withheld — ${substituted === 1 ? "its" : "their"} 3D design view ships instead.`}
        </p>
      )}
      {preset?.seeded && (
        <p className="mt-xs font-body-sm text-[12px] leading-4 text-ink-700">
          Moodboard seeded with the direction&apos;s garden and structure references.
        </p>
      )}
      {error && <p className="mt-xs font-body-sm text-[12px] text-error">{error}</p>}
      <ul className="mt-sm flex max-h-56 flex-col gap-[2px] overflow-y-auto">
        {rows.map((r) => (
          <li key={key(r.room_id, r.view)} className="flex items-center justify-between gap-sm text-[12px]" title={r.note ?? (r.state === "done" && r.outcome === "substituted" ? (r.by_choice ? BY_CHOICE_NOTE : SUBSTITUTED_NOTE) : undefined)}>
            <span className="truncate text-ink-700">
              {r.room_name}
              <span className="text-ink-500"> · {r.view === "evening" ? "Evening" : "Day"}</span>
            </span>
            <span
              className={cn(
                "shrink-0 font-mono tabular-nums",
                r.state === "done" && r.outcome !== "substituted" && "text-ink-500",
                r.state === "done" && r.outcome === "substituted" && "text-tertiary",
                r.state === "running" && "text-brass-600",
                r.state === "failed" && "text-error",
                (r.state === "queued" || r.state === "blocked") && "text-ink-500",
              )}
            >
              {stateLabel(r)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
