import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { ProposalSetupInput, getProposalSetup, saveProposalSetup } from "@/lib/documents/proposal-setup";
import { storeErrorResponse } from "@/lib/firms/http";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// K4 — the proposal's setup (R7 §3.7, migration 053). Not a document: it
// saves what the proposal will say.
//
//   GET /api/projects/:id/proposal-setup   the setup (the firm's defaults until saved)
//   PUT /api/projects/:id/proposal-setup   { client_label?, validity_days?, payment_terms?,
//        cover_note?, show_line_rates? } — a MEMBER of the project's firm; validity,
//        payment terms and the line-rate choice also become the firm's defaults.

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to read the proposal setup.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const access = await projectAccess(db(), caller, { project_id: id });
  if (access.denied) return access.denied;
  try {
    return NextResponse.json({ success: true, setup: await getProposalSetup(db(), id, caller) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to save the proposal setup.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const access = await projectAccess(db(), caller, { project_id: id });
  if (access.denied) return access.denied;
  const parsed = ProposalSetupInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    return NextResponse.json({ success: true, setup: await saveProposalSetup(db(), id, parsed.data, caller) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
