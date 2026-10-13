import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { releaseCorrection } from "@/lib/boq/apply-correction";
import { storeErrorResponse } from "@/lib/firms/http";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// K11 — POST /api/projects/:id/boq-release { correction_id }. "Remove" on an
// applied price that no longer matches a line (Issues navigator): it stops
// applying — reverted, kept on record; no revision (the current one prices
// nothing with it). Any project member.
const Body = z.object({ correction_id: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ success: false, error: "Invalid project id." }, { status: 400 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: "Body must be { correction_id: uuid }.", code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { project_id: id.data });
  if (access.denied) return access.denied;
  try {
    await releaseCorrection(db, id.data, caller, body.data.correction_id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
