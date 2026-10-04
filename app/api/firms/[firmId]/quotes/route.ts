import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { importQuote, listQuotes } from "@/lib/quotes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// U3 — a firm's quotations.
//
//   GET  /api/firms/:firmId/quotes   the firm's quote records (never their lines)
//   POST /api/firms/:firmId/quotes   multipart: file (xlsx from the template) +
//                                    supplier_label, supplier_role, quote_ref?,
//                                    quote_date?, valid_until?, currency,
//                                    vat_treatment, rates_are, discount_pct
//                                    → the quote in REVIEW with one line per
//                                    row and a SUGGESTED item per line. Nothing
//                                    enters the book here.

const MAX_BYTES = 5 * 1024 * 1024;
const XLSX_TYPES = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", ""]);

const MetaSchema = z.object({
  supplier_label: z.string().trim().min(1).max(160),
  supplier_role: z.enum(["supplier", "contractor", "manufacturer", "other"]).default("supplier"),
  quote_ref: z.string().trim().max(120).optional().nullable(),
  quote_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null)),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null)),
  currency: z.string().trim().min(3).max(3).default("AED"),
  vat_treatment: z.enum(["excl", "incl", "unknown"]).default("excl"),
  rates_are: z.enum(["net", "list"]).default("net"),
  discount_pct: z.coerce.number().min(0).max(99.99).default(0),
});

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
  const form = await request.formData().catch(() => null);
  if (!form) return badRequest("Expected multipart form data with a file.");
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("Attach the filled template as `file`.");
  if (file.size > MAX_BYTES) return NextResponse.json({ success: false, error: "The workbook is over 5 MB.", code: "payload_too_large" }, { status: 413 });
  if (!XLSX_TYPES.has(file.type) && !/\.xlsx$/i.test(file.name)) return badRequest("Upload the .xlsx template (not CSV or PDF).");
  const fields: Record<string, string> = {};
  for (const k of ["supplier_label", "supplier_role", "quote_ref", "quote_date", "valid_until", "currency", "vat_treatment", "rates_are", "discount_pct"]) {
    const v = form.get(k);
    if (typeof v === "string") fields[k] = v;
  }
  const parsed = MetaSchema.safeParse(fields);
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await importQuote(firmDb(), firmId, caller, parsed.data, { name: file.name, bytes });
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
