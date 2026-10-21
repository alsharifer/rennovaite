import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { memberName } from "@/lib/boq/apply-correction";
import { changeFor, reviewKey, type InstallField } from "@/lib/boq/install-classes";
import { wetRoomChoicesOf, WET_ROOM_TYPES } from "@/lib/boq/wet-room";
import { recordPilotEvent } from "@/lib/pilot/events";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// C3 — POST /api/projects/:id/scope-review { field }: a member marks a product
// swap's scope change reviewed ("shower valve concealed → exposed: …"). The
// lines it flagged ("Scope review needed") keep their figures — re-price them
// first (Add a price) if they are wrong — and stop blocking the export once
// the BoQ is regenerated. Recorded on the room (rooms.spec.wet_room.reviewed +
// reviewed_log) and as a design edit naming who reviewed what. Members only.

const Body = z.object({ field: z.enum(["shower_valve", "wc_mount", "basin_mount"]) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const projectId = (await params).id;
  const body = Body.safeParse(await request.json().catch(() => null));
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { project_id: projectId });
  if (access.denied) return access.denied;
  if (!body.success) return NextResponse.json({ success: false, error: "Name the change to review.", code: "bad_request" }, { status: 400 });
  const field = body.data.field as InstallField;

  const { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  const { data: rooms } = plan ? await db.from("rooms").select("id, room_type, spec, in_scope").eq("plan_id", plan.id) : { data: null };
  const wet = ((rooms ?? []) as { id: string; room_type: string | null; spec: Record<string, unknown> | null; in_scope: boolean | null }[]).filter((r) => r.in_scope !== false && WET_ROOM_TYPES.has(r.room_type ?? ""));
  if (wet.length !== 1) return NextResponse.json({ success: false, error: "Scope reviews are for a project that is one bathroom.", code: "not_a_wet_room" }, { status: 422 });
  const room = wet[0]!;
  const value = wetRoomChoicesOf(room.spec)[field];
  const change = changeFor(field, value);
  if (!change || change.mode !== "review") return NextResponse.json({ success: false, error: "Nothing to review — this product is installed as the BoQ assumes.", code: "nothing_to_review" }, { status: 409 });

  const prior = (room.spec?.wet_room as Record<string, unknown> | undefined) ?? {};
  const key = reviewKey(field, value);
  const reviewed = [...new Set([...(Array.isArray(prior.reviewed) ? (prior.reviewed as string[]) : []), key])];
  const by_name = await memberName(db, caller);
  const log = [...(Array.isArray(prior.reviewed_log) ? (prior.reviewed_log as unknown[]) : []), { key, what: change.what, by: caller.id, by_name, at: new Date().toISOString() }];
  const { error } = await db.from("rooms").update({ spec: { ...(room.spec ?? {}), wet_room: { ...prior, reviewed, reviewed_log: log } } }).eq("id", room.id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  await recordPilotEvent(db, projectId, "design_edit", { layer: "scope_review", room_id: room.id, field, value, what: change.what, by_name, line_keys: [...change.dependent] }, { actor: caller.id });
  return NextResponse.json({ success: true, reviewed: key });
}
