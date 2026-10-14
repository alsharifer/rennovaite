import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { recordPilotEvent } from "@/lib/pilot/events";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// K12 (spec §7.4, migration 058) — PATCH /api/plan-scope { plan_id, rooms: [{ id, in_scope }] }.
// "Rooms in this renovation" on 01 Plan. Writes rooms.in_scope for rooms OF
// THAT PLAN only, and records the change as a `design_edit` event on layer
// "scope" with the rooms added and removed — the revision diff names it
// ("Scope: 2 rooms removed") and the Regenerate control reads it ("Scope
// changed since rev N"). The cost follows on the next regenerate (a new
// revision). Any project member.
const Body = z.object({
  plan_id: z.string().uuid(),
  rooms: z.array(z.object({ id: z.string().uuid(), in_scope: z.boolean() })).min(1).max(500),
});

export async function PATCH(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: "Body must be { plan_id, rooms: [{ id, in_scope }] }.", code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const { plan_id, rooms } = body.data;
  const access = await projectAccess(db, caller, { plan_id });
  if (access.denied) return access.denied;

  const ids = rooms.map((r) => r.id);
  const { data: current, error } = await db.from("rooms").select("id, in_scope").eq("plan_id", plan_id).in("id", ids);
  if (error) {
    const missing = /in_scope|schema cache|does not exist/i.test(error.message);
    return NextResponse.json({ success: false, error: missing ? "Choosing rooms needs migration 058 — apply it with npm run db:push." : error.message, code: missing ? "migration_required" : "read_failed" }, { status: 500 });
  }
  const now = new Map(((current ?? []) as { id: string; in_scope: boolean | null }[]).map((r) => [r.id, r.in_scope !== false]));
  if (now.size !== new Set(ids).size) return NextResponse.json({ success: false, error: "A room is not on this plan.", code: "room_not_found" }, { status: 404 });

  const added = rooms.filter((r) => r.in_scope && now.get(r.id) === false).map((r) => r.id);
  const removed = rooms.filter((r) => !r.in_scope && now.get(r.id) === true).map((r) => r.id);
  for (const [value, list] of [[true, added], [false, removed]] as const) {
    if (list.length === 0) continue;
    const { error: upErr } = await db.from("rooms").update({ in_scope: value }).eq("plan_id", plan_id).in("id", list);
    if (upErr) return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });
  }
  if (added.length || removed.length) {
    await recordPilotEvent(db, access.projectId!, "design_edit", { layer: "scope", plan_id, added, removed }, { actor: caller.id });
  }
  const { data: all } = await db.from("rooms").select("id, in_scope").eq("plan_id", plan_id);
  const list = (all ?? []) as { in_scope: boolean | null }[];
  return NextResponse.json({ success: true, added, removed, in_scope: list.filter((r) => r.in_scope !== false).length, total: list.length });
}
