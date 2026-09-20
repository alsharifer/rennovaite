import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { projectOfPlan, recordPilotEvent } from "@/lib/pilot/events";
import { LINEAR_ELEMENT_META, LINEAR_ELEMENT_KINDS } from "@/lib/plan/elements";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Linear-element CRUD for the G1 elements editor (source='user_drawn').
// Mirrors /api/plan-openings exactly, including the rule that a DEFAULTED
// cross-section is flagged derived server-side and never trusted from the
// client — a bench somebody dragged into place must not read as a measured
// quantity just because the editor sent a number.
function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

/** Columns the editor reads back — migrations 031/033, plus 036 spec and 037 site reference. */
const SELECT_COLS =
  "id, plan_id, room_id, kind, polyline, height_mm, width_mm, variant, source, derived, created_at, spec, dims_derived, derived_note, site_reference, disposition";
const SELECT_COLS_PRE037 =
  "id, plan_id, room_id, kind, polyline, height_mm, width_mm, variant, source, derived, created_at";

/** G5 fields a create or update may carry. */
const SiteRefFields = {
  spec: z.record(z.string(), z.unknown()).nullish(),
  dims_derived: z.boolean().optional(),
  derived_note: z.string().max(1000).nullish(),
  site_reference: z.boolean().optional(),
  disposition: z.enum(["keep", "remove", "replace"]).nullish(),
};

async function logEdit(planId: string | null, detail: Record<string, unknown>) {
  if (!planId) return;
  const projectId = await projectOfPlan(db(), planId);
  if (projectId) await recordPilotEvent(db(), projectId, "design_edit", { layer: "elements", ...detail });
}

/** Counter runs only. `null` is the unanswered state and must stay reachable. */
const VariantSchema = z.enum(["bar", "bbq"]);

const KindSchema = z.enum(
  LINEAR_ELEMENT_KINDS as unknown as [string, ...string[]],
);

/** >= 2 points, each a finite [x, y] in normalised plan space. */
const PolylineSchema = z
  .array(z.tuple([z.number().finite(), z.number().finite()]))
  .min(2);

/**
 * GET /api/plan-elements?plan_id=… → the plan's linear elements. Returns `[]`
 * rather than erroring when the table is absent (pre-031), so the editor
 * degrades to an empty layer instead of breaking the plan page.
 */
export async function GET(request: NextRequest) {
  const planId = new URL(request.url).searchParams.get("plan_id");
  if (!planId || !z.string().uuid().safeParse(planId).success) {
    return NextResponse.json({ error: "plan_id (uuid) required." }, { status: 400 });
  }
  try {
    let { data, error } = await db()
      .from("plan_elements")
      .select(SELECT_COLS)
      .eq("plan_id", planId)
      .order("created_at", { ascending: true });
    if (error) {
      const pre = await db().from("plan_elements").select(SELECT_COLS_PRE037).eq("plan_id", planId).order("created_at", { ascending: true });
      data = pre.data as typeof data;
      error = pre.error;
    }
    if (error) {
      console.warn("[api/plan-elements] GET degraded:", error.message);
      return NextResponse.json({ elements: [], degraded: true });
    }
    return NextResponse.json({ elements: data ?? [] });
  } catch (err) {
    console.warn("[api/plan-elements] GET degraded:", err instanceof Error ? err.message : err);
    return NextResponse.json({ elements: [], degraded: true });
  }
}

const CreateSchema = z.object({
  plan_id: z.string().uuid(),
  room_id: z.string().uuid().nullish(),
  kind: KindSchema,
  polyline: PolylineSchema,
  height_mm: z.number().positive().nullish(),
  width_mm: z.number().positive().nullish(),
  variant: VariantSchema.nullish(),
  /** A client may mark a cross-section derived (an estimate from a photo) — never measured. */
  derived: z.literal(true).optional(),
  ...SiteRefFields,
});

export async function POST(request: NextRequest) {
  try {
    const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const b = parsed.data;
    const meta = LINEAR_ELEMENT_META[b.kind as keyof typeof LINEAR_ELEMENT_META];
    const dimsDefaulted = b.height_mm == null || b.width_mm == null || b.derived === true;

    const { data, error } = await db()
      .from("plan_elements")
      .insert({
        plan_id: b.plan_id,
        room_id: b.room_id ?? null,
        kind: b.kind,
        polyline: b.polyline,
        height_mm: b.height_mm ?? meta.defaultHeightMm,
        width_mm: b.width_mm ?? meta.defaultWidthMm,
        // Only a counter can have one. Left null everywhere else so the column
        // never implies a choice that does not exist for that kind.
        variant: b.kind === "counter_run" ? (b.variant ?? null) : null,
        source: "user_drawn",
        derived: dimsDefaulted,
        ...(b.spec !== undefined ? { spec: b.spec } : {}),
        ...(b.dims_derived !== undefined ? { dims_derived: b.dims_derived } : {}),
        ...(b.derived_note !== undefined ? { derived_note: b.derived_note } : {}),
        ...(b.site_reference !== undefined ? { site_reference: b.site_reference } : {}),
        ...(b.disposition !== undefined ? { disposition: b.disposition } : {}),
      })
      .select(SELECT_COLS)
      .single();
    if (error || !data) throw error ?? new Error("Failed to create element.");
    await logEdit(b.plan_id, { action: "create", kind: b.kind });
    return NextResponse.json({ element: data, derived: dimsDefaulted });
  } catch (err) {
    console.error("[api/plan-elements] POST error", err);
    const message = err instanceof Error ? err.message : "Failed to create element.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  room_id: z.string().uuid().nullish(),
  polyline: PolylineSchema.optional(),
  height_mm: z.number().positive().nullish(),
  width_mm: z.number().positive().nullish(),
  /** `null` clears the choice back to unanswered; omitted leaves it alone. */
  variant: VariantSchema.nullable().optional(),
  ...SiteRefFields,
});

/**
 * PATCH /api/plan-elements — reshape a run or give it a measured cross-section.
 *
 * `derived` is decided server-side: supplying BOTH height and width is a
 * measurement and clears the flag; reshaping the polyline leaves it alone,
 * because moving a bench does not measure it.
 */
export async function PATCH(request: NextRequest) {
  try {
    const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { id, ...fields } = parsed.data;

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) patch[k] = v;
    }
    if (fields.height_mm != null && fields.width_mm != null) patch.derived = false;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    const { data, error } = await db()
      .from("plan_elements")
      .update(patch)
      .eq("id", id)
      .select(SELECT_COLS)
      .single();
    if (error || !data) throw error ?? new Error("Failed to update element.");
    await logEdit((data as { plan_id?: string }).plan_id ?? null, { action: "update", fields: Object.keys(patch) });
    return NextResponse.json({ element: data });
  } catch (err) {
    console.error("[api/plan-elements] PATCH error", err);
    const message = err instanceof Error ? err.message : "Failed to update element.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
    if (!id.success) {
      return NextResponse.json({ error: "A valid element id is required." }, { status: 400 });
    }
    const { error } = await db().from("plan_elements").delete().eq("id", id.data);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/plan-elements] DELETE error", err);
    const message = err instanceof Error ? err.message : "Failed to delete element.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
