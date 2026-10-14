import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { recordPilotEvent } from "@/lib/pilot/events";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// R10b: the owner confirms openings found on the drawing.
//
//   POST { plan_id, ids: [...] }   confirm these
//   POST { plan_id, all: true }    "Confirm all"
//
// Confirmed = its POSITION and KIND are the owner's (confirmed_at / confirmed_by);
// its WIDTH stays derived — "Confirm all" never upgrades an estimated size. Only
// editing the size on the plan (or a width printed on the drawing) measures it.
// derivePlanGraph counts the opening from now on — so it takes effect on the
// next regenerate, under the cause "Openings confirmed" (a design_edit event,
// layer "openings_confirmed"). Only unconfirmed DETECTED rows of THIS plan are
// touched; an id from another plan matches nothing.

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

const Schema = z.union([
  z.object({ plan_id: z.string().uuid(), ids: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ plan_id: z.string().uuid(), all: z.literal(true) }),
]);

export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const b = parsed.data;
  const access = await projectAccess(db(), caller, { plan_id: b.plan_id });
  if (access.denied) return access.denied;
  try {
    let q = db()
      .from("plan_openings")
      .update({ confirmed_at: new Date().toISOString(), confirmed_by: caller.id })
      .eq("plan_id", b.plan_id)
      .eq("source", "detected")
      .is("confirmed_at", null);
    if ("ids" in b) q = q.in("id", b.ids);
    const { data, error } = await q.select("id");
    if (error) throw error;
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length) {
      await recordPilotEvent(db(), access.projectId!, "design_edit", { layer: "openings_confirmed", plan_id: b.plan_id, opening_ids: ids, count: ids.length }, { actor: caller.id });
    }
    return NextResponse.json({ confirmed: ids });
  } catch (err) {
    console.error("[api/plan-openings/confirm] error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to confirm." }, { status: 500 });
  }
}
