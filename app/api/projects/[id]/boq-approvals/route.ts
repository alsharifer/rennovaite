import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { listApprovals, recordApproval } from "@/lib/boq/approvals";
import { storeErrorResponse } from "@/lib/firms/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// U4 — the approval trail of a project's BoQ revisions.
//
//   GET  /api/projects/:id/boq-approvals                 every approval, oldest first (signed in)
//   POST /api/projects/:id/boq-approvals                 { boq_id, kind: "firm" | "client", client_name?, client_date?, note? }
//        firm    — the caller marks the revision approved (a MEMBER of the project's firm, when it has one)
//        client  — the caller RECORDS the client's approval with the name + date the client gave
// Append-only: there is no PATCH and no DELETE.

const PostSchema = z.object({
  boq_id: z.string().uuid(),
  kind: z.enum(["firm", "client"]),
  client_name: z.string().trim().max(120).nullable().optional(),
  client_date: z.string().trim().max(10).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to read approvals.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  try {
    return NextResponse.json({ success: true, approvals: await listApprovals(db(), id) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to approve a BoQ revision.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const approval = await recordApproval(db(), id, parsed.data, caller);
    return NextResponse.json({ success: true, approval }, { status: 201 });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
