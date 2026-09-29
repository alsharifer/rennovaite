import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { listRevisions } from "@/lib/boq/revisions";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// U4 — GET /api/projects/:id/boq-revisions
//
// Every BoQ revision of the project (each generate-boq is a row; none is ever
// deleted), newest first, with its approval status. Signed-in callers only —
// a revision list is a price history.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to read BoQ revisions.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  try {
    const revisions = await listRevisions(getSupabaseAdmin() as unknown as SupabaseClient, id);
    return NextResponse.json({ success: true, revisions });
  } catch (e) {
    console.error("[api/boq-revisions]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Revision list failed." }, { status: 500 });
  }
}
