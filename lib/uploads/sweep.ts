// =============================================================================
// lib/uploads/sweep.ts — the daily orphan sweep (H9).
//
// A signed upload the browser never completed (tab closed, network dropped,
// refused at complete — refusals delete at once, so mostly the first two)
// leaves an object under pending/ in the private `uploads` bucket. A large
// document answered by redirect (lib/documents/file-response.ts) leaves one
// under downloads/ in `packs`; its signed URL lived minutes. Both are swept
// once they are older than PENDING_MAX_AGE_MS (24 h).
//
// DRY-RUN BY DEFAULT: the job lists what it WOULD delete (logged by the cron
// route) until UPLOAD_SWEEP_APPLY="true" — the H9 brief's "dry-run logged
// first". Never touches anything outside those two prefixes.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { PACK_BUCKET } from "@/lib/documents/pack-export/job";

import { DOWNLOADS_PREFIX, PENDING_MAX_AGE_MS } from "./limits";
import { UPLOAD_BUCKET } from "./server";

interface Entry {
  name: string;
  id: string | null;
  created_at?: string | null;
}

/** Every object under `prefix` (Storage lists one folder at a time; folders have no id). Also the K10 project purge's lister. */
export async function walk(db: SupabaseClient, bucket: string, prefix: string, out: { path: string; createdAt: string | null }[] = []) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${prefix} failed: ${error.message}`);
    const entries = (data ?? []) as Entry[];
    for (const e of entries) {
      const path = `${prefix}/${e.name}`;
      if (e.id === null) await walk(db, bucket, path, out);
      else out.push({ path, createdAt: e.created_at ?? null });
    }
    if (entries.length < 1000) break;
  }
  return out;
}

export interface SweepReport {
  apply: boolean;
  cutoff: string;
  stale: { bucket: string; path: string; createdAt: string | null }[];
  deleted: number;
}

export async function sweepStaleUploads(db: SupabaseClient, opts: { now?: Date; apply: boolean }): Promise<SweepReport> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - PENDING_MAX_AGE_MS).toISOString();
  const stale: SweepReport["stale"] = [];
  for (const [bucket, prefix] of [
    [UPLOAD_BUCKET, "pending"],
    [PACK_BUCKET, DOWNLOADS_PREFIX],
  ] as const) {
    for (const o of await walk(db, bucket, prefix)) {
      // An object with no timestamp is not provably old: kept.
      if (o.createdAt && o.createdAt < cutoff) stale.push({ bucket, ...o });
    }
  }
  let deleted = 0;
  if (opts.apply) {
    for (const bucket of [UPLOAD_BUCKET, PACK_BUCKET]) {
      const paths = stale.filter((s) => s.bucket === bucket).map((s) => s.path);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) throw new Error(`remove from ${bucket} failed: ${error.message}`);
        deleted += Math.min(100, paths.length - i);
      }
    }
  }
  return { apply: opts.apply, cutoff, stale, deleted };
}
