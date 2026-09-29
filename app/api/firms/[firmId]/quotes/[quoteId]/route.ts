import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { acceptQuote, confirmSuggestions, getQuote } from "@/lib/quotes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// U3 — one quotation, in review or accepted.
//
//   GET  /api/firms/:firmId/quotes/:quoteId          the record and every line
//   POST /api/firms/:firmId/quotes/:quoteId          { action: "confirm_suggestions", min_score? }
//                                                    a member confirms every suggestion
//                                                    at/above the score, in one act
//                                                  | { action: "accept" }
//                                                    the only step that creates rates:
//                                                    one entry per matched line (origin
//                                                    quote_import), earlier quote entries
//                                                    for the same key superseded, never
//                                                    deleted; held lines stay held.

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm_suggestions"), min_score: z.number().min(0).max(1).optional() }),
  z.object({ action: z.literal("accept") }),
]);

type Ctx = { params: Promise<{ firmId: string; quoteId: string }> };

async function ids(ctx: Ctx) {
  const { firmId, quoteId } = await ctx.params;
  return UuidSchema.safeParse(firmId).success && UuidSchema.safeParse(quoteId).success ? { firmId, quoteId } : null;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to work with a firm.");
  const p = await ids(ctx);
  if (!p) return badRequest("Invalid firm or quote id.");
  try {
    return NextResponse.json({ success: true, ...(await getQuote(firmDb(), p.firmId, p.quoteId, caller)) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to work with a firm.");
  const p = await ids(ctx);
  if (!p) return badRequest("Invalid firm or quote id.");
  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    if (parsed.data.action === "confirm_suggestions") {
      const r = await confirmSuggestions(firmDb(), p.firmId, p.quoteId, caller, parsed.data.min_score ?? 0.5);
      return NextResponse.json({ success: true, ...r });
    }
    const r = await acceptQuote(firmDb(), p.firmId, p.quoteId, caller);
    return NextResponse.json({ success: true, ...r });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
