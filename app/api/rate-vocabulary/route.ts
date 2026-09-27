import { NextResponse, type NextRequest } from "next/server";

import { getCaller } from "@/lib/auth/caller";
import { listVocabulary } from "@/lib/firms/vocabulary";
import type { VocabularyItem } from "@/lib/firms/vocabulary-client";
import { indexReference, loadReferenceRows, lookupCalibrated, lookupIndicative } from "@/lib/rates/reference";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// U2 — GET /api/rate-vocabulary
//
// Every item_key a firm may price, with label, unit, section, the kinds it
// accepts, and what a firm entry for it SHADOWS: the market-reference rate where
// the resolver would actually read one (tier 3 — the garden keys, from
// `rate_book` through REFERENCE_COLUMNS, so no source or contractor identity is
// in the payload), or the built-in interior pricing it falls through to
// otherwise. The take-off vocabulary stops living only in code. Signed-in
// callers only: the rate figures are the ones every BoQ already shows, but the
// page this serves is a firm's, and nothing on it should answer an anonymous
// call.

export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return NextResponse.json({ success: false, error: "Sign in to read the vocabulary.", code: "unauthenticated" }, { status: 401 });

  const base = listVocabulary();
  let idx = indexReference([]);
  try {
    idx = indexReference(await loadReferenceRows(getSupabaseAdmin() as never));
  } catch (e) {
    console.warn("[api/rate-vocabulary] reference book unavailable — items carry no market rate:", e instanceof Error ? e.message : e);
  }
  const items: VocabularyItem[] = base.map((v) => {
    if (v.path === "garden") {
      // The garden take-off prices from the reference book at the standard
      // grade (it has one grade); the same row the BoQ line would carry.
      const row = lookupCalibrated(idx, v.item_key, "standard") ?? lookupIndicative(idx, v.item_key, "standard");
      return {
        ...v,
        reference: row
          ? { kind: "market", rate_aed: Number(row.rate_aed), unit: row.unit, grade: row.grade ?? null, provenance: row.provenance }
          : { kind: "none" },
      };
    }
    return { ...v, reference: { kind: "builtin", how: v.builtin ?? "catalog" } };
  });
  return NextResponse.json({ success: true, items, count: items.length });
}
