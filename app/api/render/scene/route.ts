import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadGardenSceneContext, renderGardenCamera } from "@/lib/scene-render/pipeline";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// G4b plan-faithful garden renders.
//   GET  ?project_id=           cameras for the plan and what has been rendered
//   POST {project_id, camera_id, view}  render one camera/view through the gated
//        ladder (synchronous: a gated render is two model calls and two checks,
//        and the caller wants the verdict, not a prediction id)

const BodySchema = z.object({
  project_id: z.string().uuid(),
  camera_id: z.string().min(3).max(120),
  view: z.enum(["day", "evening"]).default("day"),
});

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project_id") ?? "";
  if (!z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "project_id is required." }, { status: 400 });
  }
  try {
    const ctx = await loadGardenSceneContext(projectId);
    const { data } = await (getSupabaseAdmin() as unknown as SupabaseClient)
      .from("renders")
      .select("id, camera, view, image_url, gate, created_at")
      .eq("project_id", projectId)
      .eq("mode", "scene")
      .order("created_at", { ascending: false });
    const latest = new Map<string, { id: string; image_url: string; outcome: string }>();
    for (const r of (data ?? []) as { id: string; camera: string; view: string; image_url: string; gate: { outcome: string } | null }[]) {
      const k = `${r.camera}|${r.view}`;
      if (!latest.has(k)) latest.set(k, { id: r.id, image_url: r.image_url, outcome: r.gate?.outcome ?? "unknown" });
    }
    return NextResponse.json({
      cameras: ctx.cameras.map((c) => ({ id: c.id, label: c.label, zone_id: c.zoneId, lit: c.lit, clean: c.clean, mode: c.mode, clean_reasons: c.cleanReasons, day: latest.get(`${c.id}|day`) ?? null, evening: c.lit ? (latest.get(`${c.id}|evening`) ?? null) : null })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load the garden scene." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { project_id, camera_id, view } = parsed.data;
  try {
    const ctx = await loadGardenSceneContext(project_id);
    const cam = ctx.cameras.find((c) => c.id === camera_id);
    if (!cam) return NextResponse.json({ error: `Unknown camera '${camera_id}'.`, code: "unknown_camera" }, { status: 404 });
    if (view === "evening" && !cam.lit) {
      return NextResponse.json({ error: "This view has no designed lighting, so it has no evening render.", code: "no_lighting" }, { status: 422 });
    }
    const result = await renderGardenCamera(ctx, camera_id, view);
    return NextResponse.json({ ...result, prompt: result.outcome === "passed" ? "Plan-faithful render" : "3D design view (render withheld)" });
  } catch (err) {
    console.error("[api/render/scene] error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Scene render failed." }, { status: 500 });
  }
}
