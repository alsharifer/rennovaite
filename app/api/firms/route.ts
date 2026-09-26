import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller } from "@/lib/auth/caller";
import { badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { createFirm, listFirms } from "@/lib/firms/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L1 — firms and their private rate books. U1 — the caller's firms only.
//
//   GET  /api/firms          the CALLER's firms (id, name, private) — never any
//                            rate, never anyone else's firm; 401 signed out
//   POST /api/firms          { name, private?, created_by? } → a firm with no
//                            book; the caller becomes its first member
//
// A firm's rates are only ever read through /api/firms/:firmId/rates, scoped by
// the id in the path AND by the caller's membership. See lib/firms/store.ts.

const PostSchema = z.object({
  name: z.string().trim().min(1).max(120),
  private: z.boolean().optional(),
  created_by: z.string().trim().max(120).nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const caller = await getCaller(request);
    const firms = await listFirms(firmDb(), caller);
    return NextResponse.json({ success: true, firms });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const caller = await getCaller(request);
    const firm = await createFirm(firmDb(), parsed.data, caller);
    return NextResponse.json({ success: true, firm }, { status: 201 });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
