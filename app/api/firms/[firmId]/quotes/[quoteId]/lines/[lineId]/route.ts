import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller } from "@/lib/auth/caller";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { FIRM_ENTRY_KINDS } from "@/lib/rates/firm";
import { updateQuoteLine } from "@/lib/quotes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// U3 — PATCH /api/firms/:firmId/quotes/:quoteId/lines/:lineId
//
// { item_key?: string | null, grade?, kind?, unit?, status?: "rejected" | "unmatched" }
//
// A member confirms the item a line prices (or rejects the line). The line is
// `matched` only when the entry it would create passes the book's own
// validation; otherwise it stays `unmatched` with the reason. Read-only once
// the quote is accepted or superseded (409).

const PatchSchema = z
  .object({
    item_key: z.string().trim().min(1).max(120).nullable().optional(),
    grade: z.enum(["economy", "standard", "premium"]).nullable().optional(),
    kind: z.enum(FIRM_ENTRY_KINDS).nullable().optional(),
    unit: z.string().trim().min(1).max(20).nullable().optional(),
    status: z.enum(["rejected", "unmatched"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Body needs at least one field.");

type Ctx = { params: Promise<{ firmId: string; quoteId: string; lineId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { firmId, quoteId, lineId } = await ctx.params;
  if (![firmId, quoteId, lineId].every((v) => UuidSchema.safeParse(v).success)) return badRequest("Invalid id.");
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const caller = await getCaller(request);
    return NextResponse.json({ success: true, line: await updateQuoteLine(firmDb(), firmId, quoteId, lineId, parsed.data, caller) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
