import { NextResponse, type NextRequest } from "next/server";

import {
  buildControlImageBase64,
  buildDepthControlImageBase64,
} from "@/lib/control-image";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const roomId = request.nextUrl.searchParams.get("room_id");
    const modeParam = request.nextUrl.searchParams.get("mode") ?? "canny";
    if (!roomId) {
      return NextResponse.json(
        { error: "room_id query parameter is required" },
        { status: 400 },
      );
    }
    if (modeParam !== "canny" && modeParam !== "depth") {
      return NextResponse.json(
        { error: "mode must be 'canny' or 'depth'." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: room, error } = await supabase
      .from("rooms")
      .select("id, name_en, polygon, area_m2")
      .eq("id", roomId)
      .maybeSingle();

    if (error) throw error;
    if (!room) {
      return NextResponse.json(
        { error: `Room ${roomId} not found.` },
        { status: 404 },
      );
    }

    const base64 =
      modeParam === "depth"
        ? await buildDepthControlImageBase64(room)
        : await buildControlImageBase64(room);
    const png = Buffer.from(base64, "base64");

    return new NextResponse(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="control-${modeParam}-${roomId}.png"`,
      },
    });
  } catch (err) {
    console.error("[api/debug/control-image] error", err);
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to build control image.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
