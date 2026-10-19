import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { projectAccess } from "@/lib/projects/http";
import { runPhotoViewChange } from "@/lib/render/photo-view-change";
import { PhotoViewError } from "@/lib/render/photo-view-run";
import { projectRenderSpend } from "@/lib/render/render-spend";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// B4 — POST /api/render/photo-view/change { render_id, request }: "Ask for a
// change" on a photo view. One edit of the view's image; an unchanged image is
// on record but never a version (R10a's message); a change that moves a fixture
// is not kept; otherwise version N + what it changed. A structural request is
// 422 structural_change with the plan's openings link, before any model call.
const Body = z.object({ render_id: z.string().uuid(), request: z.string().trim().min(1).max(400) });

export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  if (process.env.MULTIVIEW_RENDERS_ENABLED !== "true") return NextResponse.json({ error: "Photo views are not enabled." }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body must be { render_id, request }.", code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { render_id: parsed.data.render_id });
  if (access.denied) return access.denied;
  try {
    const out = await runPhotoViewChange(db, { projectId: access.projectId!, renderId: parsed.data.render_id, request: parsed.data.request, actor: caller.id });
    return NextResponse.json({ ...out, spend: await projectRenderSpend(db, access.projectId!) });
  } catch (e) {
    if (e instanceof PhotoViewError) return NextResponse.json({ error: e.message, code: e.code, ...("plan_href" in e ? { plan_href: (e as { plan_href: string }).plan_href } : {}) }, { status: e.status });
    console.error("[api/render/photo-view/change]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "The change did not render." }, { status: 500 });
  }
}
