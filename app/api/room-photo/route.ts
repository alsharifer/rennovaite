import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reuse the existing bucket the plan uploader writes to. Room photos live under
// a per-project/room prefix so they're easy to browse and cascade-clean.
const BUCKET = "plan-uploads";
const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

const RoomIdSchema = z.string().uuid();

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  return "bin";
}

export async function POST(request: NextRequest) {
  let uploadedPath: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    const roomIdRaw = form.get("room_id");

    const parsedRoomId = RoomIdSchema.safeParse(roomIdRaw);
    if (!parsedRoomId.success) {
      return NextResponse.json(
        { error: "A valid room_id (uuid) is required." },
        { status: 400 },
      );
    }
    const roomId = parsedRoomId.data;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a PNG or JPG." },
        { status: 400 },
      );
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File is larger than 20 MB." },
        { status: 400 },
      );
    }

    // Resolve the owning project (room → plan → project) for the storage path
    // and to 404 on an unknown room before we write anything.
    const { data: room, error: roomErr } = await supabaseAdmin
      .from("rooms")
      .select("id, plan_id, plans(project_id)")
      .eq("id", roomId)
      .maybeSingle<{
        id: string;
        plan_id: string | null;
        plans: { project_id: string | null } | null;
      }>();
    if (roomErr) throw roomErr;
    const projectId = room?.plans?.project_id ?? null;
    if (!room || !projectId) {
      return NextResponse.json(
        { error: "Room not found (or it has no project)." },
        { status: 404 },
      );
    }

    const path = `${projectId}/rooms/${roomId}/${crypto.randomUUID()}.${extensionFor(file)}`;
    const bytes = await file.arrayBuffer();

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadErr) throw uploadErr;
    uploadedPath = path;

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

    const { data: row, error: insertErr } = await supabaseAdmin
      .from("room_photos")
      .insert({ room_id: roomId, storage_path: path, public_url: publicUrl })
      .select("id")
      .single();
    if (insertErr || !row) {
      throw insertErr ?? new Error("Failed to save room photo row.");
    }

    return NextResponse.json({
      room_photo_id: row.id,
      room_id: roomId,
      public_url: publicUrl,
      storage_path: path,
    });
  } catch (err) {
    console.error("[api/room-photo] error", err);
    // Roll back the uploaded object if the DB insert (or anything after) failed.
    if (uploadedPath) {
      await supabaseAdmin.storage.from(BUCKET).remove([uploadedPath]);
    }
    // Supabase throws plain objects with `.message`, not Error instances.
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Upload failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
