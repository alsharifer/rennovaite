// =============================================================================
// lib/documents/file-response.ts — a document route's file answer (H9).
//
// Vercel caps a function's RESPONSE at ~4.5 MB, like its request. A render pack
// is ~7 MB and a garden drawing set ~4–4.4 MB (measured on the G5 packs), so a
// document route may not send its PDF as the response body. Every PDF answer
// goes through here:
//
//   ≤ RESPONSE_INLINE_MAX_BYTES  the bytes, as before;
//   larger                       stored in the PRIVATE `packs` bucket under
//                                downloads/<projectId>/<uuid>/<name> and
//                                answered with a 302 to a signed URL for that
//                                ONE object, valid SIGNED_DOWNLOAD_TTL_S.
//
// The route's own gates (session, membership, the pack-export job guard, the
// identity scan) run BEFORE this, so the redirect is only ever the answer the
// route would have given. Downloads are swept with pending uploads (daily job).
// =============================================================================

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { DOWNLOADS_PREFIX, RESPONSE_INLINE_MAX_BYTES, SIGNED_DOWNLOAD_TTL_S } from "@/lib/uploads/limits";

import { PACK_BUCKET } from "./pack-export/job";

export async function fileResponse(db: SupabaseClient, bytes: Uint8Array, opts: { filename: string; contentType: string; projectId: string }): Promise<NextResponse> {
  if (bytes.byteLength <= RESPONSE_INLINE_MAX_BYTES) {
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: { "Content-Type": opts.contentType, "Content-Disposition": `attachment; filename="${opts.filename}"`, "Cache-Control": "no-store" },
    });
  }
  const path = `${DOWNLOADS_PREFIX}/${opts.projectId}/${randomUUID()}/${opts.filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const up = await db.storage.from(PACK_BUCKET).upload(path, bytes, { contentType: opts.contentType, upsert: false });
  if (up.error) throw new Error(`could not stage the download: ${up.error.message}`);
  const { data, error } = await db.storage.from(PACK_BUCKET).createSignedUrl(path, SIGNED_DOWNLOAD_TTL_S, { download: opts.filename });
  if (error || !data?.signedUrl) throw new Error(`could not sign the download: ${error?.message ?? "no url"}`);
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
