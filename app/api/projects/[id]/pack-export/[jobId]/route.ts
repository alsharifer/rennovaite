import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { packExportEnabled } from "@/lib/documents/pack-export/guard";
import { loadPackJob, signedOutputs } from "@/lib/documents/pack-export/job";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// T5 — GET /api/projects/:id/pack-export/:jobId
// Progress while running; the checklist when blocked; the failed checks when a
// printed-content check failed; signed download links ONLY when every gate held.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; jobId: string }> }) {
  if (!packExportEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { id, jobId } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(jobId).success) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const job = await loadPackJob(db, jobId);
  if (!job || job.project_id !== id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const checks = (job.manifest?.checks as { label: string; ok: boolean; detail: string }[] | undefined) ?? [];
  return NextResponse.json({
    id: job.id,
    status: job.status,
    source: job.source,
    progress: job.progress,
    checklist: job.checklist,
    failed_checks: checks.filter((c) => !c.ok),
    checks_passed: checks.filter((c) => c.ok).length,
    checks_total: checks.length,
    error: job.error,
    downloads: await signedOutputs(db, job),
    created_at: job.created_at,
    finished_at: job.finished_at,
  });
}
