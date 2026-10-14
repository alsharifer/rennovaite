// =============================================================================
// lib/plan/scope-load.ts — the rooms NOT in this renovation, read from the
// project's latest plan (K12, migration 058). SERVER-SIDE, best-effort: before
// 058, or on any read error, nothing is out of scope (every room priced, as
// before). Reads no flag (it sits in the pricing graph — flag-invariance).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

/** Room ids on the project's latest plan with in_scope = false. */
export async function outOfScopeRoomIds(db: SupabaseClient, projectId: string): Promise<Set<string>> {
  try {
    const { data: plan, error: planErr } = await db.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
    if (planErr || !plan) return new Set();
    const { data, error } = await db.from("rooms").select("id").eq("plan_id", plan.id).eq("in_scope", false).returns<{ id: string }[]>();
    if (error) return new Set();
    return new Set((data ?? []).map((r) => r.id));
  } catch {
    return new Set();
  }
}
