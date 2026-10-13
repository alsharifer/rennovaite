import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { applyCorrection } from "@/lib/boq/apply-correction";
import { BASIS_KINDS } from "@/lib/boq/own-basis-vocab";
import { storeErrorResponse } from "@/lib/firms/http";
import { requireFirm } from "@/lib/firms/store";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// K11 #4 (spec §7.3, migration 057) — POST /api/projects/:id/boq-apply.
// "Add a price" (origin add_price) and "Apply to this BoQ now" (a rate or
// quantity correction): records the correction — or takes a saved one by
// `correction_id` — and stores the NEXT revision with every applied correction
// laid over the latest one (lib/boq/apply-correction.ts). `boq_id` is the
// revision the member was looking at: a newer one answers 409 stale_revision.
// Any project member; a `firm_id` (promote later) needs membership of that firm.
const Body = z.object({
  boq_id: z.string().uuid(),
  correction_id: z.string().uuid().nullable().optional(),
  row_key: z.string().max(300).nullable().optional(),
  correction_type: z.enum(["rate", "quantity"]).optional(),
  new_value: z.number().finite().optional(),
  origin: z.enum(["correction", "add_price"]).optional(),
  basis_kind: z.enum(BASIS_KINDS as [string, ...string[]]).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  line_ref: z.string().max(40).nullable().optional(),
  line_description: z.string().max(500).nullable().optional(),
  element_refs: z.array(z.string()).max(200).nullable().optional(),
  firm_id: z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ success: false, error: "Invalid project id." }, { status: 400 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: body.error.message, code: "bad_request" }, { status: 400 });
  const b = body.data;
  if (!b.correction_id && (!b.row_key || b.new_value === undefined)) {
    return NextResponse.json({ success: false, error: "Send correction_id, or row_key with new_value.", code: "bad_request" }, { status: 400 });
  }
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { project_id: id.data, boq_id: b.boq_id });
  if (access.denied) return access.denied;
  try {
    if (b.firm_id) await requireFirm(db, b.firm_id, caller);
    const r = await applyCorrection(db, id.data, caller, {
      boqId: b.boq_id,
      correctionId: b.correction_id ?? null,
      rowKey: b.row_key ?? null,
      type: b.correction_type,
      value: b.new_value,
      origin: b.origin,
      basisKind: (b.basis_kind as never) ?? null,
      note: b.note ?? null,
      lineRef: b.line_ref ?? null,
      lineDescription: b.line_description ?? null,
      elementRefs: b.element_refs ?? null,
      firmId: b.firm_id ?? null,
    });
    return NextResponse.json({
      success: true,
      boq_id: r.boqId,
      rev: r.rev,
      previous_boq_id: r.previousBoqId,
      previous_total_aed: r.previousTotal,
      grand_total_aed: r.total,
      correction_id: r.correctionId,
    });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
