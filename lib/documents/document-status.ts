// =============================================================================
// lib/documents/document-status.ts — THE status of a project's documents (C2).
//
// One rule, everywhere a document badge is drawn (the owner Overview, the firm
// hub, 06 Documents, the rail's 06 Documents / Tender / 08 Proposal steps):
//
//   a badge = f(validation result, revision id)
//
//   Ready · rev N       the LAST export of this project PASSED, and it was run on
//                       the CURRENT revision — matched by BoQ id (the run's
//                       manifest.boq.id), never by timestamp
//   Needs check: <why>  anything else — never exported, the last export failed
//                       (its first failing check), was blocked (its first open
//                       item), was run on an earlier revision, or threw
//   Export running      a job is running now
//   Not available yet   the deployment cannot export at all (the only thing a
//                       flag decides — availability, never readiness)
//
// C0 found every "Ready" in the app was flags + "a BoQ exists", and 06 Documents
// compared timestamps — an in-app export regenerates the BoQ inside its own job,
// so its revision is always newer than the job and the step could never be done.
// Pure and client-safe (types only).
// =============================================================================

import type { PackJob } from "./pack-export/job";

export type DocumentState = "ready" | "needs_check" | "running" | "unavailable";

export interface DocumentStatus {
  state: DocumentState;
  /** The badge's words: "Ready · rev 3", "Needs check: the BoQ changed since the last export", … */
  label: string;
  /** Why it is not Ready (null when Ready). */
  reason: string | null;
  /** The job the status was read from (null = none). */
  jobId: string | null;
  /** The BoQ revision that job ran on (null = unknown / none). */
  jobBoqId: string | null;
}

export type JobFact = Pick<PackJob, "id" | "status" | "created_at" | "manifest" | "checklist" | "error"> & { options?: PackJob["options"] | null };

/** The BoQ revision a job ran on — its manifest's boq.id (passed and failed runs record it). */
export function jobBoqId(job: Pick<PackJob, "manifest">): string | null {
  const boq = (job.manifest as { boq?: { id?: unknown } } | null)?.boq;
  return typeof boq?.id === "string" ? boq.id : null;
}

/** Why a finished job is not a pass, in a few words. */
export function jobFailure(job: JobFact): string {
  if (job.status === "blocked") {
    const open = (job.checklist ?? []).find((c) => !c.ok);
    return `export blocked — ${open ? open.title : "a readiness item is open"}`;
  }
  const failed = ((job.manifest as { checks?: { label: string; ok: boolean }[] } | null)?.checks ?? []).find((c) => !c.ok);
  if (failed) return `the last export failed — ${failed.label}`;
  if (job.error) return `the last export failed — ${job.error}`;
  return "the last export failed";
}

/**
 * Did the project's latest finished export pass ON this revision? (The rail's
 * "exported" fact; `proposal` = the run included the client proposal.)
 */
export function exportedOn(jobs: readonly JobFact[], boqId: string | null, opts: { proposal?: boolean } = {}): boolean {
  if (!boqId) return false;
  const relevant = jobs.filter((j) => j.status !== "queued" && j.status !== "running" && (!opts.proposal || (j.options as { proposal?: boolean } | null | undefined)?.proposal === true));
  const last = [...relevant].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return !!last && last.status === "passed" && jobBoqId(last) === boqId;
}

/**
 * The document status for the CURRENT revision.
 *   available  the deployment can export (packExportEnabled)
 *   current    the latest BoQ revision: its id and number (null = no BoQ yet)
 *   jobs       the project's export jobs, any order
 */
export function documentStatus(input: { available: boolean; current: { boqId: string; rev: number } | null; jobs: readonly JobFact[]; proposal?: boolean }): DocumentStatus {
  const none = { jobId: null, jobBoqId: null };
  if (!input.available) return { state: "unavailable", label: "Not available yet", reason: "export is not enabled on this deployment", ...none };
  if (!input.current) return needs("no BoQ yet — generate the cost first", none);
  const jobs = [...input.jobs].filter((j) => !input.proposal || (j.options as { proposal?: boolean } | null | undefined)?.proposal === true).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const running = jobs.find((j) => j.status === "running" || j.status === "queued");
  if (running) return { state: "running", label: "Export running", reason: "an export is running", jobId: running.id, jobBoqId: null };
  const last = jobs[0];
  if (!last) return needs("not exported yet", none);
  const at = { jobId: last.id, jobBoqId: jobBoqId(last) };
  if (last.status !== "passed") return needs(jobFailure(last), at);
  if (at.jobBoqId !== input.current.boqId) return needs(`the BoQ changed since the last export — export rev ${input.current.rev}`, at);
  return { state: "ready", label: `Ready · rev ${input.current.rev}`, reason: null, ...at };
}

function needs(reason: string, at: { jobId: string | null; jobBoqId: string | null }): DocumentStatus {
  return { state: "needs_check", label: `Needs check: ${reason}`, reason, ...at };
}
