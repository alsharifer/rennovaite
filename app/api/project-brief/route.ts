import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  recommendStyle,
  sanitiseAnswers,
  type BriefAnswers,
} from "@/lib/ideation/questionnaire";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getStyleByKey } from "@/lib/styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// B1 ideation brief — questionnaire answers + the derived recommendation.
//
// The recommendation is recomputed server-side from the answers on every write,
// so `recommended_style_key` is always a pure function of `answers` and can be
// re-run at will. A manual pick lands in `override_style_key` and is NEVER
// touched by a re-run — that separation is what makes the flow safe to redo.
// =============================================================================

const SELECT_COLS =
  "project_id, answers, recommended_style_key, recommendation, override_style_key, completed_at, created_at, updated_at";

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

/** GET /api/project-brief?project_id=… — the brief, or an empty one. */
export async function GET(request: NextRequest) {
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "project_id (uuid) required." }, { status: 400 });
  }
  try {
    const { data, error } = await db()
      .from("project_briefs")
      .select(SELECT_COLS)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) {
      console.warn("[api/project-brief] GET degraded:", error.message);
      return NextResponse.json({ brief: null, degraded: true });
    }
    return NextResponse.json({ brief: data ?? null });
  } catch (err) {
    console.warn("[api/project-brief] GET degraded:", err instanceof Error ? err.message : err);
    return NextResponse.json({ brief: null, degraded: true });
  }
}

const SaveSchema = z.object({
  project_id: z.string().uuid(),
  /** Partial answers are fine — the recommender handles an incomplete brief. */
  answers: z.record(z.string(), z.unknown()).optional(),
  /**
   * Manual style pick. `null` clears it and hands control back to the
   * recommendation; omitting the field leaves any existing override alone.
   */
  override_style_key: z.string().nullable().optional(),
  /** Mark the questionnaire finished (sets completed_at). */
  complete: z.boolean().optional(),
});

/**
 * POST /api/project-brief — upsert answers and/or the manual override.
 *
 * Always recomputes the recommendation from the resulting answers. Returns the
 * stored row so the client never has to guess what the server decided.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = SaveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { project_id, complete } = parsed.data;
    const supabase = db();

    const { data: existing } = await supabase
      .from("project_briefs")
      .select(SELECT_COLS)
      .eq("project_id", project_id)
      .maybeSingle<{ answers: BriefAnswers; override_style_key: string | null; completed_at: string | null }>();

    // Answers merge onto what is stored, so a single-question save works.
    const answers: BriefAnswers = parsed.data.answers
      ? sanitiseAnswers({ ...(existing?.answers ?? {}), ...parsed.data.answers })
      : sanitiseAnswers(existing?.answers ?? {});

    const rec = recommendStyle(answers);

    // Override: only change it when the caller actually sent the field.
    let override = existing?.override_style_key ?? null;
    if (parsed.data.override_style_key !== undefined) {
      const k = parsed.data.override_style_key;
      if (k !== null && !getStyleByKey(k)) {
        return NextResponse.json({ error: `Unknown style key: ${k}` }, { status: 400 });
      }
      override = k;
    }

    const row = {
      project_id,
      answers,
      recommended_style_key: rec.recommended_style_key,
      recommendation: rec as unknown as Record<string, unknown>,
      override_style_key: override,
      completed_at: complete
        ? (existing?.completed_at ?? new Date().toISOString())
        : (existing?.completed_at ?? null),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("project_briefs")
      .upsert(row, { onConflict: "project_id" })
      .select(SELECT_COLS)
      .single();
    if (error || !data) throw error ?? new Error("Failed to save the brief.");

    return NextResponse.json({ brief: data, recommendation: rec });
  } catch (err) {
    console.error("[api/project-brief] POST error", err);
    const message = err instanceof Error ? err.message : "Failed to save the brief.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
