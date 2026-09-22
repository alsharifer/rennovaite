import { after, NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { packExportEnabled } from "@/lib/documents/pack-export/guard";
import { createPackJob, finishPackJob, latestPackJobs, progressWriter, storageSink } from "@/lib/documents/pack-export/job";
import { preflightChecklist } from "@/lib/documents/pack-export/preflight";
import { runPackExport } from "@/lib/documents/pack-export/run";
import { httpTransport } from "@/lib/documents/pack-export/transport";
import { DEFAULT_PACK_OPTIONS, type PackExportOptions } from "@/lib/documents/pack-export/types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The job runs in after(), i.e. within this route's budget — 300 s is the
// platform ceiling (every long route here uses it). A garden that needs longer
// than that is exported from the CLI, which has no such limit.
export const maxDuration = 300;

// T5 — the in-app "Export pack" action.
//
//   GET  /api/projects/:id/pack-export   the export gate as a checklist (nothing
//                                         runs) + the latest jobs
//   POST /api/projects/:id/pack-export   { display_name?, renders?: "full" | "cached", pairs? }
//        → { job_id }. The job runs after the response (next/server after()),
//          through lib/documents/pack-export/run.ts — the SAME module the CLI
//          (scripts/garden-draft-pack.ts) runs. Poll /pack-export/:jobId.
// Invisible (404) unless PACK_EXPORT_ENABLED and DRAWINGS_ENABLED are on.

const PostSchema = z.object({
  display_name: z.string().trim().min(1).max(200).nullable().optional(),
  renders: z.enum(["full", "cached"]).optional(),
  pairs: z.number().int().min(0).max(6).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

async function projectIdOf(ctx: Ctx): Promise<string | null> {
  const { id } = await ctx.params;
  return z.string().uuid().safeParse(id).success ? id : null;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!packExportEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const projectId = await projectIdOf(ctx);
  if (!projectId) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const [preflight, jobs] = await Promise.all([preflightChecklist(db, projectId), latestPackJobs(db, projectId)]);
  return NextResponse.json({ ...preflight, jobs: jobs.map((j) => ({ id: j.id, status: j.status, source: j.source, created_at: j.created_at, finished_at: j.finished_at })) });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  if (!packExportEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const projectId = await projectIdOf(ctx);
  if (!projectId) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const parsed = PostSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;

  // The client-facing name is part of the gate: set it here, the run checks it.
  if (parsed.data.display_name !== undefined) {
    await db.from("projects").update({ display_name: parsed.data.display_name }).eq("id", projectId);
  }
  const options: PackExportOptions = {
    ...DEFAULT_PACK_OPTIONS,
    renders: parsed.data.renders ?? DEFAULT_PACK_OPTIONS.renders,
    pairs: parsed.data.pairs ?? DEFAULT_PACK_OPTIONS.pairs,
  };
  const job = await createPackJob(db, projectId, "app", options);
  const origin = new URL(request.url).origin;

  after(async () => {
    const pw = progressWriter(db, job.id);
    try {
      const result = await runPackExport({
        projectId,
        db,
        transport: httpTransport(origin, job.id),
        sink: storageSink(db, projectId, job.id),
        options,
        source: "app",
        onProgress: pw.onProgress,
        log: pw.log,
      });
      await finishPackJob(db, job.id, result, null);
    } catch (e) {
      await finishPackJob(db, job.id, null, e instanceof Error ? e.message : String(e));
    }
  });
  return NextResponse.json({ job_id: job.id }, { status: 202 });
}
