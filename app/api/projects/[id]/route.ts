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
