import { NextResponse, type NextRequest } from "next/server";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { listQuotes } from "@/lib/quotes/store";
import { uploadErrorResponse } from "@/lib/uploads/http";
import { finishUpload } from "@/lib/uploads/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// U3 — a firm's quotations.
//
//   GET  /api/firms/:firmId/quotes   the firm's quote records (never their lines)
//   POST /api/firms/:firmId/quotes   { path } of the uploaded workbook (H9) +
//                                    supplier_label, supplier_role, quote_ref?,
//                                    quote_date?, valid_until?, currency,
//                                    vat_treatment, rates_are, discount_pct
//                                    → the quote in REVIEW with one line per
//                                    row and a SUGGESTED item per line. Nothing
//                                    enters the book here.

type Ctx = { params: Promise<{ firmId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to work with a firm.");
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  try {
    return NextResponse.json({ success: true, quotes: await listQuotes(firmDb(), firmId, caller) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to work with a firm.");
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  // H9: the workbook was uploaded straight to Storage (kind "quote", signed for
  // THIS firm); the body is { path, filename?, …the quote's terms }.
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.path !== "string") return badRequest("Upload the filled template first, then send its path.");
  if (!body.path.startsWith(`pending/quote/${firmId}/`)) return badRequest("That upload is not for this firm.");
  try {
    const { path, ...fields } = body;
    return NextResponse.json(await finishUpload(firmDb(), caller, path, fields, "quote"), { status: 201 });
  } catch (e) {
    return uploadErrorResponse(e, "api/firms/quotes");
  }
}
