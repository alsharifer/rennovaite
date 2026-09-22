// =============================================================================
// lib/documents/pack-export/job.ts — pack export jobs (T5, migration 042).
//
// A job row is the progress record the UI polls AND the only credential the
// document routes accept for a PDF (guard.ts). Server + CLI safe: the Supabase
// client is passed in.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChecklistItem, PackExportOptions, PackExportResult, PackOutput, PackProgress, PackSink } from "./types";

export const PACK_BUCKET = "packs";
/** A job may authorise document requests for at most this long. */
export const JOB_TTL_MS = 3 * 60 * 60 * 1000;

export interface PackJob {
  id: string;
  project_id: string;
  source: "app" | "cli";
  status: "queued" | "running" | "passed" | "blocked" | "failed";
  options: Partial<PackExportOptions>;
  progress: (PackProgress & { log?: string[] }) | Record<string, never>;
  checklist: ChecklistItem[] | null;
  manifest: Record<string, unknown> | null;
  outputs: PackOutput[];
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const COLS = "id, project_id, source, status, options, progress, checklist, manifest, outputs, error, created_at, started_at, finished_at";

export async function createPackJob(db: SupabaseClient, projectId: string, source: "app" | "cli", options: Partial<PackExportOptions>): Promise<PackJob> {
  const { data, error } = await db
    .from("pack_exports")
    .insert({ project_id: projectId, source, status: "running", options, progress: { step: "readiness", pct: 0, note: "queued", log: [] }, started_at: new Date().toISOString() })
    .select(COLS)
    .single<PackJob>();
  if (error || !data) throw new Error(`pack job could not be created: ${error?.message ?? "no row"}`);
  return data;
}

export async function loadPackJob(db: SupabaseClient, jobId: string): Promise<PackJob | null> {
  const { data } = await db.from("pack_exports").select(COLS).eq("id", jobId).maybeSingle<PackJob>();
  return data ?? null;
}

export async function latestPackJobs(db: SupabaseClient, projectId: string, limit = 5): Promise<PackJob[]> {
  const { data } = await db.from("pack_exports").select(COLS).eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as PackJob[];
}

/** Record progress; keeps the last 40 log lines for the UI. */
export function progressWriter(db: SupabaseClient, jobId: string) {
  const log: string[] = [];
  let last: PackProgress = { step: "readiness", pct: 0, note: "" };
  const flush = async () => {
    await db.from("pack_exports").update({ progress: { ...last, log: log.slice(-40) } }).eq("id", jobId);
  };
  return {
    log: (line: string) => {
      log.push(line);
    },
    onProgress: async (p: PackProgress) => {
      last = p;
      await flush();
    },
  };
}

export async function finishPackJob(db: SupabaseClient, jobId: string, result: PackExportResult | null, error: string | null): Promise<void> {
  await db
    .from("pack_exports")
    .update({
      status: result ? result.status : "failed",
      checklist: result?.checklist ?? null,
      manifest: result?.manifest ?? null,
      outputs: result?.outputs ?? [],
      error,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

/** True when `jobId` is a RUNNING pack job for this project, started within the TTL. */
export async function jobAuthorises(db: SupabaseClient, jobId: string | null, projectId: string): Promise<boolean> {
  if (!jobId || !/^[0-9a-f-]{36}$/.test(jobId)) return false;
  const job = await loadPackJob(db, jobId);
  if (!job || job.project_id !== projectId || job.status !== "running" || !job.started_at) return false;
  return Date.now() - new Date(job.started_at).getTime() < JOB_TTL_MS;
}

/** The app's sink: the private `packs` bucket, one folder per job. */
export function storageSink(db: SupabaseClient, projectId: string, jobId: string): PackSink {
  return {
    async write(name, bytes, contentType) {
      const path = `projects/${projectId}/${jobId}/${name}`;
      const { error } = await db.storage.from(PACK_BUCKET).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`pack output ${name} could not be stored: ${error.message}`);
      return { path };
    },
  };
}

/** Signed download links — only for a job whose every gate held. */
export async function signedOutputs(db: SupabaseClient, job: PackJob): Promise<{ name: string; bytes: number; url: string }[]> {
  if (job.status !== "passed" || job.source !== "app") return [];
  const out: { name: string; bytes: number; url: string }[] = [];
  for (const o of job.outputs) {
    const { data } = await db.storage.from(PACK_BUCKET).createSignedUrl(o.path, 60 * 60, { download: o.name });
    if (data?.signedUrl) out.push({ name: o.name, bytes: o.bytes, url: data.signedUrl });
  }
  return out;
}
