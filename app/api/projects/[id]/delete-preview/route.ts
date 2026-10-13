import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { storeErrorResponse } from "@/lib/firms/http";
import { deletePreview } from "@/lib/projects/lifecycle";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// K10 (spec §6.12) — GET /api/projects/:id/delete-preview. What the confirm
// dialog lists: the real counts (BoQ revisions, renders + locked designs,
// uploaded drawings / photos, issued proposals), whether a proposal left for a
// client (the inverse warning + Download pack), the name to type, and whether
// THIS caller may delete (with the reason when not). Members only
// (deletePreview → requireMember: 401 → 404); a deleted project is not found.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid project id." }, { status: 400 });
  try {
    return NextResponse.json({ success: true, ...(await deletePreview(getSupabaseAdmin() as unknown as SupabaseClient, parsed.data, caller)) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
