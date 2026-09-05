import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { findOverlaps } from "@/lib/plan/overlaps";
import { ensureAsBuiltSnapshot } from "@/lib/plan/snapshots";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RoomPayloadSchema = z.object({
  id: z.string().uuid(),
  name_en: z.string().min(1).max(200),
  name_ar: z.string().nullable(),
  room_type: z.string().nullable(),
  area_m2: z.number().nonnegative(),
  polygon: z.array(z.array(z.number())).min(3),
});

const BodySchema = z.object({
  plan_id: z.string().uuid(),
  rooms: z.array(RoomPayloadSchema),
  deleted_ids: z.array(z.string().uuid()).default([]),
});

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.message },
        { status: 400 },
      );
    }
    const { plan_id, rooms, deleted_ids } = parsed.data;

    const supabase = getSupabaseAdmin();

    if (deleted_ids.length > 0) {
      const { error: delErr } = await supabase
        .from("rooms")
        .delete()
        .in("id", deleted_ids)
        .eq("plan_id", plan_id);
      if (delErr) throw delErr;
    }

    if (rooms.length > 0) {
      const upsertRows = rooms.map((r) => ({
        id: r.id,
        plan_id,
        name_en: r.name_en,
        name_ar: r.name_ar,
        room_type: r.room_type,
        area_m2: r.area_m2,
        polygon: r.polygon,
      }));
      const { error: upErr } = await supabase
        .from("rooms")
        .upsert(upsertRows, { onConflict: "id" });
      if (upErr) throw upErr;
    }

    const total = rooms.reduce((sum, r) => sum + r.area_m2, 0);
    const totalRounded = Math.round(total * 10) / 10;

    // D3: the save ALWAYS succeeds. Overlapping rooms are a legitimate
    // transient state while editing — refusing the write would leave unsaved
    // work one refresh from being lost, and a 400 after the click is the same
    // failure with extra steps. So we record what we saw instead, and BoQ
    // generation is where the invariant is actually enforced, because that is
    // where overlaps do their damage (double-counted floor and wall area).
    const overlaps = findOverlaps(
      rooms.map((r) => ({ id: r.id, name: r.name_en, polygon: r.polygon })),
    );

    const { error: planErr } = await supabase
      .from("plans")
      .update({ total_area_m2: totalRounded })
      .eq("id", plan_id);
    if (planErr) throw planErr;

    // Separate best-effort write: migration 029 may not be applied yet, and a
    // missing column must never cost the user their save.
    try {
      await (supabase as unknown as SupabaseClient)
        .from("plans")
        .update({
          has_overlaps: overlaps.has_overlaps,
          overlap_pairs: overlaps.pairs,
          overlaps_checked_at: new Date().toISOString(),
        })
        .eq("id", plan_id);
    } catch {
      /* pre-029 — generation assesses overlaps live instead */
    }

    // Parse-confirm → persist the as-built plan_snapshot once (P1). Idempotent
    // (write-if-absent), flagged, and best-effort so it never blocks the save.
    if (process.env.DRAWINGS_ENABLED === "true") {
      try {
        const { data: planRow } = await supabase
          .from("plans")
          .select("project_id")
          .eq("id", plan_id)
          .maybeSingle();
        if (planRow?.project_id) await ensureAsBuiltSnapshot(planRow.project_id);
      } catch (snapErr) {
        console.warn(
          "[api/update-plan] as-built snapshot skipped:",
          snapErr instanceof Error ? snapErr.message : snapErr,
        );
      }
    }

    return NextResponse.json({
      success: true,
      total_area_m2: totalRounded,
      room_count: rooms.length,
      // The save succeeded either way; this tells the editor what to show.
      has_overlaps: overlaps.has_overlaps,
      overlap_pairs: overlaps.pairs,
    });
  } catch (err) {
    console.error("[api/update-plan] error", err);
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to save plan.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
