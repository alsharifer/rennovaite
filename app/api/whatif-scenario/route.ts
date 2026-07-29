import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { saveScenario } from "@/lib/whatif/rate-book";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  project_id: z.string().uuid(),
  selections: z.record(
    z.string(),
    z.enum(["economy", "standard", "premium"]),
  ),
  total: z.number(),
});

/** POST /api/whatif-scenario — persist a grade selection over the baseline BoQ. */
export async function POST(request: NextRequest) {
  if (process.env.WHATIF_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const supabase = getSupabaseAdmin() as unknown as SupabaseClient;
  const ok = await saveScenario(
    supabase,
    parsed.data.project_id,
    parsed.data.selections,
    parsed.data.total,
  );
  return NextResponse.json({ success: ok });
}
