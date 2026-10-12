import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { uploadErrorResponse } from "@/lib/uploads/http";
import { UPLOAD_KINDS } from "@/lib/uploads/limits";
import { signUpload } from "@/lib/uploads/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// H9 — POST /api/uploads/sign { kind, project_id | firm_id, size, type, filename?, asset_kind? }
// → { path, signedUrl, token, contentType }. Signed in + a member of the project
// (H5) or firm (U1); the declared size and type are checked against
// lib/uploads/limits.ts before any byte moves (413 / 415 { code, kind }). The
// browser then PUTs the file straight to Storage and calls /api/uploads/complete.

const Body = z.object({
  kind: z.enum(UPLOAD_KINDS),
  project_id: z.string().uuid().optional().nullable(),
  firm_id: z.string().uuid().optional().nullable(),
  size: z.number().int().nonnegative(),
  type: z.string().max(200).optional().nullable(),
  filename: z.string().max(400).optional().nullable(),
  asset_kind: z.string().max(40).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to upload.");
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message, code: "bad_request" }, { status: 400 });
  const b = parsed.data;
  try {
    const signed = await signUpload(getSupabaseAdmin() as unknown as SupabaseClient, caller, {
      kind: b.kind,
      scopeId: b.project_id ?? b.firm_id ?? null,
      size: b.size,
      type: b.type,
      filename: b.filename,
      assetKind: b.asset_kind,
    });
    return NextResponse.json(signed);
  } catch (e) {
    return uploadErrorResponse(e, "api/uploads/sign");
  }
}
