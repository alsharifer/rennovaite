import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { projectOfPlan, recordPilotEvent } from "@/lib/pilot/events";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/plan-zones — the attributes of a zone that its outline does not
// carry (garden pilot G5): its finished level, a structure's height and spec,
// whether its outline is derived, and — for an existing feature placed from site
// photos — the designer's keep / remove / replace call.
//
// Until G5 only a seed script could write these (G4b), so a designer drawing a
// pergola had no way to give it the height its elevation and render depend on.
// Geometry stays with /api/update-plan; this never touches a polygon.

const PatchSchema = z.object({
  id: z.string().uuid(),
  /** Finished level vs ±000, in mm. null = not stated (never read as ±000). */
  level_mm: z.number().finite().min(-5000).max(10000).nullable().optional(),
  height_mm: z.number().positive().max(20000).nullable().optional(),
  spec: z.record(z.string(), z.unknown()).nullable().optional(),
  dims_derived: z.boolean().optional(),
  derived_note: z.string().max(1000).nullable().optional(),
  site_reference: z.boolean().optional(),
  disposition: z.enum(["keep", "remove", "replace"]).nullable().optional(),
});

export async function PATCH(request: NextRequest) {
  if (process.env.GARDEN_PILOT_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { id, ...fields } = parsed.data;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = v;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "No fields to update." }, { status: 400 });

  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const { data, error } = await sb
    .from("rooms")
    .update(patch)
    .eq("id", id)
    .select("id, plan_id, name_en, room_type, level_mm, height_mm, spec, dims_derived, derived_note, site_reference, disposition")
    .single<{ id: string; plan_id: string }>();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Zone not found." }, { status: error ? 500 : 404 });
  }
  const projectId = await projectOfPlan(sb, data.plan_id);
  if (projectId) await recordPilotEvent(sb, projectId, "design_edit", { layer: "zones", action: "update", fields: Object.keys(patch) });
  return NextResponse.json({ zone: data });
}
