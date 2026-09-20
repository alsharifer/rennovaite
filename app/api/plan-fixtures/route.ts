import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { recordPilotEvent } from "@/lib/pilot/events";
import { derivePlanGraph } from "@/lib/plan/derive";
import { seedOverlays } from "@/lib/overlays/seed";
import {
  ELECTRICAL_TYPES,
  LANDSCAPE_TYPES,
  PLUMBING_TYPES,
  layerOf,
  type FixtureType,
} from "@/lib/overlays/types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// G5: landscape units (planter box, wall feature, grill, tree) are placeable
// too. The BoQ already read them; until now nothing could write one.
const ALL_TYPES = [...ELECTRICAL_TYPES, ...PLUMBING_TYPES, ...LANDSCAPE_TYPES] as const;

const COLS = "id, layer, type, room_id, position, wall_id, spec, source, dims_derived, derived_note, site_reference, disposition";
const COLS_PRE037 = "id, layer, type, room_id, position, wall_id, spec, source";

function flagOn(): boolean {
  return process.env.OVERLAYS_ENABLED === "true";
}

function db(): SupabaseClient {
  // plan_fixtures isn't in database.types.ts — use an untyped client.
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

/**
 * GET /api/plan-fixtures?project_id=…  → list fixtures for the project.
 * Seeds the rule-based defaults on first access (when none exist yet).
 */
export async function GET(request: NextRequest) {
  if (!flagOn()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId || !z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "project_id (uuid) required." }, { status: 400 });
  }
  const supabase = db();
  try {
    let { data: existing, error } = await supabase
      .from("plan_fixtures")
      .select(COLS)
      .eq("project_id", projectId)
      .order("layer");
    if (error) {
      const pre = await supabase.from("plan_fixtures").select(COLS_PRE037).eq("project_id", projectId).order("layer");
      existing = pre.data as typeof existing;
      error = pre.error;
    }
    if (error) throw error;

    if (existing && existing.length > 0) {
      return NextResponse.json({ fixtures: existing, seeded: false });
    }

    // First access → seed rule defaults from the plan graph.
    const graph = await derivePlanGraph(projectId);
    // G5: an AUTHORED garden is lit AS DESIGNED. Seeding rule lights on first
    // open would put fittings on the plan that nobody designed, and every
    // document downstream would present them as the design.
    if (graph.meta.source === "user_drawn") return NextResponse.json({ fixtures: [], seeded: false });
    const seeded = seedOverlays(graph, { styleKey: null });
    if (seeded.length === 0) return NextResponse.json({ fixtures: [], seeded: false });

    const rows = seeded.map((f) => ({
      project_id: projectId,
      layer: f.layer,
      type: f.type,
      room_id: f.room_id,
      position: f.position,
      wall_id: f.wall_id,
      spec: f.spec,
      source: f.source,
    }));
    const { data: inserted, error: insErr } = await supabase
      .from("plan_fixtures")
      .insert(rows)
      .select("id, layer, type, room_id, position, wall_id, spec, source");
    if (insErr) throw insErr;
    return NextResponse.json({ fixtures: inserted ?? [], seeded: true });
  } catch (err) {
    console.error("[api/plan-fixtures GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load fixtures." },
      { status: 500 },
    );
  }
}

const UpsertSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid(),
  type: z.enum(ALL_TYPES),
  room_id: z.string().uuid().nullable().optional(),
  position: z.tuple([z.number(), z.number()]),
  wall_id: z.string().nullable().optional(),
  spec: z.record(z.string(), z.unknown()).nullable().optional(),
  /** G5 (migration 037). */
  dims_derived: z.boolean().optional(),
  derived_note: z.string().max(1000).nullable().optional(),
  site_reference: z.boolean().optional(),
  disposition: z.enum(["keep", "remove", "replace"]).nullable().optional(),
});

/**
 * POST /api/plan-fixtures → add (no id) or move/update (with id) a fixture.
 * Any write is a user edit → source: 'user'.
 */
export async function POST(request: NextRequest) {
  if (!flagOn()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const raw = await request.json().catch(() => null);
  const parsed = UpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const f = parsed.data;
  const supabase = db();
  const row: Record<string, unknown> = {
    project_id: f.project_id,
    layer: layerOf(f.type as FixtureType),
    type: f.type,
    room_id: f.room_id ?? null,
    position: f.position,
    wall_id: f.wall_id ?? null,
    source: "user" as const,
  };
  // Optional fields are written only when sent: moving a fixture must never
  // wipe its spec, or its site-reference tag.
  for (const k of ["spec", "dims_derived", "derived_note", "site_reference", "disposition"] as const) {
    if (f[k] !== undefined) row[k] = f[k];
  }
  if (!f.id && row.spec === undefined) row.spec = null;
  try {
    if (f.id) {
      const { data, error } = await supabase
        .from("plan_fixtures")
        .update(row)
        .eq("id", f.id)
        .eq("project_id", f.project_id)
        .select(COLS)
        .single();
      if (error) throw error;
      await recordPilotEvent(supabase, f.project_id, "design_edit", { layer: "fixtures", action: "update", type: f.type });
      return NextResponse.json({ fixture: data });
    }
    const { data, error } = await supabase
      .from("plan_fixtures")
      .insert(row)
      .select(COLS)
      .single();
    if (error) throw error;
    await recordPilotEvent(supabase, f.project_id, "design_edit", { layer: "fixtures", action: "create", type: f.type });
    return NextResponse.json({ fixture: data });
  } catch (err) {
    console.error("[api/plan-fixtures POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save fixture." },
      { status: 500 },
    );
  }
}

/** DELETE /api/plan-fixtures?id=… */
export async function DELETE(request: NextRequest) {
  if (!flagOn()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "id (uuid) required." }, { status: 400 });
  }
  try {
    const { error } = await db().from("plan_fixtures").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/plan-fixtures DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete fixture." },
      { status: 500 },
    );
  }
}
