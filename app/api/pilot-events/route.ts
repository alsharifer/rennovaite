import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { computePilotMetrics, type PilotEvent } from "@/lib/pilot/events";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Garden pilot instrumentation (G5). POST logs a friction point from the design
// session — the list is pilot data, so it is captured where it happens rather
// than remembered afterwards. GET returns the computed metrics.

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

const FrictionSchema = z.object({
  project_id: z.string().uuid(),
  note: z.string().trim().min(3).max(2000),
  /** Where it happened: plan, elements, lighting, renders, boq, pack … */
  area: z.string().trim().max(60).optional(),
});

/** G5d: a design-session decision (a Sheet B/C answer), recorded as it is applied. */
const DecisionSchema = z.object({
  project_id: z.string().uuid(),
  kind: z.literal("session_decision"),
  record: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(2000),
  applied: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest) {
  if (process.env.GARDEN_PILOT_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body && typeof body === "object" && (body as { kind?: unknown }).kind === "session_decision") {
    const d = DecisionSchema.safeParse(body);
    if (!d.success) return NextResponse.json({ error: d.error.message }, { status: 400 });
    const { project_id: pid, kind, ...detail } = d.data;
    const { error } = await db().from("pilot_events").insert({ project_id: pid, kind, detail: { ...detail, stage: "design_session" } });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }
  const parsed = FrictionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { project_id, note, area } = parsed.data;
  const { error } = await db().from("pilot_events").insert({ project_id, kind: "friction", detail: { note, area: area ?? null } });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  if (process.env.GARDEN_PILOT_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "project_id (uuid) required." }, { status: 400 });
  }
  const [events, renders, corrections] = await Promise.all([
    db().from("pilot_events").select("kind, recorded_at, detail").eq("project_id", projectId).order("recorded_at"),
    db().from("renders").select("view, gate").eq("project_id", projectId).eq("mode", "scene"),
    db().from("boq_corrections").select("correction_type").eq("project_id", projectId),
  ]);
  if (events.error) return NextResponse.json({ error: events.error.message }, { status: 500 });
  const metrics = computePilotMetrics((events.data ?? []) as PilotEvent[], renders.data ?? [], corrections.data ?? []);
  return NextResponse.json({ project_id: projectId, metrics });
}
