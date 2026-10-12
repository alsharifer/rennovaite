import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { uploadErrorResponse } from "@/lib/uploads/http";
import { finishUpload } from "@/lib/uploads/register";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// H9 — POST /api/uploads/complete { path, …fields }. The object exists, the
// caller signed it, its real size is under the kind's limit and its magic bytes
// are an allowed type (otherwise it is deleted: 413 / 415 { code, kind }); then
// the kind's pipeline runs (lib/uploads/register.ts) and its answer is returned
// — the same answer the kind's own route gives.

export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to upload.");
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.path !== "string") return NextResponse.json({ error: "Send the uploaded file's path.", code: "bad_request" }, { status: 400 });
  try {
    const { path, ...fields } = body;
    const result = await finishUpload(getSupabaseAdmin() as unknown as SupabaseClient, caller, path, fields);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return uploadErrorResponse(e, "api/uploads/complete");
  }
}
