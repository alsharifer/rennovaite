import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller } from "@/lib/auth/caller";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { deleteFirm, getFirmSummary, updateFirm } from "@/lib/firms/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L1 — one firm. U1 — members only: 401 signed out, 403 not a member, 404 no
// such firm (lib/firms/store.ts → requireFirm).
//
//   GET    /api/firms/:firmId   the firm + its book header (OH&P, entry count)
//   PATCH  /api/firms/:firmId   { name?, private?, ohp_pct?, status? } — OH&P is
//                               applied at BoQ assembly as its own line, never
//                               in a rate; status (U2) draft | reviewed — any
//                               later change to the book returns it to draft
//   DELETE /api/firms/:firmId   the firm, its book and entries (cascade); its
//                               projects fall back to the reference book

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    private: z.boolean().optional(),
    ohp_pct: z.number().finite().min(0).max(50).optional(),
    status: z.enum(["draft", "reviewed"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Body needs name, private, ohp_pct or status.");

type Ctx = { params: Promise<{ firmId: string }> };

async function firmIdOf(ctx: Ctx): Promise<string | null> {
  const { firmId } = await ctx.params;
  return UuidSchema.safeParse(firmId).success ? firmId : null;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const firmId = await firmIdOf(ctx);
  if (!firmId) return badRequest("Invalid firm id.");
  try {
    const caller = await getCaller(request);
    return NextResponse.json({ success: true, firm: await getFirmSummary(firmDb(), firmId, caller) });
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
    const caller = await getCaller(request);
    return NextResponse.json({ success: true, firm: await updateFirm(firmDb(), firmId, parsed.data, caller) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const firmId = await firmIdOf(ctx);
  if (!firmId) return badRequest("Invalid firm id.");
  try {
    const caller = await getCaller(request);
    await deleteFirm(firmDb(), firmId, caller);
    return NextResponse.json({ success: true });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
