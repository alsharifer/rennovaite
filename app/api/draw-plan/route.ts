import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { recordPilotEvent } from "@/lib/pilot/events";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/draw-plan — create a project with NO uploaded drawing (garden pilot
// G1). Until now `/api/upload` was the only code path that inserted a project,
// so a project could not exist without a floorplan file, and the plan page hid
// its editor behind a `parsed_json` check that an authored plan can never
// satisfy. This is the other door.
//
// The plot dimensions are not decoration: they ARE the plan's scale. A drawn
// zone's area is (its share of the canvas) × (the plot the user measured), so a
// plan with no plot size has no way to be metric at all. They are required.

const BodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  /** Metres. Sane bounds: a 2 m plot is a typo, a 500 m plot is a site. */
  plot_width_m: z.number().positive().min(2).max(500),
  plot_depth_m: z.number().positive().min(2).max(500),
  city: z.string().trim().min(1).max(120).optional(),
  /**
   * G5: the plot size was DERIVED (e.g. calibrated off a developer type plan)
   * rather than measured, and from what. A derived plot keeps every document a
   * draft until it is amended to measured.
   */
  dims_derived: z.boolean().optional(),
  dims_note: z.string().trim().max(1000).nullable().optional(),
});

const ConvertSchema = z.object({
  plan_id: z.string().uuid(),
  plot_width_m: z.number().positive().min(2).max(500),
  plot_depth_m: z.number().positive().min(2).max(500),
  /** G5: amend derived → measured (or back) together with the plot size. */
  dims_derived: z.boolean().optional(),
  dims_note: z.string().trim().max(1000).nullable().optional(),
});

/**
 * PATCH /api/draw-plan — take over an existing plan by hand.
 *
 * The case this exists for: a floorplan was uploaded, the parse found nothing
 * usable, and the plan page would otherwise be a dead end. Converting it to an
 * authored plan keeps the project, the uploaded drawing and every asset already
 * attached to it, and asks for the one thing the parse failed to supply — a
 * scale. The rooms the parse DID produce are left alone; there are none in the
 * case this serves, and silently deleting geometry is never the right default.
 */
export async function PATCH(request: Request) {
  if (process.env.GARDEN_PILOT_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Drawing a plan from scratch is not enabled." },
      { status: 404 },
    );
  }
  try {
    const parsed = ConvertSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const b = parsed.data;
    const sb = getSupabaseAdmin() as unknown as SupabaseClient;
    const { error } = await sb
      .from("plans")
      .update({
        source: "user_drawn",
        plot_width_m: b.plot_width_m,
        plot_depth_m: b.plot_depth_m,
        ...(b.dims_derived !== undefined ? { dims_derived: b.dims_derived } : {}),
        ...(b.dims_note !== undefined ? { dims_note: b.dims_note } : {}),
      })
      .eq("id", b.plan_id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/draw-plan] PATCH error", err);
    const message =
      err instanceof Error ? err.message : "Could not switch this plan to drawing.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (process.env.GARDEN_PILOT_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Drawing a plan from scratch is not enabled." },
      { status: 404 },
    );
  }

  let createdProjectId: string | null = null;
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const b = parsed.data;
    const supabase = getSupabaseAdmin();

    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .insert({ city: b.city ?? "Dubai", name: b.name ?? "Untitled" })
      .select("id")
      .single();
    if (projectErr || !project) {
      throw projectErr ?? new Error("Failed to create project row.");
    }
    createdProjectId = project.id;

    // parsed_json stays NULL — there is nothing parsed about this plan, and
    // writing a decorative object there would make an authored plan
    // indistinguishable from a parsed one for every consumer that checks it.
    // `source` is the mark; the plan page and the graph both read it.
    const sb = supabase as unknown as SupabaseClient;
    const { data: plan, error: planErr } = await sb
      .from("plans")
      .insert({
        project_id: project.id,
        pdf_url: null,
        source: "user_drawn",
        plot_width_m: b.plot_width_m,
        plot_depth_m: b.plot_depth_m,
        total_area_m2: 0,
        ...(b.dims_derived !== undefined ? { dims_derived: b.dims_derived } : {}),
        ...(b.dims_note !== undefined ? { dims_note: b.dims_note } : {}),
      })
      .select("id")
      .single<{ id: string }>();
    if (planErr || !plan) {
      throw planErr ?? new Error("Failed to create plan row.");
    }

    await recordPilotEvent(sb, project.id, "plan_started", { plot_width_m: b.plot_width_m, plot_depth_m: b.plot_depth_m, dims_derived: b.dims_derived === true });

    return NextResponse.json({
      project_id: project.id,
      plan_id: plan.id,
      plot_width_m: b.plot_width_m,
      plot_depth_m: b.plot_depth_m,
    });
  } catch (err) {
    console.error("[api/draw-plan] error", err);
    if (createdProjectId) {
      await getSupabaseAdmin().from("projects").delete().eq("id", createdProjectId);
    }
    // Supabase throws plain objects with `.message`, not Error instances.
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Could not start a drawn plan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
