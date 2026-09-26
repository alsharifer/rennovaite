import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller } from "@/lib/auth/caller";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { createEntry, listEntries } from "@/lib/firms/store";
import { FIRM_ENTRY_KINDS } from "@/lib/rates/firm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L1 — a firm's private rate book. U1 — members only (401 / 403 / 404).
//
//   GET  /api/firms/:firmId/rates   THIS firm's entries — the query is scoped by
//                                   firm_id, so no other firm's rate is reachable
//   POST /api/firms/:firmId/rates   { item_key, unit, rate_aed, kind, grade?, note? }
//                                   validated against the take-off vocabulary
//                                   (lib/firms/vocabulary.ts); 422 with reasons

const EntrySchema = z.object({
  item_key: z.string().trim().min(1).max(120),
  grade: z.enum(["economy", "standard", "premium"]).nullable().optional(),
  unit: z.string().trim().min(1).max(20),
  rate_aed: z.number().finite().nonnegative(),
  kind: z.enum(FIRM_ENTRY_KINDS),
  note: z.string().trim().max(500).nullable().optional(),
});

type Ctx = { params: Promise<{ firmId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  try {
    const caller = await getCaller(request);
    return NextResponse.json({ success: true, entries: await listEntries(firmDb(), firmId, caller) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  const parsed = EntrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const caller = await getCaller(request);
    const entry = await createEntry(firmDb(), firmId, parsed.data, caller);
    return NextResponse.json({ success: true, entry }, { status: 201 });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
