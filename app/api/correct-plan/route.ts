import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { plan_id?: unknown; notes?: unknown }
      | null;

    const planId = typeof body?.plan_id === "string" ? body.plan_id : null;
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

    if (!planId) {
      return NextResponse.json(
        { success: false, error: "plan_id is required" },
        { status: 400 },
      );
    }
    if (!notes) {
      return NextResponse.json(
        { success: false, error: "notes is required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("plans")
      .update({ notes })
      .eq("id", planId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/correct-plan] error", err);
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to save note.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
