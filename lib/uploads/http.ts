// =============================================================================
// lib/uploads/http.ts — the HTTP answers for an upload (H9).
// An upload refusal is ALWAYS { code, kind, error } with 413 / 415 / 400 — one
// shape for every kind (K6's intake inverse block reads exactly this). Auth and
// membership refusals keep the store's shape (401 / 403 / 404 { error, code }).
// =============================================================================

import { NextResponse } from "next/server";

import { StoreError } from "@/lib/store-error";

import { UploadError } from "./server";

export function uploadErrorResponse(e: unknown, where: string): NextResponse {
  if (e instanceof UploadError) return NextResponse.json(e.body, { status: e.status });
  if (e instanceof StoreError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  console.error(`[${where}] upload error`, e);
  const message = e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Upload failed unexpectedly.";
  return NextResponse.json({ error: message, code: "upload_failed" }, { status: 500 });
}
