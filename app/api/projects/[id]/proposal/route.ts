import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { guardDocumentRoute, packJobActor } from "@/lib/documents/pack-export/guard";
import { loadProposalGate } from "@/lib/documents/proposal-gate";
import { renderProposalPdf } from "@/lib/documents/proposal-pdf";
import type { ProposalScopeRoom } from "@/lib/documents/proposal";
import { loadDocumentProject } from "@/lib/documents/project-name";
import { loadLogoDataUri } from "@/lib/firms/branding";
import { INTERNAL_REF } from "@/lib/ground-truth/villa94-garden";
import { curateBoq, findWithheldIdentities, loadWithheldNames } from "@/lib/identity/curation";
import { recordPilotEvent } from "@/lib/pilot/events";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { BoqPdfInput } from "@/lib/documents/boq-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// L4 — GET /api/projects/:id/proposal[?format=pdf|pages|json]
//
// The firm's client-facing proposal. A DOCUMENT route: served only to a
// running pack-export job (T5), and only when the reference-basis gate holds —
// the firm's book is reviewed, or the firm accepted the reference basis for
// this BoQ revision, or every line is the firm's own rate. `?format=json`
// (no content) answers the gate for the UI. Every printed page is scanned for
// withheld identities before it leaves; the firm's OWN brand is the one name
// that belongs on it.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const projectId = parsed.data;
  const format = new URL(request.url).searchParams.get("format") ?? "pdf";
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  if (format !== "json") {
    const denied = await guardDocumentRoute(request, projectId);
    if (denied) return denied;
  }
  try {
    const gate = await loadProposalGate(sb, projectId);
    const summary = {
      firm: gate.firm ? { brand: gate.firm.brand, logo: !!gate.firm.logo_path, terms: !!gate.firm.terms_text, book_status: gate.firm.book_status } : null,
      boq: gate.boq,
      acceptance: gate.acceptance,
      verdict: gate.verdict,
    };
    if (format === "json") return NextResponse.json({ ready: gate.verdict.ok, ...summary });
    if (!gate.verdict.ok) return NextResponse.json({ error: gate.verdict.refusal, code: "proposal_not_ready", ...summary }, { status: 409 });

    const withheld = await loadWithheldNames(sb, projectId);
    const [project, boqRow, logo, plan] = await Promise.all([
      loadDocumentProject(sb, projectId, "Untitled project"),
      sb.from("boqs").select("id, sections").eq("id", gate.boq!.id).maybeSingle<{ id: string; sections: BoqPdfInput["boq"] }>(),
      loadLogoDataUri(sb, gate.firm!.logo_path),
      sb.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>(),
    ]);
    if (!boqRow.data) return NextResponse.json({ error: "No BoQ has been generated for this project." }, { status: 404 });
    const { data: roomRows } = plan.data ? await sb.from("rooms").select("name_en, room_type, area_m2").eq("plan_id", plan.data.id).order("name_en") : { data: [] };
    const rooms: ProposalScopeRoom[] = ((roomRows ?? []) as { name_en: string | null; room_type: string | null; area_m2: number | null }[]).map((r) => ({
      name: r.name_en ?? "Area",
      kind: r.room_type ?? "",
      area_m2: r.area_m2 == null ? null : Number(r.area_m2),
    }));
    const { pdf, pages } = await renderProposalPdf({
      brand: gate.firm!.brand,
      logoDataUri: logo,
      termsText: gate.firm!.terms_text,
      projectName: project.name,
      community: project.city,
      dateISO: new Date().toISOString().slice(0, 10),
      rooms,
      boq: curateBoq(boqRow.data.sections, withheld),
    });
    // Identity: the firm's own brand is allowed (withheld names exclude the
    // project's firm); anything else withheld refuses the document.
    const tokens = [String(INTERNAL_REF).split(/[^A-Za-z0-9]+/)[0]!, String(INTERNAL_REF)].filter((x) => x.length >= 3);
    const leaks = [...findWithheldIdentities(pages, withheld), ...tokens.filter((tok) => pages.some((p) => p.toLowerCase().includes(tok.toLowerCase())))];
    if (leaks.length > 0) {
      console.error("[api/proposal] withheld identity on a printed page", leaks);
      return NextResponse.json({ error: "The proposal would print a withheld identity; refused.", code: "identity_leak" }, { status: 500 });
    }
    if (format === "pages") return NextResponse.json({ pages, ...summary, boq_id: boqRow.data.id });
    await recordPilotEvent(sb, projectId, "pack_exported", { document: "proposal", boq_id: boqRow.data.id, pages: pages.length, basis: gate.verdict.reason }, { actor: await packJobActor(request) });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="proposal-${projectId.slice(0, 8)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/proposal] error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Proposal failed." }, { status: 500 });
  }
}
