import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { projectAccess } from "@/lib/projects/http";
import { PhotoViewError, runPhotoView } from "@/lib/render/photo-view-run";
import { projectRenderSpend } from "@/lib/render/render-spend";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Two renders and three readings at most (before is kept per photo).
export const maxDuration = 300;

// B2 — POST /api/render/photo-view { room_photo_id }: restyle one photo of a
// room to the client's references, its layout held by the placement check
// (re-render once, then an honest failure). Behind MULTIVIEW_RENDERS_ENABLED.
// Answers the stored render, its check line and the project's render spend.
const Body = z.object({ room_photo_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  if (process.env.MULTIVIEW_RENDERS_ENABLED !== "true") return NextResponse.json({ error: "Photo views are not enabled." }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body must be { room_photo_id }.", code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { room_photo_id: parsed.data.room_photo_id });
  if (access.denied) return access.denied;
  try {
    const out = await runPhotoView(db, { projectId: access.projectId!, roomPhotoId: parsed.data.room_photo_id, actor: caller.id });
    return NextResponse.json({ ...out, spend: await projectRenderSpend(db, access.projectId!) });
  } catch (e) {
    if (e instanceof PhotoViewError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[api/render/photo-view]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "The photo view did not render." }, { status: 500 });
  }
}
