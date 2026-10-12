import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { uploadErrorResponse } from "@/lib/uploads/http";
import { finishUpload } from "@/lib/uploads/register";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The intake floorplan. H9: the file is no longer the request body — the
// browser uploaded it straight to Storage (POST /api/uploads/sign with kind
// "plan"), and this takes { path, filename? }. Completing it creates the
// project (the uploader becomes its member, H5 — addProjectMember in
// lib/uploads/register.ts), stores the plan and records it in the asset
// library: the same pipeline as before, now behind the upload checks.
export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const body = (await request.json().catch(() => null)) as { path?: unknown; filename?: unknown } | null;
  if (!body || typeof body.path !== "string") return NextResponse.json({ error: "Upload the plan first, then send its path.", code: "bad_request" }, { status: 400 });
  try {
    const result = await finishUpload(supabaseAdmin as unknown as SupabaseClient, caller, body.path, { filename: typeof body.filename === "string" ? body.filename : null }, "plan");
    return NextResponse.json(result);
  } catch (e) {
    return uploadErrorResponse(e, "api/upload");
  }
}
