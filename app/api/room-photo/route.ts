import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { uploadErrorResponse } from "@/lib/uploads/http";
import { finishUpload } from "@/lib/uploads/register";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A room's photo. H9: takes { path, room_id, filename? } for a file the browser
// uploaded straight to Storage (kind "room_photo"); the room must belong to the
// signed project. (The render page files photos through the asset library —
// kind "project_asset" — which mirrors a room_photos row the same way.)
export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const body = (await request.json().catch(() => null)) as { path?: unknown; room_id?: unknown; filename?: unknown } | null;
  if (!body || typeof body.path !== "string") return NextResponse.json({ error: "Upload the photo first, then send its path.", code: "bad_request" }, { status: 400 });
  try {
    const fields = { room_id: typeof body.room_id === "string" ? body.room_id : null, filename: typeof body.filename === "string" ? body.filename : null };
    return NextResponse.json(await finishUpload(supabaseAdmin as unknown as SupabaseClient, caller, body.path, fields, "room_photo"));
  } catch (e) {
    return uploadErrorResponse(e, "api/room-photo");
  }
}
