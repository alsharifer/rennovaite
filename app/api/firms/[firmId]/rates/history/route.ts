import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { listEntryHistory } from "@/lib/firms/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// U4 — GET /api/firms/:firmId/rates/history?item_key=<key>
//
// The trail of one item in THIS firm's book: every entry ever made for it —
// active first, then history, newest first — with who made it, who retired it
// and why, what replaced it, and the correction or quotation it came from.
// Members only (401 / 403 / 404). Member ids are resolved to emails best-effort
// for the firm's own eyes; nothing here reaches a document.

type Ctx = { params: Promise<{ firmId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to work with a firm.");
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  const itemKey = new URL(request.url).searchParams.get("item_key")?.trim() ?? "";
  if (!z.string().min(1).max(120).safeParse(itemKey).success) return badRequest("item_key is required.");
  try {
    const db = firmDb();
    const history = await listEntryHistory(db, firmId, itemKey, caller);
    const ids = [...new Set(history.flatMap((h) => [h.created_by, h.retired_by]).filter((x): x is string => !!x))];
    const actors: Record<string, string> = {};
    for (const id of ids) {
      try {
        const { data } = await db.auth.admin.getUserById(id);
        if (data?.user?.email) actors[id] = data.user.email;
      } catch {
        /* an unresolved id shows as "a member" */
      }
    }
    return NextResponse.json({ success: true, item_key: itemKey, history, actors });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
