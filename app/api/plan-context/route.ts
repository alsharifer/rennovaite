import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { projectOfPlan, recordPilotEvent } from "@/lib/pilot/events";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Context CRUD (garden pilot G5). plan_context has held the existing villa,
// garage, steps and boundary walls since G4b, but only a seed script could write
// it — an authored garden had no way to say where its house stands. Context is
// never a zone and never priced; a site-reference context item (an existing
// boundary wall) can still be marked keep / remove / replace.

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

function enabled(): boolean {
  return process.env.GARDEN_PILOT_ENABLED === "true";
}

const COLS = "id, plan_id, kind, name, polygon, base_mm, height_mm, derived, note, source, dims_derived, site_reference, disposition, spec, created_at";

const KindSchema = z.enum(["existing_building", "existing_structure", "steps", "boundary_wall"]);
const PolygonSchema = z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3);

const Fields = {
  kind: KindSchema,
  name: z.string().trim().min(1).max(200).nullish(),
  polygon: PolygonSchema,
  base_mm: z.number().finite().optional(),
  height_mm: z.number().positive().nullish(),
  /** Height assumed or scaled, not dimensioned. */
  derived: z.boolean().optional(),
  note: z.string().max(1000).nullish(),
  dims_derived: z.boolean().optional(),
  site_reference: z.boolean().optional(),
  disposition: z.enum(["keep", "remove", "replace"]).nullish(),
  /** G5d (040): what stands beyond a boundary wall — the 3D scene reads it. */
  spec: z.object({ beyond: z.enum(["neighbour", "street", "open"]).optional() }).passthrough().nullish(),
};

const CreateSchema = z.object({ plan_id: z.string().uuid(), ...Fields });
const UpdateSchema = z.object({ id: z.string().uuid(), ...Object.fromEntries(Object.entries(Fields).map(([k, v]) => [k, v.optional()])) } as { id: z.ZodString } & { [K in keyof typeof Fields]: z.ZodOptional<(typeof Fields)[K]> });

export async function GET(request: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const planId = new URL(request.url).searchParams.get("plan_id");
  if (!planId || !z.string().uuid().safeParse(planId).success) {
    return NextResponse.json({ error: "plan_id (uuid) required." }, { status: 400 });
  }
  const { data, error } = await db().from("plan_context").select(COLS).eq("plan_id", planId).order("created_at");
  if (error) return NextResponse.json({ context: [], degraded: true });
  return NextResponse.json({ context: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const b = parsed.data;
  try {
    const { data, error } = await db()
      .from("plan_context")
      .insert({
        plan_id: b.plan_id,
        kind: b.kind,
        name: b.name ?? null,
        polygon: b.polygon,
        base_mm: b.base_mm ?? 0,
        height_mm: b.height_mm ?? null,
        // A context volume with no height is by definition not dimensioned.
        derived: b.derived ?? b.height_mm == null,
        note: b.note ?? null,
        source: "user_drawn",
        dims_derived: b.dims_derived ?? false,
        site_reference: b.site_reference ?? false,
        disposition: b.disposition ?? null,
        ...(b.spec ? { spec: b.spec } : {}),
      })
      .select(COLS)
      .single();
    if (error || !data) throw error ?? new Error("Failed to create context.");
    const projectId = await projectOfPlan(db(), b.plan_id);
    if (projectId) await recordPilotEvent(db(), projectId, "design_edit", { layer: "context", action: "create", kind: b.kind });
    return NextResponse.json({ context: data });
  } catch (err) {
    console.error("[api/plan-context] POST error", err);
    return NextResponse.json({ error: errMessage(err, "Failed to create context.") }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { id, ...fields } = parsed.data;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = v;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  try {
    const { data, error } = await db().from("plan_context").update(patch).eq("id", id).select(COLS).single();
    if (error || !data) throw error ?? new Error("Failed to update context.");
    const projectId = await projectOfPlan(db(), (data as { plan_id: string }).plan_id);
    if (projectId) await recordPilotEvent(db(), projectId, "design_edit", { layer: "context", action: "update", fields: Object.keys(patch) });
    return NextResponse.json({ context: data });
  } catch (err) {
    console.error("[api/plan-context] PATCH error", err);
    return NextResponse.json({ error: errMessage(err, "Failed to update context.") }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "A valid context id is required." }, { status: 400 });
  const { error } = await db().from("plan_context").delete().eq("id", id.data);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return fallback;
}
