import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { renderBoqPdf, type BoqPdfInput } from "@/lib/documents/boq-pdf";
import { loadPackReadiness, readinessMessage } from "@/lib/documents/pack-readiness";
import { recordPilotEvent } from "@/lib/pilot/events";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IdSchema = z.string().uuid();

/**
 * GET /api/projects/:id/boq-pdf — the latest garden BoQ as an A4 PDF (G5).
 *   ?format=json → readiness and page count, no PDF body.
 * Refuses (409) while the pack is not ready: an untyped counter or an undecided
 * existing item is a price nobody has agreed to. Gated with the drawing set.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.DRAWINGS_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = IdSchema.safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const projectId = parsed.data;
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;

  try {
    const [project, boq, readiness] = await Promise.all([
      sb.from("projects").select("name, city").eq("id", projectId).maybeSingle<{ name: string | null; city: string | null }>(),
      sb.from("boqs").select("id, sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; sections: BoqPdfInput["boq"] }>(),
      loadPackReadiness(sb, projectId),
    ]);
    if (!boq.data) return NextResponse.json({ error: "No BoQ has been generated for this project." }, { status: 404 });
    const json = new URL(request.url).searchParams.get("format") === "json";
    if (!readiness.ready && !json) {
      return NextResponse.json({ error: readinessMessage(readiness), code: "pack_not_ready", readiness }, { status: 409 });
    }
    const { pdf, pages } = await renderBoqPdf({
      projectName: project.data?.name?.trim() || "Untitled garden",
      community: project.data?.city?.trim() || "Dubai",
      dateISO: new Date().toISOString().slice(0, 10),
      boq: boq.data.sections,
    });
    if (json) return NextResponse.json({ readiness, pages: pages.length, bytes: pdf.byteLength, boq_id: boq.data.id });
    await recordPilotEvent(sb, projectId, "pack_exported", { document: "boq_pdf", boq_id: boq.data.id, pages: pages.length });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="boq-${projectId.slice(0, 8)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/boq-pdf] error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "BoQ PDF failed." }, { status: 500 });
  }
}
