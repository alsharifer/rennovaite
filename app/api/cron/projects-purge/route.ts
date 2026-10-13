import { createHash, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { sweepIntakeDrafts } from "@/lib/projects/intake";
import { purgeExpiredProjects } from "@/lib/projects/lifecycle";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// K10 (spec §6.12) — the daily project purge (vercel.json "crons"). Projects
// soft-deleted more than 30 days ago are removed permanently: their Storage
// objects (uploads, assets, renders, packs, drawings — projectStoragePrefixes
// in lib/projects/lifecycle.ts) and then the row, whose FK graph cascades.
//
// Not a user route: Vercel Cron calls it with `Authorization: Bearer
// <CRON_SECRET>` (public list in lib/auth/access.ts; fails closed without the
// secret). DRY-RUN — logs what it would remove — until
// PROJECT_PURGE_APPLY="true". The log carries project ids and counts, never names.
function sameSecret(given: string, expected: string): boolean {
  const h = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(h(given), h(expected));
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "The purge is not configured (CRON_SECRET).", code: "not_configured" }, { status: 503 });
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "Not allowed.", code: "unauthenticated" }, { status: 401 });
  const apply = process.env.PROJECT_PURGE_APPLY === "true";
  try {
    // K11 #1: intake drafts older than 24 h are soft-deleted first — always (reversible; nothing leaves the database).
    const drafts = await sweepIntakeDrafts(getSupabaseAdmin() as unknown as SupabaseClient);
    if (drafts.length > 0) console.log(`[cron/projects-purge] intake drafts soft-deleted=${drafts.length}`, drafts);
    const report = await purgeExpiredProjects(getSupabaseAdmin() as unknown as SupabaseClient, { apply });
    const objects = report.projects.reduce((s, p) => s + p.objects, 0);
    console.log(
      `[cron/projects-purge] ${apply ? "APPLY" : "DRY-RUN"} cutoff=${report.cutoff} projects=${report.projects.length} objects=${objects}`,
      report.projects.map((p) => `${p.projectId}:${p.objects}:${JSON.stringify(p.byBucket)}`),
    );
    return NextResponse.json({ apply, cutoff: report.cutoff, drafts_swept: drafts, projects: report.projects.map((p) => ({ id: p.projectId, objects: p.objects, by_bucket: p.byBucket })) });
  } catch (e) {
    console.error("[cron/projects-purge] failed", e);
    return NextResponse.json({ error: "Purge failed.", code: "purge_failed" }, { status: 500 });
  }
}
