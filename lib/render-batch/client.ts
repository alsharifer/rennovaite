// =============================================================================
// lib/render-batch/client.ts — browser-side render calls + the batch runner (G4).
//
// The single-render client helpers (post, then poll /api/render/status) moved
// here from the render page so the batch runner uses exactly the same calls a
// single "Generate" button does.
//
// The runner is deliberately simple: the SERVER enforces the per-project
// in-flight cap, so the runner only has to stay under it and back off on a 429.
// Day views run first, then the batch is re-planned so every evening job edits
// the day render that actually came back.
// =============================================================================

import type { BatchJob, RenderView, SceneOutcome } from "./plan";

export type GenerateResponse = {
  render_id: string;
  image_url: string;
  prompt: string;
  qa?: "passed" | "failed" | null;
  qaReason?: string | null;
  /** G4b scene renders: "substituted" = the render was withheld and the 3D design view ships. */
  outcome?: SceneOutcome;
};

// The render + iterate routes run async: they return a prediction_id and the
// client polls /api/render/status until the image is ready. A cache hit still
// returns image_url directly, so both shapes are handled.
export async function pollRenderStatus(predictionId: string): Promise<GenerateResponse> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`/api/render/status?prediction_id=${encodeURIComponent(predictionId)}`);
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      image_url?: string;
      render_id?: string;
      prompt?: string;
      qa?: "passed" | "failed" | null;
      qa_reason?: string | null;
      error?: string;
    } | null;
    if (!res.ok || !body) {
      throw new Error(body?.error || `Status check failed (${res.status}).`);
    }
    if (body.status === "succeeded" && body.image_url && body.render_id) {
      return {
        render_id: body.render_id,
        image_url: body.image_url,
        prompt: body.prompt ?? "",
        qa: body.qa ?? null,
        qaReason: body.qa_reason ?? null,
      };
    }
    if (body.status === "failed") {
      throw new Error(body.error || "Render failed.");
    }
    // status === "processing" → keep polling.
  }
  throw new Error("Render timed out.");
}

// Normalise a POST /api/render(-iterate) response: a cache hit carries
// image_url; otherwise poll the returned prediction_id to completion.
export async function resolveRender(
  body: Record<string, unknown> | null,
  status: number,
): Promise<GenerateResponse> {
  if (!body) throw new Error(`Render failed (${status}).`);
  if (typeof body.image_url === "string" && body.image_url) {
    return {
      render_id: String(body.render_id),
      image_url: body.image_url,
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      ...(body.outcome === "passed" || body.outcome === "substituted" ? { outcome: body.outcome } : {}),
    };
  }
  if (typeof body.prediction_id === "string" && body.prediction_id) {
    return pollRenderStatus(body.prediction_id);
  }
  throw new Error((typeof body.error === "string" && body.error) || "Unexpected render response.");
}

// --- Batch -------------------------------------------------------------------------

export type BatchPreset =
  | { seeded: true; style_key: string }
  | { seeded: false; style_key: string | null; reason: string };

export interface BatchPlanResponse {
  jobs: BatchJob[];
  preset: BatchPreset;
  cap: number;
}

export type JobProgress = "queued" | "running" | "done" | "failed" | "blocked";

export interface BatchEvent {
  room_id: string;
  view: RenderView;
  state: JobProgress;
  error?: string;
  result?: GenerateResponse;
}

export async function fetchBatchPlan(projectId: string): Promise<BatchPlanResponse> {
  const res = await fetch("/api/render/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId }),
  });
  const body = (await res.json().catch(() => null)) as (BatchPlanResponse & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error || `Batch planning failed (${res.status}).`);
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runJob(projectId: string, job: BatchJob): Promise<GenerateResponse> {
  const url = job.camera_id ? "/api/render/scene" : job.view === "evening" ? "/api/render/evening" : "/api/render";
  // A 429 means the project is at its in-flight cap (possibly from another tab):
  // wait and try again rather than failing the job.
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job.camera_id ? { project_id: projectId, camera_id: job.camera_id, view: job.view } : { project_id: projectId, room_id: job.room_id }),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 429) {
      await sleep(6000);
      continue;
    }
    if (!res.ok) throw new Error((body && typeof body.error === "string" && body.error) || `Render failed (${res.status}).`);
    return resolveRender(body, res.status);
  }
  throw new Error("The project stayed at its render cap; try again shortly.");
}

async function runPool(
  projectId: string,
  jobs: BatchJob[],
  concurrency: number,
  onEvent: (e: BatchEvent) => void,
): Promise<void> {
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      onEvent({ room_id: job.room_id, view: job.view, state: "running" });
      try {
        const result = await runJob(projectId, job);
        onEvent({ room_id: job.room_id, view: job.view, state: "done", result });
      } catch (e) {
        onEvent({
          room_id: job.room_id,
          view: job.view,
          state: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
}

/**
 * Run every outstanding job. Day views first; then re-plan, so evening jobs are
 * computed against the day renders that now exist (a day that failed leaves its
 * evening blocked, and says so).
 */
export async function runBatch(
  projectId: string,
  onPlan: (plan: BatchPlanResponse) => void,
  onEvent: (e: BatchEvent) => void,
): Promise<void> {
  const first = await fetchBatchPlan(projectId);
  onPlan(first);
  const inFlight = first.jobs.filter((j) => j.status === "in_flight").length;
  const slots = Math.max(1, first.cap - inFlight);

  await runPool(projectId, first.jobs.filter((j) => j.view === "day" && j.status === "queued"), slots, onEvent);

  const second = await fetchBatchPlan(projectId);
  onPlan(second);
  for (const j of second.jobs.filter((x) => x.view === "evening" && x.status === "blocked")) {
    onEvent({ room_id: j.room_id, view: "evening", state: "blocked", error: j.reason ?? undefined });
  }
  await runPool(projectId, second.jobs.filter((j) => j.view === "evening" && j.status === "queued"), second.cap, onEvent);
}
