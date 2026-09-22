import { curateBoq, loadWithheldNames } from "@/lib/identity/curation";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { guardDocumentRoute } from "@/lib/documents/pack-export/guard";

import { renderBoqPdf, type BoqPdfInput } from "@/lib/documents/boq-pdf";
import { loadPackReadiness, readinessMessage } from "@/lib/documents/pack-readiness";
import { loadParity } from "@/lib/documents/parity-load";
import { loadDocumentProject } from "@/lib/documents/project-name";
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
  const format = new URL(request.url).searchParams.get("format");
  // T5: a BoQ PDF (or its printed pages) goes only to a running pack export —
  // the readiness-only JSON (no document content) stays open.
  if (format !== "json") {
    const denied = await guardDocumentRoute(request, projectId);
    if (denied) return denied;
  }

  try {
    const [project, boq, readiness] = await Promise.all([
      loadDocumentProject(sb, projectId),
      sb.from("boqs").select("id, sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; sections: BoqPdfInput["boq"] }>(),
      loadPackReadiness(sb, projectId),
    ]);
    if (!boq.data) return NextResponse.json({ error: "No BoQ has been generated for this project." }, { status: 404 });
    const json = format === "json";
    if (!readiness.ready && !json) {
      return NextResponse.json({ error: readinessMessage(readiness), code: "pack_not_ready", readiness }, { status: 409 });
    }
    // G5c: a BoQ PDF is a pack export — it leaves only when parity holds.
    const parity = json ? null : await loadParity(sb, projectId);
    if (parity && !parity.clean) {
      const fails = [...parity.lines.filter((l) => l.status === "fail").map((l) => `${l.rule_id}: ${l.reason}`), ...parity.elements.filter((e) => e.status === "fail").map((e) => `${e.name}: ${e.reason}`)];
      return NextResponse.json({ error: `Parity failed: ${fails.slice(0, 6).join("; ")}`, code: "parity_failed", parity }, { status: 409 });
    }
    const { pdf, pages } = await renderBoqPdf({
      projectName: project.name,
      community: project.city,
      dateISO: new Date().toISOString().slice(0, 10),
      // I4: curated — a stored BoQ may predate the source scrub.
      boq: curateBoq(boq.data.sections, await loadWithheldNames(sb, projectId)),
    });
    if (json) return NextResponse.json({ readiness, pages: pages.length, bytes: pdf.byteLength, boq_id: boq.data.id });
    // T5: exactly the pages this PDF printed, for the pack's printed-content checks.
    if (format === "pages") return NextResponse.json({ readiness, pages, boq_id: boq.data.id });
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
