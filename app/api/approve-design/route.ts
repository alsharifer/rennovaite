import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { recordFeedback } from "@/lib/analytics";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { upscaleRender } from "@/lib/render-upscale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const BodySchema = z.object({
  project_id: z.string().uuid(),
  room_id: z.string().uuid(),
  render_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 },
      );
    }
    const { project_id, room_id, render_id } = parsed.data;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("approved_designs")
      .insert({ project_id, room_id, render_id })
      .select("id")
      .single();

    if (error) throw error;

    // Feedback: locking a render is the strongest "accepted" signal. Pull the
    // KG bundle that produced this render so the reweighting job can credit it.
    const { data: render } = await supabase
      .from("renders")
      .select("kg_bundle_id, image_url")
      .eq("id", render_id)
      .maybeSingle();
    await recordFeedback({
      projectId: project_id,
      entityType: "render",
      entityId: render_id,
      action: "accepted",
      kgBundleId: render?.kg_bundle_id ?? null,
      payload: { room_id },
    });

    // Finish pass: run the approved render through a 2× upscaler and store the
    // print-quality export alongside the approval. Fail-soft — the lock has
    // already succeeded, so an upscale failure just leaves upscaled_url null.
    let upscaledUrl: string | null = null;
    const replicateKey = process.env.REPLICATE_API_TOKEN;
    if (replicateKey && render?.image_url) {
      upscaledUrl = await upscaleRender(replicateKey, render.image_url);
      if (upscaledUrl) {
        const { error: updErr } = await supabase
          .from("approved_designs")
          .update({ upscaled_url: upscaledUrl })
          .eq("id", data.id);
        if (updErr) {
          console.warn(
            "[api/approve-design] upscaled_url update failed:",
            updErr.message,
          );
        }
      }
    }

    return NextResponse.json({ id: data.id, upscaled_url: upscaledUrl });
  } catch (err) {
    console.error("[api/approve-design] error", err);
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to save approval.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
