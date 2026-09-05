import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IdSchema = z.string().uuid();

// DELETE /api/projects/:id — permanently removes a project and everything under
// it. The projects FK graph is `on delete cascade` (plans → rooms, style_choices,
// renders, approved_designs, boqs, vendor_selections, feedback_events), so a
// single row delete tears down the whole tree. Irreversible; the UI gates this
// behind a confirm dialog.
//
// Note: like the rest of this PoC, data access runs through the service-role
// admin client with no per-user ownership check (projects have no user_id yet).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsed = IdSchema.safeParse(id);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid project id." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Look up first so we can 404 (rather than silently succeed on a bad id).
    const { data: existing, error: lookupErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", parsed.data)
      .maybeSingle();
    if (lookupErr) throw new Error(lookupErr.message);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 },
      );
    }

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", parsed.data);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/projects DELETE] error", err);
    const message = err instanceof Error ? err.message : "Delete failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

const PatchSchema = z.object({ archived: z.boolean() });

// PATCH /api/projects/:id — archive or un-archive. The counterpart to DELETE,
// and the one that should be reached for first: a parsed plan with renders and
// a BoQ is calibration data, so hiding it from the list beats destroying it.
//
// `archived_at` arrives in migration 030 and is absent from `database.types.ts`,
// so this writes through an untyped client. Before 030 PostgREST answers with
// PGRST204 ("column not found"), which we surface as a 503 naming the migration
// rather than a generic 500 — a missing manual migration is an operator
// problem, not a bug, and the message should say so.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsedId = IdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: "Invalid project id." },
        { status: 400 },
      );
    }

    const body = PatchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { success: false, error: "Body must be { archived: boolean }." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const archived_at = body.data.archived ? new Date().toISOString() : null;

    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (c: string, v: string) => {
            select: (s: string) => Promise<{
              data: { id: string }[] | null;
              error: { code?: string; message: string } | null;
            }>;
          };
        };
      };
    })
      .from("projects")
      .update({ archived_at })
      .eq("id", parsedId.data)
      .select("id");

    if (error) {
      if (error.code === "PGRST204" || /archived_at/.test(error.message)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Archiving needs migration 030_project_archive.sql, which has not been applied yet.",
            code: "migration_missing",
          },
          { status: 503 },
        );
      }
      throw new Error(error.message);
    }
    if (!data || data.length === 0) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, archived_at });
  } catch (err) {
    console.error("[api/projects PATCH] error", err);
    const message = err instanceof Error ? err.message : "Update failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
