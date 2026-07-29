// =============================================================================
// app/api/furniture-opt-in/route.ts — per-room furniture opt-in (P7).
//
// The ghost "Add furniture to your budget?" prompt (once per locked room) POSTs
// here. Presence of a furniture_opt_ins row = opted in; the BoQ page then reads
// the room's staging set into the optional "Furniture (optional)" section.
// Flag-gated + best-effort — a 404/absent table never breaks the render flow.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  project_id: z.string().uuid(),
  room_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  if (process.env.STAGING_ENABLED !== "true") {
    return NextResponse.json({ error: "Staging is disabled." }, { status: 404 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { project_id, room_id } = parsed.data;

  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  try {
    const { error } = await sb
      .from("furniture_opt_ins")
      .upsert(
        { project_id, room_id },
        { onConflict: "project_id,room_id", ignoreDuplicates: true },
      );
    if (error) {
      // Table not applied yet (migration 021) — report but don't 500 the UI.
      return NextResponse.json(
        { ok: false, persisted: false, note: error.message },
        { status: 200 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, persisted: false, note: err instanceof Error ? err.message : "error" },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, persisted: true });
}
