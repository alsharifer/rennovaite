// lib/pilot/views.ts — a signed-in view of a BoQ, as a pilot event (L5).
//
// The checking signal: when a member opens the BoQ after it was generated. One
// event per actor per project per 10 minutes — a reload is not a second review.
// Best-effort; never throws.

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordPilotEvent } from "./events";

export const VIEW_DEDUPE_MS = 10 * 60 * 1000;

export async function recordBoqView(db: SupabaseClient, projectId: string, boqId: string, actor: string): Promise<void> {
  try {
    const since = new Date(Date.now() - VIEW_DEDUPE_MS).toISOString();
    const { data } = await db.from("pilot_events").select("id").eq("project_id", projectId).eq("kind", "boq_viewed").eq("actor", actor).gte("recorded_at", since).limit(1);
    if (data && data.length > 0) return;
    await recordPilotEvent(db, projectId, "boq_viewed", { boq_id: boqId }, { actor });
  } catch {
    /* a view is never worth an error */
  }
}
