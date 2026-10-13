import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { storeErrorResponse } from "@/lib/firms/http";
import { restoreProject } from "@/lib/projects/lifecycle";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// K10 (spec §6.12) — POST /api/projects/:id/restore. Brings a soft-deleted
// project back exactly as it was (same members, same revisions: a soft delete
// changes nothing but the mark). Any member of the project; a deleted project
// is not found through projectAccess, so membership is checked in
// lib/projects/lifecycle.ts (restoreProject → requireMember: 401 → 404).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid project id." }, { status: 400 });
  try {
    await restoreProject(getSupabaseAdmin() as unknown as SupabaseClient, parsed.data, caller);
    return NextResponse.json({ success: true });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
