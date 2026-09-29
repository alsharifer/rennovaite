import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { acceptReferenceBasis, loadProposalGate } from "@/lib/documents/proposal-gate";
import { storeErrorResponse } from "@/lib/firms/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { projectAccess } from "@/lib/projects/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L4 — the reference-basis gate for a client proposal.
//
//   GET  /api/projects/:id/reference-basis   where the latest BoQ's rates came
//        from (firm / reference / mixed), the firm's book status, the latest
//        acceptance for that revision and the verdict (signed in)
//   POST /api/projects/:id/reference-basis   { boq_id, note? } — a MEMBER of the
//        project's firm accepts the reference basis for that revision. An event:
//        append-only; a regenerated BoQ needs its own.

const PostSchema = z.object({ boq_id: z.string().uuid(), note: z.string().trim().max(500).nullable().optional() });

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to read the pricing basis.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const access = await projectAccess(getSupabaseAdmin() as unknown as SupabaseClient, caller, { project_id: id });
  if (access.denied) return access.denied;
  try {
    const gate = await loadProposalGate(db(), id);
    return NextResponse.json({
      success: true,
      firm: gate.firm ? { firm_id: gate.firm.firm_id, brand: gate.firm.brand, book_status: gate.firm.book_status } : null,
      boq: gate.boq,
      acceptance: gate.acceptance,
      verdict: gate.verdict,
    });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to accept the reference basis.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const access = await projectAccess(getSupabaseAdmin() as unknown as SupabaseClient, caller, { project_id: id });
  if (access.denied) return access.denied;
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const acceptance = await acceptReferenceBasis(db(), id, parsed.data, caller);
    return NextResponse.json({ success: true, acceptance }, { status: 201 });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
