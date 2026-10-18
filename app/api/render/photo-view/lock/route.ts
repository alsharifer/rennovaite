import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { projectAccess } from "@/lib/projects/http";
import { AnchorError, lockPhotoView } from "@/lib/render/photo-view-anchor";
import { projectRenderSpend } from "@/lib/render/render-spend";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// B4 — POST /api/render/photo-view/lock { render_id }: lock a version of a photo
// view. The room's FIRST lock anchors it (the room design spec is read from that
// render); later locks never move the anchor. Behind MULTIVIEW_RENDERS_ENABLED.
const Body = z.object({ render_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  if (process.env.MULTIVIEW_RENDERS_ENABLED !== "true") return NextResponse.json({ error: "Photo views are not enabled." }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body must be { render_id }.", code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { render_id: parsed.data.render_id });
  if (access.denied) return access.denied;
  try {
    const out = await lockPhotoView(db, { projectId: access.projectId!, renderId: parsed.data.render_id, actor: caller.id });
    return NextResponse.json({ ...out, spend: await projectRenderSpend(db, access.projectId!) });
  } catch (e) {
    if (e instanceof AnchorError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[api/render/photo-view/lock]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "The view was not locked." }, { status: 500 });
  }
}
