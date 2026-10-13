import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { revertToRevision } from "@/lib/boq/apply-correction";
import { storeErrorResponse } from "@/lib/firms/http";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// K11 #4 (spec §7.3) — POST /api/projects/:id/boq-revert { to_boq_id }.
// "Undo = revert in Revisions": stores rev N's document as the next revision
// (nothing is deleted) and marks the corrections applied after rev N as
// reverted — kept on record, no longer applied by a regeneration. Any project
// member, like regenerating.
const Body = z.object({ to_boq_id: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ success: false, error: "Invalid project id." }, { status: 400 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: "Body must be { to_boq_id: uuid }.", code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { project_id: id.data, boq_id: body.data.to_boq_id });
  if (access.denied) return access.denied;
  try {
    const r = await revertToRevision(db, id.data, caller, body.data.to_boq_id);
    return NextResponse.json({ success: true, boq_id: r.boqId, rev: r.rev, reverted_to_rev: r.toRev, previous_boq_id: r.previousBoqId, grand_total_aed: r.total, reverted_corrections: r.reverted });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
