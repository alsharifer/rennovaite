import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkConsistency, loadGardenSceneContext } from "@/lib/scene-render/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// G5c cross-view consistency.
//   POST {project_id, anchor_render_id}  compare every current passed day render of
//        the project with the anchor render (pergola design, paving, planting,
//        walls) and record the verdict on each render. A passed render that fails
//        does not enter a pack as a render.

const BodySchema = z.object({
  project_id: z.string().uuid(),
  anchor_render_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const ctx = await loadGardenSceneContext(parsed.data.project_id);
    const results = await checkConsistency(ctx, parsed.data.anchor_render_id);
    return NextResponse.json({ anchor_render_id: parsed.data.anchor_render_id, results });
  } catch (err) {
    console.error("[api/render/consistency] error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Consistency check failed." }, { status: 500 });
  }
}
