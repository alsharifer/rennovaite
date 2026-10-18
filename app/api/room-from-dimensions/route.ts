import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { recordPilotEvent } from "@/lib/pilot/events";
import { roomFromDimensions, ROOM_INTAKE_TYPES } from "@/lib/plan/room-intake";
import { addProjectMember } from "@/lib/projects/access";
import { recordProjectCreator } from "@/lib/projects/lifecycle";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/room-from-dimensions — "One room from its dimensions" (bathroom
// pilot B1). The third way in beside Upload and Draw: a client who has only a
// tape measure gives L × W × H, and the project starts with ONE rectangular
// room, every entered value measured. Behind MULTIVIEW_RENDERS_ENABLED (the
// pack's one flag) — not the garden pilot, and no plot to type: the room IS
// the plot, so its scale is measured too.
//
// Doors, windows and fixtures are marked next, on 01 Plan, through the layers
// every plan uses (A5 openings, the plumbing layer).

const BodySchema = z.object({
  room_type: z.enum(ROOM_INTAKE_TYPES),
  name: z.string().trim().min(1).max(200).optional(),
  room_name: z.string().trim().min(1).max(120).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  /** Metres. A room under 0.5 m is a typo; over 30 m is not one room. */
  length_m: z.number().min(0.5).max(30),
  width_m: z.number().min(0.5).max(30),
  /** Metres, floor to ceiling. */
  height_m: z.number().min(1.8).max(6),
});

export async function POST(request: Request) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  if (process.env.MULTIVIEW_RENDERS_ENABLED !== "true") {
    return NextResponse.json({ error: "Starting from a room's dimensions is not enabled." }, { status: 404 });
  }

  let createdProjectId: string | null = null;
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const b = parsed.data;
    const room = roomFromDimensions({ room_type: b.room_type, length_m: b.length_m, width_m: b.width_m, height_m: b.height_m, name: b.room_name ?? null });
    const sb = getSupabaseAdmin() as unknown as SupabaseClient;

    const { data: project, error: projectErr } = await sb
      .from("projects")
      .insert({ city: b.city ?? "Dubai", name: b.name ?? room.name_en })
      .select("id")
      .single<{ id: string }>();
    if (projectErr || !project) throw projectErr ?? new Error("Failed to create project row.");
    createdProjectId = project.id;
    // H5: creating a project makes the creator its member (rolled back with it);
    // K10 (055): and the one who may delete it.
    await addProjectMember(sb, project.id, caller.id);
    await recordProjectCreator(sb, project.id, caller.id);

    // An authored plan whose plot is the room: x runs across its length, so the
    // metre scale is the measured length (buildPlanGraph's `unit_to_m`).
    const { data: plan, error: planErr } = await sb
      .from("plans")
      .insert({
        project_id: project.id,
        pdf_url: null,
        source: "user_drawn",
        intake: "room_dimensions",
        plot_width_m: room.length_m,
        plot_depth_m: room.width_m,
        total_area_m2: room.area_m2,
        dims_derived: false,
      })
      .select("id")
      .single<{ id: string }>();
    if (planErr || !plan) throw planErr ?? new Error("Failed to create plan row.");

    const { data: roomRow, error: roomErr } = await sb
      .from("rooms")
      .insert({
        plan_id: plan.id,
        name_en: room.name_en,
        name_ar: null,
        room_type: room.room_type,
        area_m2: room.area_m2,
        polygon: room.polygon,
        unroofed: false,
        dims_derived: false,
        ceiling_h_m: room.ceiling_h_m,
        ceiling_h_source: "measured",
      })
      .select("id")
      .single<{ id: string }>();
    if (roomErr || !roomRow) throw roomErr ?? new Error("Failed to create the room.");

    await recordPilotEvent(sb, project.id, "plan_started", { intake: "room_dimensions", room_type: room.room_type, length_m: room.length_m, width_m: room.width_m, height_m: room.ceiling_h_m }, { actor: caller.id });

    return NextResponse.json({ project_id: project.id, plan_id: plan.id, room_id: roomRow.id, area_m2: room.area_m2 });
  } catch (err) {
    console.error("[api/room-from-dimensions] error", err);
    if (createdProjectId) await getSupabaseAdmin().from("projects").delete().eq("id", createdProjectId);
    const message =
      err instanceof Error ? err.message : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "Could not start the room.";
    // 061 not applied: say so rather than half-creating a room with no height.
    const missing = /intake|ceiling_h/i.test(message) && /column|schema/i.test(message);
    return NextResponse.json(missing ? { error: "The database needs migration 061 first.", code: "migration_required" } : { error: message }, { status: 500 });
  }
}
