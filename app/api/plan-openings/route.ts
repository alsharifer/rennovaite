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

/** Columns the editor reads back — keep in sync with migration 026. */
const SELECT_COLS =
  "id, plan_id, room_id, wall_ref, kind, width_mm, height_mm, sill_mm, position, along_offset, source, derived, created_at";

/**
 * GET /api/plan-openings?plan_id=… → the plan's openings (both parsed and
 * user-drawn) for the R2 editor and the door/window schedule. Returns `[]`
 * rather than erroring when the table is absent (pre-026), so the editor
 * degrades to an empty layer instead of breaking the plan page.
 */
export async function GET(request: NextRequest) {
  const planId = new URL(request.url).searchParams.get("plan_id");
  if (!planId || !z.string().uuid().safeParse(planId).success) {
    return NextResponse.json({ error: "plan_id (uuid) required." }, { status: 400 });
  }
  try {
    const { data, error } = await db()
      .from("plan_openings")
      .select(SELECT_COLS)
      .eq("plan_id", planId)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn("[api/plan-openings] GET degraded:", error.message);
      return NextResponse.json({ openings: [], degraded: true });
    }
    return NextResponse.json({ openings: data ?? [] });
  } catch (err) {
    console.warn("[api/plan-openings] GET degraded:", err instanceof Error ? err.message : err);
    return NextResponse.json({ openings: [], degraded: true });
  }
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
      .select(SELECT_COLS)
      .single();
    if (error || !data) throw error ?? new Error("Failed to create opening.");
    return NextResponse.json({ opening: data, derived: dimsDefaulted });
  } catch (err) {
    console.error("[api/plan-openings] POST error", err);
    const message = err instanceof Error ? err.message : "Failed to create opening.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  room_id: z.string().uuid().nullish(),
  wall_ref: z.string().nullish(),
  kind: z.enum(["door", "window", "archway"]).optional(),
  width_mm: z.number().positive().nullish(),
  height_mm: z.number().positive().nullish(),
  sill_mm: z.number().nonnegative().nullish(),
  position: z.tuple([z.number(), z.number()]).optional(),
  along_offset: z.number().min(0).max(1).nullish(),
  /** Explicitly un-measure: restore the standard dimensions for the kind and
   *  set derived back to true. The only sanctioned way to return a measured
   *  opening to a defaulted one (used by "revert to standard size" and by the
   *  editor's undo of a dimension edit). */
  reset_dims: z.boolean().optional(),
});

/**
 * PATCH /api/plan-openings — reposition (drag along the wall) or re-dimension
 * an opening. Only the supplied fields change.
 *
 * The derived flag is decided SERVER-SIDE, never trusted from the client: an
 * edit that supplies BOTH width and height is a measurement, so `derived`
 * clears to false; anything else leaves the row's derived state alone (a drag
 * must not silently promote a defaulted door into a measured quantity).
 */
export async function PATCH(request: NextRequest) {
  try {
    const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { id, reset_dims, ...fields } = parsed.data;

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) patch[k] = v;
    }

    if (reset_dims) {
      // Un-measure: back to the standard size for the kind, flagged derived.
      // Needs the row's kind when the caller didn't supply one.
      let kind = fields.kind;
      if (!kind) {
        const { data: row } = await db()
          .from("plan_openings")
          .select("kind")
          .eq("id", id)
          .single<{ kind: "door" | "window" | "archway" }>();
        kind = row?.kind ?? "door";
      }
      const def = DEFAULT_OPENING_DIMS[kind];
      patch.width_mm = def.width_mm;
      patch.height_mm = def.height_mm;
      patch.sill_mm = def.sill_mm;
      patch.derived = true;
    } else if (fields.width_mm != null && fields.height_mm != null) {
      // Both dimensions supplied → the user measured it.
      patch.derived = false;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    const { data, error } = await db()
      .from("plan_openings")
      .update(patch)
      .eq("id", id)
      .select(SELECT_COLS)
      .single();
    if (error || !data) throw error ?? new Error("Failed to update opening.");
    return NextResponse.json({ opening: data });
  } catch (err) {
    console.error("[api/plan-openings] PATCH error", err);
    const message = err instanceof Error ? err.message : "Failed to update opening.";
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
