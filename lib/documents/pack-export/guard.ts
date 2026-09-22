// =============================================================================
// lib/documents/pack-export/guard.ts — no ungated document path (T5).
//
// Every route that produces a client document (drawing-set PDF / sheet SVGs,
// render-pack PDF / pages, BoQ PDF / pages) calls guardDocumentRoute first. It
// serves the document only to a RUNNING pack export job (the job id in the
// PACK_JOB_HEADER), which means only runPackExport — with every gate on — can
// obtain one. Otherwise:
//   - PACK_EXPORT_ENABLED off → 404 (the surface is invisible);
//   - a browser navigation → redirect to the Export pack action, where the gate
//     is a readable checklist;
//   - anything else → a 403 that says how documents are produced.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { PACK_JOB_HEADER } from "./guard-header";
import { jobAuthorises } from "./job";

export { PACK_JOB_HEADER };

/**
 * The one visibility rule for the Export pack action AND the routes it calls,
 * so a button can never point at a route that 404s (the old BoQ PDF button
 * showed whenever the BoQ was a garden one, while its route required
 * DRAWINGS_ENABLED).
 */
export function packExportEnabled(): boolean {
  return process.env.PACK_EXPORT_ENABLED === "true" && process.env.DRAWINGS_ENABLED === "true";
}

export async function guardDocumentRoute(request: NextRequest, projectId: string): Promise<NextResponse | null> {
  if (!packExportEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  if (await jobAuthorises(db, request.headers.get(PACK_JOB_HEADER), projectId)) return null;
  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    return NextResponse.redirect(new URL(`/project/${projectId}/drawings?export=1`, request.url), 303);
  }
  return NextResponse.json(
    { error: "Client documents are produced by Export pack, which runs every gate first.", code: "use_pack_export", export: `/project/${projectId}/drawings?export=1` },
    { status: 403 },
  );
}
