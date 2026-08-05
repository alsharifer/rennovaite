import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ASSET_BUCKET, assetStoragePath, publicUrlForPath } from "@/lib/assets/load";
import {
  assetExtension,
  isAssetKind,
  isAssetSource,
  MAX_ASSET_BYTES,
  validateAssetFile,
  type AssetKind,
} from "@/lib/assets/types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

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

// POST — create an asset from a multipart upload. Fields: file, project_id,
// kind, source?, room_id?. Images should be compressed client-side first.
export async function POST(request: NextRequest) {
  let uploadedPath: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    const projectId = z.string().uuid().safeParse(form.get("project_id"));
    const kindRaw = form.get("kind");
    const sourceRaw = form.get("source");
    const roomIdRaw = form.get("room_id");

    if (!projectId.success) {
      return NextResponse.json({ error: "A valid project_id is required." }, { status: 400 });
    }
    if (!isAssetKind(kindRaw)) {
      return NextResponse.json({ error: "A valid asset kind is required." }, { status: 400 });
    }
    const kind = kindRaw as AssetKind;
    const source = isAssetSource(sourceRaw) ? sourceRaw : null;
    const roomId =
      typeof roomIdRaw === "string" && Uuid.safeParse(roomIdRaw).success ? roomIdRaw : null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    const check = validateAssetFile(kind, file.type, file.name);
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }
    if (file.size > MAX_ASSET_BYTES) {
      return NextResponse.json(
        {
          error: "This file is too large to upload. Please keep files under 25 MB.",
          code: "payload_too_large",
        },
        { status: 413 },
      );
    }

    // Confirm the project exists before writing anything.
    const { data: project, error: projErr } = await db()
      .from("projects")
      .select("id")
      .eq("id", projectId.data)
      .maybeSingle();
    if (projErr) throw projErr;
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const path = assetStoragePath(
      projectId.data,
      crypto.randomUUID(),
      assetExtension(file.type, file.name),
    );
    const bytes = await file.arrayBuffer();
    const { error: uploadErr } = await db()
      .storage.from(ASSET_BUCKET)
      .upload(path, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadErr) throw uploadErr;
    uploadedPath = path;

    const { data: row, error: insertErr } = await db()
      .from("project_assets")
      .insert({
        project_id: projectId.data,
        kind,
        room_id: kind === "photo" ? roomId : null,
        storage_path: path,
        filename: file.name,
        mime: file.type || null,
        bytes: file.size,
        source,
      })
      .select("id")
      .single();
    if (insertErr || !row) {
      throw insertErr ?? new Error("Failed to save asset row.");
    }

    // Newly uploaded photo already targeted at a room → make it active.
    if (kind === "photo" && roomId) {
      await mirrorRoomPhoto(roomId, path);
    }

    return NextResponse.json({
      asset_id: row.id,
      kind,
      room_id: kind === "photo" ? roomId : null,
      public_url: publicUrlForPath(path),
    });
  } catch (err) {
    console.error("[api/project-asset] POST error", err);
    if (uploadedPath) {
      await db().storage.from(ASSET_BUCKET).remove([uploadedPath]);
    }
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Upload failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH — assign an existing photo asset to a room. Body: { asset_id, room_id }.
export async function PATCH(request: NextRequest) {
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
