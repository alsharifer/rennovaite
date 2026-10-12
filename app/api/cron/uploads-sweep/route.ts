import { createHash, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sweepStaleUploads } from "@/lib/uploads/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// H9 — the daily orphan sweep (vercel.json "crons"). Pending uploads never
// completed and staged downloads, older than 24 h (lib/uploads/sweep.ts).
//
// Not a user route: Vercel Cron calls it with `Authorization: Bearer
// <CRON_SECRET>`, so it is on the public list (lib/auth/access.ts) and checks
// that secret itself — FAIL CLOSED: no CRON_SECRET configured, no sweep.
// Dry-run (logs what it would delete) until UPLOAD_SWEEP_APPLY="true".
/** Constant-time comparison (hashed first, so the lengths match). */
function sameSecret(given: string, expected: string): boolean {
  const h = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(h(given), h(expected));
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "The sweep is not configured (CRON_SECRET).", code: "not_configured" }, { status: 503 });
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "Not allowed.", code: "unauthenticated" }, { status: 401 });
  const apply = process.env.UPLOAD_SWEEP_APPLY === "true";
  try {
    const report = await sweepStaleUploads(getSupabaseAdmin() as unknown as SupabaseClient, { apply });
    console.log(`[cron/uploads-sweep] ${apply ? "APPLY" : "DRY-RUN"} cutoff=${report.cutoff} stale=${report.stale.length} deleted=${report.deleted}`, report.stale.slice(0, 50).map((s) => `${s.bucket}/${s.path}`));
    return NextResponse.json({ apply, cutoff: report.cutoff, stale: report.stale.length, deleted: report.deleted });
  } catch (e) {
    console.error("[cron/uploads-sweep] failed", e);
    return NextResponse.json({ error: "Sweep failed.", code: "sweep_failed" }, { status: 500 });
  }
}
