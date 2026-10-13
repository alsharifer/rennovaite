import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { storeErrorResponse } from "@/lib/firms/http";
import { deleteNow } from "@/lib/projects/lifecycle";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// K10 (spec §6.12) — POST /api/projects/:id/delete-now { confirm_name }.
// "Delete now" from Recently deleted: the purge at once — Storage objects,
// then the row (the FK graph cascades). The same roles as delete (owner
// project's creator / firm admin, 403 otherwise), only for a project already
// in Recently deleted (409 not_deleted), and only with the name typed again
// (422 name_mismatch). Irreversible.
const Body = z.object({ confirm_name: z.string().max(400) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid project id." }, { status: 400 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: "Body must be { confirm_name: string }.", code: "bad_request" }, { status: 400 });
  try {
    const r = await deleteNow(getSupabaseAdmin() as unknown as SupabaseClient, parsed.data, caller, body.data.confirm_name);
    return NextResponse.json({ success: true, objects: r.objects });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
