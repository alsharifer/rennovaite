// =============================================================================
// lib/whatif/rate-book.ts — server-side rate book + scenario persistence (P5).
//
// loadRateBook reads the QS rate_book table (migration 018) and falls back to
// the grade specs (lib/whatif/grades.ts) for any missing entry — so what-if
// works before the seed runs, and picks up the QS-validated rates once it has.
// Scenarios persist to whatif_scenarios (migration 019). All best-effort.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { defaultRateBook, type RateBook, type Selections } from "./engine";
import { type Grade, type GradeableItem } from "./grades";

export async function loadRateBook(supabase: SupabaseClient): Promise<RateBook> {
  const rb = defaultRateBook();
  try {
    const { data, error } = await supabase
      .from("rate_book")
      .select("item_key, grade, rate_aed, source, qs_validated")
      .eq("city", "Dubai");
    if (error || !data) return rb;
    for (const r of data as {
      item_key: GradeableItem;
      grade: Grade;
      rate_aed: number;
      source: string;
      qs_validated: boolean;
    }[]) {
      const cell = rb[r.item_key]?.[r.grade];
      if (cell) {
        rb[r.item_key][r.grade] = {
          rate_aed: Number(r.rate_aed),
          source: r.source,
          qs_validated: !!r.qs_validated,
          spec: cell.spec, // spec label stays from grades.ts
        };
      }
    }
  } catch {
    /* table absent → defaults */
  }
  return rb;
}

export async function loadLatestScenario(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ selections: Selections; total: number | null } | null> {
  try {
    const { data, error } = await supabase
      .from("whatif_scenarios")
      .select("selections, total")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ selections: Selections | null; total: number | null }>();
    if (error || !data) return null;
    return { selections: data.selections ?? {}, total: data.total != null ? Number(data.total) : null };
  } catch {
    return null;
  }
}

export async function saveScenario(
  supabase: SupabaseClient,
  projectId: string,
  selections: Selections,
  total: number,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("whatif_scenarios")
      .insert({ project_id: projectId, selections, total });
    return !error;
  } catch {
    return false;
  }
}
