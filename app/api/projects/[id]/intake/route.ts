import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { finishIntake } from "@/lib/projects/intake";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// K11 #1 (spec §7, migration 056) — POST /api/projects/:id/intake { name?, city? }.
// The intake's Continue: writes the name and city the form holds now and ends
// the project's draft (an uploaded plan creates the project before the owner
// has named it, and an abandoned upload stays a draft — lib/projects/intake.ts).
// Any member of the project (the uploader is its member).
const Body = z.object({ name: z.string().max(400).nullable().optional(), city: z.string().max(200).nullable().optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid project id." }, { status: 400 });
  const body = Body.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ success: false, error: "Body must be { name?: string, city?: string }.", code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { project_id: parsed.data });
  if (access.denied) return access.denied;
  try {
    const project = await finishIntake(db, parsed.data, body.data);
    return NextResponse.json({ success: true, ...project });
  } catch (e) {
    console.error("[api/projects/intake] error", e);
    return NextResponse.json({ success: false, error: "The project could not be saved." }, { status: 500 });
  }
}
