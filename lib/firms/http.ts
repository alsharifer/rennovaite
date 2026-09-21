// Shared plumbing for the firm routes (L1).
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { StoreError } from "./store";

export const UuidSchema = z.string().uuid();

export function firmDb(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

/** A StoreError becomes its own status + code; anything else is a 500. */
export function storeErrorResponse(e: unknown): NextResponse {
  if (e instanceof StoreError) {
    return NextResponse.json({ success: false, error: e.message, code: e.code }, { status: e.status });
  }
  console.error("[api/firms]", e);
  return NextResponse.json(
    { success: false, error: e instanceof Error ? e.message : "Firm operation failed." },
    { status: 500 },
  );
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}
