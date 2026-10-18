import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { fileResponse } from "@/lib/documents/file-response";
import { guardDocumentRoute, packJobActor } from "@/lib/documents/pack-export/guard";
import { generateRoomPack, RoomPackError } from "@/lib/documents/room-pack-pdf";
import { recordPilotEvent } from "@/lib/pilot/events";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const IdSchema = z.string().uuid();

/**
 * B6 — GET /api/projects/:id/room-pack: one room's client pack (cover, the room
 * with its photos, a page per view, the drawings, materials, BoQ, price with
 * options, programme) as an A3 PDF.
 *   ?format=json   → what the pack contains, no PDF body
 *   ?format=pages  → the page SVGs as printed, and where each photograph sits
 * Gated with the drawing set (DRAWINGS_ENABLED); served only to a running pack
 * export job, like every document (T5).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  if (process.env.DRAWINGS_ENABLED !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = IdSchema.safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(sb, caller, { project_id: parsed.data });
  if (access.denied) return access.denied;
  const denied = await guardDocumentRoute(request, parsed.data);
  if (denied) return denied;
  try {
    const format = new URL(request.url).searchParams.get("format");
    const { pdf, summary, pageSvgs, pageImages } = await generateRoomPack(parsed.data);
    if (format === "pages") return NextResponse.json({ pages: pageSvgs, images: pageImages, summary });
    if (format === "json") return NextResponse.json({ ...summary, bytes: pdf.byteLength });
    await recordPilotEvent(sb, parsed.data, "pack_exported", { document: "room_pack", pages: summary.pages.length, boq_id: summary.boq_id }, { actor: await packJobActor(request) });
    return fileResponse(sb, new Uint8Array(pdf), { filename: `room-pack-${parsed.data.slice(0, 8)}.pdf`, contentType: "application/pdf", projectId: parsed.data });
  } catch (err) {
    if (err instanceof RoomPackError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    console.error("[api/room-pack] error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Room pack failed." }, { status: 500 });
  }
}
