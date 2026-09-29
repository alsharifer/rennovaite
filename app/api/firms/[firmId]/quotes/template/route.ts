import { NextResponse, type NextRequest } from "next/server";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { requireFirm } from "@/lib/firms/store";
import { listVocabulary } from "@/lib/firms/vocabulary";
import { buildTemplate } from "@/lib/quotes/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// U3 — GET /api/firms/:firmId/quotes/template
//
// The xlsx a firm hands its supplier: a Quote sheet to fill, a How-to-fill
// sheet, and the take-off Vocabulary (key, label, unit, section, kinds) so a
// known key can be written in directly. Members only, like every firm route.

export async function GET(request: NextRequest, ctx: { params: Promise<{ firmId: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to work with a firm.");
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  try {
    await requireFirm(firmDb(), firmId, caller);
    const vocab = listVocabulary().map((v) => ({ ...v, reference: { kind: "none" as const } }));
    const bytes = buildTemplate(vocab);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="rennovaite-quote-template.xlsx"',
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
