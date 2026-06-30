import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { recordFeedback } from "@/lib/analytics";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getStyleByKey } from "@/lib/styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  project_id: z.string().uuid(),
  style_key: z.string().min(1).max(64),
});

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.message },
        { status: 400 },
      );
    }
    const { project_id, style_key } = parsed.data;

    if (!getStyleByKey(style_key)) {
      return NextResponse.json(
        { success: false, error: `Unknown style: ${style_key}` },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("style_choices")
      .insert({ project_id, style_key, room_id: null })
      .select("id")
      .single();

    if (error) throw error;

    // Feedback: picking a style is an explicit "accepted" signal. No KG bundle
    // here (bundles are produced by render/BoQ); kg_bundle_id stays null.
    await recordFeedback({
      projectId: project_id,
      entityType: "style",
      entityId: style_key,
      action: "accepted",
      payload: { style_key },
    });

    return NextResponse.json({ success: true, style_choice_id: data.id });
  } catch (err) {
    console.error("[api/style-choice] error", err);
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to save style choice.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
