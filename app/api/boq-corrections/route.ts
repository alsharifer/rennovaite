import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { recordPilotEvent } from "@/lib/pilot/events";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// G5: corrections captured at the review session. THE pilot metric is how many
// there are and of which type — rate | quantity | scope | design — so each is
// typed at capture, carries market_fair provenance (a correction from the people
// who price and build gardens in this market), and is never applied silently to
// the rate book: capturing a correction and changing a rate are separate acts.

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

const PostSchema = z.object({
  project_id: z.string().uuid(),
  boq_id: z.string().uuid().nullable().optional(),
  item_key: z.string().max(120).nullable().optional(),
  line_description: z.string().trim().min(1).max(500),
  // G5d: "confirm" — a firm saying a line (or the whole BoQ) is right is a milestone,
  // and the metric counts it like any other typed reaction.
  correction_type: z.enum(["rate", "quantity", "scope", "design", "confirm"]),
  field: z.string().max(60).nullable().optional(),
  old_value: z.number().finite().nullable().optional(),
  new_value: z.number().finite().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  element_refs: z.array(z.string()).max(200).nullable().optional(),
  /** G5d (040): the firm that made it — on its own corrections, nowhere else. */
  attributed_to: z.string().trim().max(120).nullable().optional(),
  confidence: z.enum(["firm", "estimate"]).nullable().optional(),
  session_ref: z.string().trim().max(200).nullable().optional(),
});

export async function POST(request: NextRequest) {
  if (process.env.GARDEN_PILOT_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const b = parsed.data;
  const { data, error } = await db()
    .from("boq_corrections")
    .insert({ ...b, provenance: "market_fair" })
    .select("id, correction_type, line_description, old_value, new_value, note, attributed_to, confidence, session_ref, recorded_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // G5d: every correction is also a pilot event, so the metrics read corrections by
  // type per session record. A session-captured one is real session data.
  await recordPilotEvent(db(), b.project_id, "correction", {
    correction_type: b.correction_type,
    ...(b.session_ref ? { record: b.session_ref, stage: "design_session" } : {}),
    correction_id: (data as { id: string }).id,
  });
  return NextResponse.json({ correction: data });
}

export async function GET(request: NextRequest) {
  if (process.env.GARDEN_PILOT_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) return NextResponse.json({ error: "project_id (uuid) required." }, { status: 400 });
  const { data, error } = await db()
    .from("boq_corrections")
    .select("id, boq_id, item_key, line_description, correction_type, provenance, field, old_value, new_value, note, attributed_to, confidence, session_ref, recorded_at")
    .eq("project_id", projectId)
    .order("recorded_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const by_type = { rate: 0, quantity: 0, scope: 0, design: 0, confirm: 0 } as Record<string, number>;
  for (const c of data ?? []) by_type[c.correction_type as string] = (by_type[c.correction_type as string] ?? 0) + 1;
  return NextResponse.json({ corrections: data ?? [], total: (data ?? []).length, by_type });
}
