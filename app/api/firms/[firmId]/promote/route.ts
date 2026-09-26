import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller } from "@/lib/auth/caller";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { promoteCorrection } from "@/lib/firms/store";
import { FIRM_ENTRY_KINDS } from "@/lib/rates/firm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L1 — POST /api/firms/:firmId/promote
//
// { correction_id, rate_aed?, unit?, kind?, grade?, note? }
//
// The explicit act that turns one of THIS firm's market_fair corrections into a
// rate in its private book (tier 2 — origin promoted_correction). Until it is
// called, a correction is recorded and never applied. U1: members only (401 /
// 403 not_a_member / 404). Then 403 for another firm's correction, 409 if
// already promoted, 422 unless it is a `rate` correction with an item_key.

const PostSchema = z.object({
  correction_id: z.string().uuid(),
  rate_aed: z.number().finite().nonnegative().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  kind: z.enum(FIRM_ENTRY_KINDS).optional(),
  grade: z.enum(["economy", "standard", "premium"]).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const caller = await getCaller(request);
    const result = await promoteCorrection(firmDb(), firmId, parsed.data, caller);
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
