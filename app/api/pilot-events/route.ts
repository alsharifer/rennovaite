import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated, type Caller } from "@/lib/auth/caller";
import { storeErrorResponse } from "@/lib/firms/http";
import { requireFirm } from "@/lib/firms/store";
import { computePilotMetrics, recordPilotEvent, type PilotEvent } from "@/lib/pilot/events";
import { loadFirmEvidence } from "@/lib/pilot/load";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pilot instrumentation (G5 → L5).
//
//   POST  friction { project_id, note, area? }
//         session_decision { project_id, kind, record, question, answer, applied? }
//         support_touch { project_id?, firm_id?, kind, channel, note, resolved? }   (L5)
//   GET   ?project_id=   the G5 per-project metrics
//         ?firm_id=      the L5 per-firm rollup
// L5 lifted the GARDEN_PILOT_ENABLED gate: interior firm projects record too.
// H1: every call needs a signed-in caller, who is the events' actor.

/** GET ?firm_id= — the L5 per-firm rollup. H5: a firm's rollup is its members' to read. */
async function firmRollup(firmId: string, caller: Caller): Promise<NextResponse> {
  if (!z.string().uuid().safeParse(firmId).success) return NextResponse.json({ error: "firm_id must be a uuid." }, { status: 400 });
  const denied = await firmDenied(firmId, caller);
  if (denied) return denied;
  const evidence = await loadFirmEvidence(db(), [firmId]);
  const firm = evidence.firms[0];
  if (!firm) return NextResponse.json({ error: "Firm not found." }, { status: 404 });
  return NextResponse.json({ firm });
}

/** 401 / 404 / 403 for a firm the caller does not belong to (lib/firms/store.ts → requireFirm). */
async function firmDenied(firmId: string, caller: Caller): Promise<NextResponse | null> {
  try {
    await requireFirm(db(), firmId, caller);
    return null;
  } catch (e) {
    return storeErrorResponse(e);
  }
}

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

/** L5: a support touch — a help request, an intervention by us, a reported error. */
const SupportSchema = z
  .object({
    kind: z.literal("support_touch"),
    project_id: z.string().uuid().nullable().optional(),
    firm_id: z.string().uuid().nullable().optional(),
    channel: z.enum(["in_app", "call", "chat", "email", "session", "intervention", "error"]),
    note: z.string().trim().min(3).max(2000),
    resolved: z.boolean().optional(),
    session_ref: z.string().trim().max(200).nullable().optional(),
  })
  .refine((b) => !!b.project_id || !!b.firm_id, "project_id or firm_id is required.");

export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const body = await request.json().catch(() => null);
  const kind = body && typeof body === "object" ? (body as { kind?: unknown }).kind : undefined;
  const actor = caller.id;
  if (kind === "session_decision") {
    const d = DecisionSchema.safeParse(body);
    if (!d.success) return NextResponse.json({ error: d.error.message }, { status: 400 });
    const { project_id: pid, kind: k, ...detail } = d.data;
    const access = await projectAccess(db(), caller, { project_id: pid });
    if (access.denied) return access.denied;
    await recordPilotEvent(db(), pid, k, { ...detail, stage: "design_session" }, { actor, sessionRef: d.data.record });
    return NextResponse.json({ success: true });
  }
  if (kind === "support_touch") {
    const s = SupportSchema.safeParse(body);
    if (!s.success) return NextResponse.json({ error: s.error.message }, { status: 400 });
    const { project_id: pid, firm_id, kind: k, session_ref, ...detail } = s.data;
    // H5: a touch on a project needs its membership; a firm-level touch, the firm's.
    if (pid) {
      const access = await projectAccess(db(), caller, { project_id: pid });
      if (access.denied) return access.denied;
    } else {
      const denied = await firmDenied(firm_id!, caller);
      if (denied) return denied;
    }
    await recordPilotEvent(db(), pid ?? null, k, { ...detail, resolved: detail.resolved ?? false }, { actor, firmId: firm_id ?? null, sessionRef: session_ref ?? null });
    return NextResponse.json({ success: true });
  }
  const parsed = FrictionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { project_id, note, area } = parsed.data;
  const access = await projectAccess(db(), caller, { project_id });
  if (access.denied) return access.denied;
  await recordPilotEvent(db(), project_id, "friction", { note, area: area ?? null }, { actor });
  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to read pilot metrics.");
  const url = new URL(request.url);
  const firmId = url.searchParams.get("firm_id");
  if (firmId) return firmRollup(firmId, caller);
  const projectId = url.searchParams.get("project_id");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "project_id (uuid) or firm_id (uuid) required." }, { status: 400 });
  }
  const access = await projectAccess(db(), caller, { project_id: projectId });
  if (access.denied) return access.denied;
  const [events, renders, corrections] = await Promise.all([
    db().from("pilot_events").select("kind, recorded_at, detail").eq("project_id", projectId).order("recorded_at"),
    db().from("renders").select("view, gate").eq("project_id", projectId).eq("mode", "scene"),
    db().from("boq_corrections").select("correction_type").eq("project_id", projectId),
  ]);
  if (events.error) return NextResponse.json({ error: events.error.message }, { status: 500 });
  const metrics = computePilotMetrics((events.data ?? []) as PilotEvent[], renders.data ?? [], corrections.data ?? []);
  return NextResponse.json({ project_id: projectId, metrics });
}
