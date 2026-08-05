import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Records a parse-metrics row: correction counts from an editor save, or a
// single "flag an issue" event (needed_split / needed_merge). Best-effort by
// design — the editor posts fire-and-forget, and the table may be absent until
// migration 025 is applied.
const BodySchema = z.object({
  plan_id: z.string().uuid(),
  kind: z.enum(["parse", "corrections"]).default("corrections"),
  provider: z.string().nullish(),
  room_count: z.number().int().nullish(),
  mean_confidence: z.number().nullish(),
  low_confidence_count: z.number().int().nullish(),
  corrections: z.record(z.string(), z.number()).nullish(),
  correction_total: z.number().int().nullish(),
  needed_split_count: z.number().int().nullish(),
  needed_merge_count: z.number().int().nullish(),
  detail: z.record(z.string(), z.unknown()).nullish(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
    }
    const b = parsed.data;
    const sb = getSupabaseAdmin() as unknown as SupabaseClient;

    const { data: plan } = await sb
      .from("plans")
      .select("project_id")
      .eq("id", b.plan_id)
      .maybeSingle<{ project_id: string | null }>();
    const projectId = plan?.project_id ?? null;
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Plan not found." }, { status: 404 });
    }

    const { error } = await sb.from("parse_metrics").insert({
      project_id: projectId,
      plan_id: b.plan_id,
      kind: b.kind,
      provider: b.provider ?? null,
      room_count: b.room_count ?? null,
      mean_confidence: b.mean_confidence ?? null,
      low_confidence_count: b.low_confidence_count ?? null,
      corrections: b.corrections ?? {},
      correction_total: b.correction_total ?? 0,
      needed_split_count: b.needed_split_count ?? 0,
      needed_merge_count: b.needed_merge_count ?? 0,
      detail: b.detail ?? {},
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/parse-metrics] error", err);
    const message = err instanceof Error ? err.message : "Failed to record parse metrics.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
