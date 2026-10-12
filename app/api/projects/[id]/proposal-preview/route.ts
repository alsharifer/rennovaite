import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { buildProposalPages } from "@/lib/documents/proposal";
import { loadProposalGate } from "@/lib/documents/proposal-gate";
import { loadProposalInput, proposalLeaks } from "@/lib/documents/proposal-load";
import { storeErrorResponse } from "@/lib/firms/http";
import { requireFirm } from "@/lib/firms/store";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// K4 — GET /api/projects/:id/proposal-preview → { pages: string[] }
//
// "Preview as client" (R7 §3.7): the proposal exactly as it would print, as SVG
// pages for the screen, with PREVIEW · NOT ISSUED across every page. It is
// never a PDF and never a release — the proposal itself leaves only through
// the gated export (/proposal, a pack-job document route) — so it answers
// even while the reference-basis gate is closed: a firm can see what it would
// send before deciding. Members of the project's firm only; every page is
// scanned for withheld identities like the document's.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to preview the proposal.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(sb, caller, { project_id: id });
  if (access.denied) return access.denied;
  try {
    const gate = await loadProposalGate(sb, id);
    if (!gate.firm) return NextResponse.json({ error: "A proposal is a firm's document — this project has no firm attached.", code: "no_firm" }, { status: 409 });
    await requireFirm(sb, gate.firm.firm_id, caller);
    const loaded = await loadProposalInput(sb, id, gate, { preview: true });
    if (!loaded) return NextResponse.json({ error: "There is no priced BoQ to preview yet.", code: "no_boq" }, { status: 409 });
    const pages = buildProposalPages(loaded.input);
    const leaks = proposalLeaks(pages, loaded.withheld);
    if (leaks.length > 0) {
      console.error("[api/proposal-preview] withheld identity on a page", leaks);
      return NextResponse.json({ error: "The proposal would print a withheld identity; refused.", code: "identity_leak" }, { status: 500 });
    }
    return NextResponse.json({ pages, boq_id: loaded.boqId, ready: gate.verdict.ok });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
