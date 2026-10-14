// =============================================================================
// lib/timeline/load.ts — assemble a project's phase plan (D2), server-side.
//
// Re-derives on every read from the project's current take-off and its LATEST
// BoQ, so an accessory pick that moves the Sanitaryware or Joinery total moves
// the fit-out phase the next time the timeline is opened. Nothing is cached and
// nothing is persisted: the plan is a view of the BoQ, not a second record of
// it that could drift.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_FLOORING,
  DEFAULT_TIER,
  STYLE_FLOORING,
  STYLE_TIER,
} from "@/lib/boq/rules";
import type { EngineRoom } from "@/lib/boq/schema";
import { computeTakeoff } from "@/lib/boq/takeoff";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { computeDrivers, sectionTotalsFromBoq } from "./drivers";
import { estimateTimeline, type TimelineEstimate } from "./estimate";
import { outOfScopeRoomIds } from "@/lib/plan/scope-load";
import { gardenTimeline, isGardenProject, type GardenTimeline } from "./garden";

const WET_ROOM_TYPES = new Set(["bathroom", "ensuite", "powder", "kitchen"]);

export interface TimelineData {
  /** The INTERIOR phase model — null on a garden project (K9), which has `garden` instead. */
  estimate: TimelineEstimate | null;
  /** K9: a garden project's timeline = its BoQ's indicative programme (lib/timeline/garden.ts). */
  garden: GardenTimeline | null;
  /** Why there is no plan yet, when there isn't one. */
  blocked: string | null;
  drivers: ReturnType<typeof computeDrivers> | null;
  boqTotalAed: number | null;
}

export async function loadTimeline(projectId: string): Promise<TimelineData> {
  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  try {
    const { data: plans } = await supabase
      .from("plans")
      .select("id, total_area_m2")
      .eq("project_id", projectId);
    const planIds = (plans ?? []).map((p) => p.id);
    if (planIds.length === 0) {
      return {
        estimate: null,
        garden: null,
        blocked: "Confirm the plan first — the phase durations scale off its quantities.",
        drivers: null,
        boqTotalAed: null,
      };
    }

    const [{ data: rooms }, { data: boqRows }, { data: styleRows }] = await Promise.all([
      supabase
        .from("rooms")
        .select("id, name_en, room_type, area_m2, polygon")
        .in("plan_id", planIds),
      supabase
        .from("boqs")
        .select("total_aed, sections, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1),
      sb
        .from("style_choices")
        .select("style_key")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const boqRow = boqRows?.[0];
    if (!boqRow?.sections) {
      return {
        estimate: null,
        garden: null,
        blocked:
          "Generate the bill of quantities first — which phases apply is decided by which work sections carry value.",
        drivers: null,
        boqTotalAed: null,
      };
    }

    // K9 (K8 review ruling 3): a garden project never takes the interior model.
    if (isGardenProject((rooms ?? []).map((r) => r.room_type))) {
      const garden = gardenTimeline(boqRow.sections as never);
      return {
        estimate: null,
        garden,
        blocked: garden ? null : "This bill of quantities has no garden work to programme yet.",
        drivers: null,
        boqTotalAed: boqRow.total_aed != null ? Number(boqRow.total_aed) : null,
      };
    }

    const styleKey =
      (styleRows as { style_key: string | null }[] | null)?.[0]?.style_key ?? null;
    const flooring = (styleKey && STYLE_FLOORING[styleKey]) || DEFAULT_FLOORING;
    void ((styleKey && STYLE_TIER[styleKey]) || DEFAULT_TIER);

    // K12 (058): the timeline schedules only the rooms in this renovation — on every visit,
    // so a scope change shows here at once (the cost follows on the next regenerate).
    const outOfScope = await outOfScopeRoomIds(sb, projectId);
    const engineRooms: EngineRoom[] = (rooms ?? []).filter((r) => !outOfScope.has(r.id)).map((r) => ({
      id: r.id,
      name: r.name_en ?? "(unnamed)",
      room_type: r.room_type ?? "other",
      area_m2: r.area_m2 ?? 0,
      polygon: Array.isArray(r.polygon) ? (r.polygon as unknown as number[][]) : null,
    }));

    const takeoff = computeTakeoff(engineRooms, flooring);
    const sectionTotals = sectionTotalsFromBoq(
      boqRow.sections as unknown as {
        sections: { work_section: string; section_total_aed: number }[];
      },
    );

    const drivers = computeDrivers({
      takeoffItems: takeoff.items,
      sectionTotals,
      totalAreaM2: takeoff.summary.totalAreaM2,
      wetRooms: engineRooms.filter((r) => WET_ROOM_TYPES.has(r.room_type)).length,
    });

    return {
      estimate: estimateTimeline({ drivers, sectionTotals }),
      garden: null,
      blocked: null,
      drivers,
      boqTotalAed: boqRow.total_aed != null ? Number(boqRow.total_aed) : null,
    };
  } catch (e) {
    console.warn("[timeline/load] failed:", e instanceof Error ? e.message : e);
    return {
      estimate: null,
      garden: null,
      blocked: "Couldn't read the plan or the BoQ for this project.",
      drivers: null,
      boqTotalAed: null,
    };
  }
}
