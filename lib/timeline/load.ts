// =============================================================================
// lib/timeline/load.ts — a project's programme, server-side (C4).
//
// THE programme is `programmeOf` (lib/timeline/programme.ts) over the project's
// LATEST stored BoQ — the same function the BoQ page, the BoQ PDF, the
// proposal, the room pack and the hub call, so every surface prints one number.
// Re-derived on every read; nothing is cached or stored. (The villa phase model
// and the value-scaled garden programme are retired — see programme.ts.)
// =============================================================================

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { programmeOf, type Programme } from "./programme";

export interface TimelineData {
  /** The project's programme from its latest BoQ, or null with `blocked` saying why. */
  programme: Programme | null;
  /** Why there is no programme yet, when there isn't one. */
  blocked: string | null;
  boqTotalAed: number | null;
}

export async function loadTimeline(projectId: string): Promise<TimelineData> {
  const supabase = getSupabaseAdmin();
  try {
    const { data: plans } = await supabase.from("plans").select("id").eq("project_id", projectId).limit(1);
    if (!plans?.length) return { programme: null, blocked: "Confirm the plan first — the programme is derived from its quantities.", boqTotalAed: null };
    const { data: boqRows } = await supabase.from("boqs").select("total_aed, sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1);
    const boqRow = boqRows?.[0];
    if (!boqRow?.sections) return { programme: null, blocked: "Generate the bill of quantities first — the programme is derived from its quantities.", boqTotalAed: null };
    const programme = programmeOf(boqRow.sections as never);
    return {
      programme,
      blocked: programme ? null : "This bill of quantities has no work to programme yet.",
      boqTotalAed: boqRow.total_aed != null ? Number(boqRow.total_aed) : null,
    };
  } catch (e) {
    console.warn("[timeline/load] failed:", e instanceof Error ? e.message : e);
    return { programme: null, blocked: "Couldn't read the plan or the BoQ for this project.", boqTotalAed: null };
  }
}
