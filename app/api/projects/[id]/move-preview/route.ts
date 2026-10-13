import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { storeErrorResponse } from "@/lib/firms/http";
import { projectAccess } from "@/lib/projects/http";
import { moveFirmPreview } from "@/lib/projects/move-firm";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// K11 #5 — GET /api/projects/:id/move-preview. What "Move to firm…" offers:
// the caller's firms and "No firm — personal project", each allowed or not with
// its reason (the creator rule; who on the project is outside that firm; a
// member of the current firm to detach) — the same rules assignProjectFirm
// enforces on PATCH /api/projects/:id { firm_id }. Project members only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ success: false, error: "Invalid project id." }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { project_id: id.data });
  if (access.denied) return access.denied;
  try {
    return NextResponse.json({ success: true, ...(await moveFirmPreview(db, id.data, caller)) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
