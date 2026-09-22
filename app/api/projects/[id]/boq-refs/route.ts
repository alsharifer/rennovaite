import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { refMigration, refMigrationCsv } from "@/lib/boq/refs";
import { curateBoq, loadWithheldNames } from "@/lib/identity/curation";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// D5 — GET /api/projects/:id/boq-refs[?format=csv]
//
// The REF migration table for the project's latest BoQ: every line's pre-D5
// code (section initials + number — ambiguous on its own, so always paired with
// its section) beside its unique code. The same table is the "REF changes" page
// of the BoQ PDF; this is the machine-readable copy for partners reconciling
// documents they already hold.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const { data, error } = await sb
    .from("boqs")
    .select("id, sections, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; sections: { sections?: { work_section: string; lines: { description?: string }[] }[] }; created_at: string }>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.sections?.sections) return NextResponse.json({ error: "No BoQ has been generated for this project." }, { status: 404 });

  const sections = curateBoq(data.sections.sections, await loadWithheldNames(sb, id));
  const rows = refMigration(sections);
  if (new URL(request.url).searchParams.get("format") === "csv") {
    return new NextResponse(refMigrationCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="boq-ref-migration-${id.slice(0, 8)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json({ boq_id: data.id, generated_at: data.created_at, changed: rows.filter((r) => r.legacy_ref !== r.ref).length, rows });
}
