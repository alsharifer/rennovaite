import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { deleteEntry, updateEntry } from "@/lib/firms/store";
import { FIRM_ENTRY_KINDS } from "@/lib/rates/firm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L1 — one entry in a firm's book. Both verbs are scoped by BOTH ids: an entry
// id from another firm's book is 404 through this firm's path.

const PatchSchema = z
  .object({
    grade: z.enum(["economy", "standard", "premium"]).nullable().optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    rate_aed: z.number().finite().nonnegative().optional(),
    kind: z.enum(FIRM_ENTRY_KINDS).optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Body needs at least one field.");

type Ctx = { params: Promise<{ firmId: string; entryId: string }> };

async function ids(ctx: Ctx): Promise<{ firmId: string; entryId: string } | null> {
  const { firmId, entryId } = await ctx.params;
  return UuidSchema.safeParse(firmId).success && UuidSchema.safeParse(entryId).success ? { firmId, entryId } : null;
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const p = await ids(ctx);
  if (!p) return badRequest("Invalid firm or entry id.");
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    return NextResponse.json({ success: true, entry: await updateEntry(firmDb(), p.firmId, p.entryId, parsed.data) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const p = await ids(ctx);
  if (!p) return badRequest("Invalid firm or entry id.");
  try {
    await deleteEntry(firmDb(), p.firmId, p.entryId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
