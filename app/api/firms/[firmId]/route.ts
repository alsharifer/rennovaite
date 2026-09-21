import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { deleteFirm, getFirmSummary, updateFirm } from "@/lib/firms/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L1 — one firm.
//
//   GET    /api/firms/:firmId   the firm + its book header (OH&P, entry count)
//   PATCH  /api/firms/:firmId   { name?, private?, ohp_pct? } — OH&P is applied at
//                               BoQ assembly as its own line, never in a rate
//   DELETE /api/firms/:firmId   the firm, its book and entries (cascade); its
//                               projects fall back to the reference book

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    private: z.boolean().optional(),
    ohp_pct: z.number().finite().min(0).max(50).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Body needs name, private or ohp_pct.");

type Ctx = { params: Promise<{ firmId: string }> };

async function firmIdOf(ctx: Ctx): Promise<string | null> {
  const { firmId } = await ctx.params;
  return UuidSchema.safeParse(firmId).success ? firmId : null;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const firmId = await firmIdOf(ctx);
  if (!firmId) return badRequest("Invalid firm id.");
  try {
    return NextResponse.json({ success: true, firm: await getFirmSummary(firmDb(), firmId) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const firmId = await firmIdOf(ctx);
  if (!firmId) return badRequest("Invalid firm id.");
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    return NextResponse.json({ success: true, firm: await updateFirm(firmDb(), firmId, parsed.data) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const firmId = await firmIdOf(ctx);
  if (!firmId) return badRequest("Invalid firm id.");
  try {
    await deleteFirm(firmDb(), firmId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
