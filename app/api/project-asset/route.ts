import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { publicUrlForPath } from "@/lib/assets/load";
import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { uploadErrorResponse } from "@/lib/uploads/http";
import { finishUpload } from "@/lib/uploads/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Uuid = z.string().uuid();

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

// A photo assigned to a room is mirrored into room_photos so the existing
// render pipeline (which reads the latest room_photos row per room) uses it
// with no changes.
async function mirrorRoomPhoto(roomId: string, storagePath: string) {
  const publicUrl = publicUrlForPath(storagePath);
  await db()
    .from("room_photos")
    .insert({ room_id: roomId, storage_path: storagePath, public_url: publicUrl });
}

// POST — register an asset the browser uploaded straight to Storage (H9: POST
// /api/uploads/sign with kind "project_asset", then this). Body: { path, kind
// (the asset kind), source?, room_id?, filename? }. Images are compressed
// client-side first. The checks (real size, magic bytes, the room is this
// project's) and the write are lib/uploads/register.ts — the same pipeline as
// /api/uploads/complete.
export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.path !== "string") return NextResponse.json({ error: "Upload the file first, then send its path.", code: "bad_request" }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  try {
    const fields = { asset_kind: str(body.kind), source: str(body.source), room_id: str(body.room_id), filename: str(body.filename) };
    return NextResponse.json(await finishUpload(db(), caller, body.path, fields, "project_asset"));
  } catch (e) {
    return uploadErrorResponse(e, "api/project-asset");
  }
}

// PATCH — assign an existing photo asset to a room. Body: { asset_id, room_id }.
export async function PATCH(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  try {
    const body = (await request.json().catch(() => null)) as
      | { asset_id?: unknown; room_id?: unknown }
      | null;
    const assetId = Uuid.safeParse(body?.asset_id);
    const roomId = Uuid.safeParse(body?.room_id);
    if (!assetId.success || !roomId.success) {
      return NextResponse.json(
        { error: "A valid asset_id and room_id are required." },
        { status: 400 },
      );
    }
    const access = await projectAccess(db(), caller, { asset_id: assetId.data, room_id: roomId.data });
    if (access.denied) return access.denied;

    const { data: asset, error: getErr } = await db()
      .from("project_assets")
      .select("id, kind, storage_path")
      .eq("id", assetId.data)
      .maybeSingle<{ id: string; kind: string; storage_path: string }>();
    if (getErr) throw getErr;
    if (!asset) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const { error: updErr } = await db()
      .from("project_assets")
      .update({ room_id: roomId.data })
      .eq("id", assetId.data);
    if (updErr) throw updErr;

    // Mirror into room_photos so the render pipeline uses it as the room's photo.
    if (asset.kind === "photo") {
      await mirrorRoomPhoto(roomId.data, asset.storage_path);
    }

    return NextResponse.json({
      asset_id: asset.id,
      room_id: roomId.data,
      public_url: publicUrlForPath(asset.storage_path),
    });
  } catch (err) {
    console.error("[api/project-asset] PATCH error", err);
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Assignment failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
