import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { createFirm, listFirms } from "@/lib/firms/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L1 — firms and their private rate books.
//
//   GET  /api/firms          the firms (id, name, private) — never any rate
//   POST /api/firms          { name, private?, created_by? } → a firm with no book
//
// A firm's rates are only ever read through /api/firms/:firmId/rates, scoped by
// the id in the path. See lib/firms/store.ts for the isolation contract.

const PostSchema = z.object({
  name: z.string().trim().min(1).max(120),
  private: z.boolean().optional(),
  created_by: z.string().trim().max(120).nullable().optional(),
});

export async function GET() {
  try {
    const firms = await listFirms(firmDb());
    return NextResponse.json({ success: true, firms });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const firm = await createFirm(firmDb(), parsed.data);
    return NextResponse.json({ success: true, firm }, { status: 201 });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
