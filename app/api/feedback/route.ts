import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { recordFeedback } from "@/lib/analytics";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generic feedback sink for client-originated capture points (e.g. rejecting a
// render in the studio). Server routes that already touch the DB call
// recordFeedback directly; this exists for the client-only signals.
const BodySchema = z.object({
  project_id: z.string().uuid(),
  entity_type: z.enum(["render", "boq_line", "vendor", "style", "plan"]),
  entity_id: z.string().min(1),
  action: z.enum(["accepted", "rejected", "iterated", "swapped", "edited"]),
  kg_bundle_id: z.string().nullish(),
  payload: z.record(z.string(), z.unknown()).nullish(),
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
    const body = parsed.data;

    // For render entities, resolve the producing KG bundle server-side if the
    // client didn't supply it (the client doesn't hold kg_bundle_id).
    let kgBundleId = body.kg_bundle_id ?? null;
    if (!kgBundleId && body.entity_type === "render") {
      const { data: render } = await getSupabaseAdmin()
        .from("renders")
        .select("kg_bundle_id")
        .eq("id", body.entity_id)
        .maybeSingle();
      kgBundleId = render?.kg_bundle_id ?? null;
    }

    await recordFeedback({
      projectId: body.project_id,
      entityType: body.entity_type,
      entityId: body.entity_id,
      action: body.action,
      kgBundleId,
      payload: body.payload ?? {},
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/feedback] error", err);
    const message = err instanceof Error ? err.message : "Failed to record feedback.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
