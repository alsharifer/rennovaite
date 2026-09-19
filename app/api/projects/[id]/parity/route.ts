import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadParity } from "@/lib/documents/parity-load";
import { parityTableText } from "@/lib/documents/parity";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/projects/:id/parity — does the BoQ agree with the drawings and the
 * views? (G5c) Every pack export runs the same check; this route is how the
 * table is read on its own. `?format=text` for the printable table.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.DRAWINGS_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  try {
    const parity = await loadParity(getSupabaseAdmin() as unknown as SupabaseClient, parsed.data);
    if (new URL(request.url).searchParams.get("format") === "text") {
      return new NextResponse(parityTableText(parity), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return NextResponse.json(parity);
  } catch (err) {
    console.error("[api/parity] error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Parity check failed." }, { status: 500 });
  }
}
