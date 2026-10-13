import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { storeErrorResponse } from "@/lib/firms/http";
import { StoreError, assignProjectFirm } from "@/lib/firms/store";
import { softDeleteProject } from "@/lib/projects/lifecycle";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { projectAccess } from "@/lib/projects/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IdSchema = z.string().uuid();

// K10 (spec §6.12, migration 055) — DELETE /api/projects/:id { confirm_name }
// is a SOFT delete: the project moves to Recently deleted for 30 days, hidden
// from everyone on it (every project route and page then answers not found),
// and the daily purge removes it with its Storage objects. Only an owner
// project's creator or a firm admin may delete (403 not_allowed_to_delete,
// with the reason the menu shows); the typed name must match (422
// name_mismatch). Restore: POST …/restore. "Delete now": POST …/delete-now.
// It used to be an instant hard delete any member could run, which also left
// the project's files in Storage.
const DeleteSchema = z.object({ confirm_name: z.string().max(400) });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const parsed = IdSchema.safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid project id." }, { status: 400 });
  const body = DeleteSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: "Body must be { confirm_name: string }.", code: "bad_request" }, { status: 400 });
  try {
    const r = await softDeleteProject(getSupabaseAdmin() as unknown as SupabaseClient, parsed.data, caller, body.data.confirm_name);
    return NextResponse.json({ success: true, ...r });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

// G5: `display_name` (migration 038) is the name client-facing documents print;
// null clears it back to the working name.
// L1: `firm_id` (migration 041) — the firm whose private rate book prices this
// project. null = the reference book only.
const PatchSchema = z
  .object({
    archived: z.boolean().optional(),
    // K10: rename — the name the list shows (display_name when one is set, else name).
    name: z.string().trim().min(1).max(200).optional(),
    display_name: z.string().trim().min(1).max(200).nullable().optional(),
    firm_id: z.string().uuid().nullable().optional(),
  })
  .refine(
    (b) => b.archived !== undefined || b.display_name !== undefined || b.firm_id !== undefined || b.name !== undefined,
    "Body needs archived, name, display_name or firm_id.",
  );

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
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  try {
    const { id } = await params;
    const parsedId = IdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: "Invalid project id." },
        { status: 400 },
      );
    }
    const access = await projectAccess(getSupabaseAdmin() as unknown as SupabaseClient, caller, { project_id: parsedId.data });
    if (access.denied) return access.denied;

    const body = PatchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { success: false, error: "Body must be { archived?: boolean, name?: string, display_name?: string | null, firm_id?: uuid | null }." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    if (body.data.name !== undefined) {
      // K10 rename (any member): the list shows display_name || name, so the
      // rename writes whichever the list is showing — a client-facing
      // display_name (038) is renamed in place, never shadowed.
      const db = supabase as unknown as SupabaseClient;
      const { data: cur } = await db.from("projects").select("display_name").eq("id", parsedId.data).maybeSingle<{ display_name: string | null }>();
      const patch = cur?.display_name ? { display_name: body.data.name } : { name: body.data.name };
      const { error } = await db.from("projects").update(patch).eq("id", parsedId.data);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, name: body.data.name });
    }
    if (body.data.firm_id !== undefined) {
      // U1: attaching a firm needs a signed-in member of that firm (detaching,
      // a member of the firm being detached). The rest of this PATCH needs a
      // signed-in caller (H1) but no ownership of the project yet.
      try {
        await assignProjectFirm(supabase as unknown as import("@supabase/supabase-js").SupabaseClient, parsedId.data, body.data.firm_id, caller);
      } catch (e) {
        if (e instanceof StoreError) return NextResponse.json({ success: false, error: e.message, code: e.code }, { status: e.status });
        throw e;
      }
      if (body.data.display_name === undefined && body.data.archived === undefined) {
        return NextResponse.json({ success: true, firm_id: body.data.firm_id });
      }
    }
    if (body.data.display_name !== undefined && body.data.archived === undefined) {
      const { data, error } = await (supabase as unknown as import("@supabase/supabase-js").SupabaseClient)
        .from("projects")
        .update({ display_name: body.data.display_name })
        .eq("id", parsedId.data)
        .select("id, display_name");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });
      return NextResponse.json({ success: true, display_name: body.data.display_name });
    }
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
