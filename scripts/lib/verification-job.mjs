// =============================================================================
// scripts/lib/verification-job.mjs — read-only document access for verification
// scripts (T5).
//
// The document routes serve sheet SVGs, pack pages and PDFs only to a RUNNING
// pack export job (lib/documents/pack-export/guard.ts). Verification scripts
// (identity scan, isolation check, live dry-run, design seed) READ those
// documents to check them; they never release one. They hold the service-role
// key already, so this helper opens a pack job per project for the duration of
// the read and closes it as released-nothing. It is a script convenience, not a
// route: the app has no equivalent, and a job it opens never has outputs.
// Plain ESM so .mjs and .ts scripts can both import it.
// =============================================================================

export const PACK_JOB_HEADER = "x-pack-export-job";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {string} purpose
 */
export function verificationJobs(db, purpose) {
  /** @type {Map<string, string>} */
  const jobs = new Map();
  return {
    /**
     * Headers that let `projectId`'s document routes answer this script.
     * @param {string} projectId
     * @returns {Promise<Record<string, string>>}
     */
    async headers(projectId) {
      let id = jobs.get(projectId);
      if (!id) {
        const { data, error } = await db
          .from("pack_exports")
          .insert({ project_id: projectId, source: "cli", status: "running", options: { stage: "verification", purpose }, progress: { step: "checks", pct: 0, note: `verification read: ${purpose}` }, started_at: new Date().toISOString() })
          .select("id")
          .single();
        if (error || !data) throw new Error(`verification job could not be opened: ${error?.message ?? "no row"}`);
        id = /** @type {string} */ (data.id);
        jobs.set(projectId, id);
      }
      return { [PACK_JOB_HEADER]: /** @type {string} */ (id) };
    },
    /** Close every job this script opened: released nothing, by construction. */
    async close() {
      for (const id of jobs.values()) {
        await db.from("pack_exports").update({ status: "failed", error: `verification read only (${purpose}) — no documents released`, finished_at: new Date().toISOString() }).eq("id", id);
      }
      jobs.clear();
    },
  };
}
