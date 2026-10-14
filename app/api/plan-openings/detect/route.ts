import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { runOpeningsDetection } from "@/lib/plan/openings-detect";
import type { DetectionRun } from "@/lib/plan/openings-vocab";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One vision call over the drawing — well under a minute, with room for a retry.
export const maxDuration = 300;

// R10b: windows, doors and openings found on the drawing.
//
//   GET  ?plan_id=…                 the plan's detection state
//   POST { plan_id, mode }          mode "auto" runs once per plan (after the
//                                   plan is read, or lazily the first time Plan
//                                   or Renders is opened); "redetect" runs again
//                                   on demand. Answers when the run finishes.

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const planId = new URL(request.url).searchParams.get("plan_id");
  if (!planId || !z.string().uuid().safeParse(planId).success) {
    return NextResponse.json({ error: "plan_id (uuid) required." }, { status: 400 });
  }
  const access = await projectAccess(db(), caller, { plan_id: planId });
  if (access.denied) return access.denied;
  const { data, error } = await db().from("plans").select("openings_detected_at, openings_detection").eq("id", planId).maybeSingle<{ openings_detected_at: string | null; openings_detection: DetectionRun | null }>();
  if (error) return NextResponse.json({ error: error.message, code: "migration_required" }, { status: 500 });
  return NextResponse.json({ detected_at: data?.openings_detected_at ?? null, run: data?.openings_detection ?? null });
}

const PostSchema = z.object({ plan_id: z.string().uuid(), mode: z.enum(["auto", "redetect"]).default("auto") });

export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const access = await projectAccess(db(), caller, { plan_id: parsed.data.plan_id });
  if (access.denied) return access.denied;
  try {
    const outcome = await runOpeningsDetection(db(), parsed.data.plan_id, parsed.data.mode);
    return NextResponse.json(outcome, { status: outcome.status === "failed" ? 502 : 200 });
  } catch (err) {
    console.error("[api/plan-openings/detect] error", err);
    return NextResponse.json({ status: "failed", error: err instanceof Error ? err.message : "Detection failed." }, { status: 500 });
  }
}
