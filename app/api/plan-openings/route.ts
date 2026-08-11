import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { DEFAULT_OPENING_DIMS } from "@/lib/plan/geometry";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Openings CRUD for the R2 2D editor (source='user_drawn'). Mirrors the
// plan_fixtures editor endpoints. Missing dimensions are DEFAULTED server-side
// and flagged derived, so a hand-placed door without measured sizes never reads
// as a measured quantity.
function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

const CreateSchema = z.object({
  plan_id: z.string().uuid(),
  room_id: z.string().uuid().nullish(),
  wall_ref: z.string().nullish(),
  kind: z.enum(["door", "window", "archway"]),
  width_mm: z.number().positive().nullish(),
  height_mm: z.number().positive().nullish(),
  sill_mm: z.number().nonnegative().nullish(),
  position: z.tuple([z.number(), z.number()]),
  along_offset: z.number().min(0).max(1).nullish(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const b = parsed.data;
    const def = DEFAULT_OPENING_DIMS[b.kind];
    const dimsDefaulted = b.width_mm == null || b.height_mm == null;

    const { data, error } = await db()
      .from("plan_openings")
      .insert({
        plan_id: b.plan_id,
        room_id: b.room_id ?? null,
        wall_ref: b.wall_ref ?? null,
        kind: b.kind,
        width_mm: b.width_mm ?? def.width_mm,
        height_mm: b.height_mm ?? def.height_mm,
        sill_mm: b.sill_mm ?? def.sill_mm,
        position: b.position,
        along_offset: b.along_offset ?? null,
        source: "user_drawn",
        derived: dimsDefaulted,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Failed to create opening.");
    return NextResponse.json({ id: data.id, derived: dimsDefaulted });
  } catch (err) {
    console.error("[api/plan-openings] POST error", err);
    const message = err instanceof Error ? err.message : "Failed to create opening.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
    if (!id.success) {
      return NextResponse.json({ error: "A valid opening id is required." }, { status: 400 });
    }
    const { error } = await db().from("plan_openings").delete().eq("id", id.data);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/plan-openings] DELETE error", err);
    const message = err instanceof Error ? err.message : "Failed to delete opening.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
