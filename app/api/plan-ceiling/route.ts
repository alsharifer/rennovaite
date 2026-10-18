import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { CEILING_BOUNDS_M } from "@/lib/plan/ceiling";
import { recordPilotEvent } from "@/lib/pilot/events";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// B1 (migration 061) — PATCH /api/plan-ceiling { plan_id, rooms: [{ id, ceiling_h_m }] }.
// A room's ceiling height on 01 Plan, for ANY room. A number stores it as
// MEASURED (someone typed it); null clears it back to the 2.9 m default,
// derived. Rooms of THAT PLAN only. Recorded as a `design_edit` on layer
// "ceiling" with each room's from → to, so the revision diff names it on the
// wall-area lines and Regenerate reads "Ceiling height changed since rev N".
// The cost follows on the next regenerate (a new revision). Any project member.
// The editor's plan save never sends the column, so it survives every save.
const Body = z.object({
  plan_id: z.string().uuid(),
  rooms: z
    .array(z.object({ id: z.string().uuid(), ceiling_h_m: z.number().min(CEILING_BOUNDS_M[0]).max(CEILING_BOUNDS_M[1]).nullable() }))
    .min(1)
    .max(500),
});

const to2dp = (n: number) => Math.round(n * 100) / 100;

export async function PATCH(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: `Body must be { plan_id, rooms: [{ id, ceiling_h_m }] } with heights ${CEILING_BOUNDS_M[0]}–${CEILING_BOUNDS_M[1]} m.`, code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const { plan_id, rooms } = body.data;
  const access = await projectAccess(db, caller, { plan_id });
  if (access.denied) return access.denied;

  const ids = rooms.map((r) => r.id);
  const { data: current, error } = await db.from("rooms").select("id, name_en, ceiling_h_m").eq("plan_id", plan_id).in("id", ids);
  if (error) {
    const missing = /ceiling_h|schema cache|does not exist/i.test(error.message);
    return NextResponse.json({ success: false, error: missing ? "Ceiling heights need migration 061 — apply it with npm run db:push." : error.message, code: missing ? "migration_required" : "read_failed" }, { status: 500 });
  }
  const now = new Map(((current ?? []) as { id: string; name_en: string | null; ceiling_h_m: number | null }[]).map((r) => [r.id, r]));
  if (now.size !== new Set(ids).size) return NextResponse.json({ success: false, error: "A room is not on this plan.", code: "room_not_found" }, { status: 404 });

  const moved: { id: string; name: string | null; from: number | null; to: number | null }[] = [];
  for (const r of rooms) {
    const before = now.get(r.id)!;
    const from = before.ceiling_h_m == null ? null : Number(before.ceiling_h_m);
    const to = r.ceiling_h_m == null ? null : to2dp(r.ceiling_h_m);
    if (from === to) continue;
    const { error: upErr } = await db
      .from("rooms")
      .update({ ceiling_h_m: to, ceiling_h_source: to == null ? null : "measured" })
      .eq("plan_id", plan_id)
      .eq("id", r.id);
    if (upErr) return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });
    moved.push({ id: r.id, name: before.name_en, from, to });
  }
  if (moved.length) {
    await recordPilotEvent(db, access.projectId!, "design_edit", { layer: "ceiling", plan_id, rooms: moved }, { actor: caller.id });
  }
  return NextResponse.json({ success: true, rooms: rooms.map((r) => ({ id: r.id, ceiling_h_m: r.ceiling_h_m == null ? null : to2dp(r.ceiling_h_m), ceiling_h_source: r.ceiling_h_m == null ? null : "measured" })), moved: moved.length });
}
