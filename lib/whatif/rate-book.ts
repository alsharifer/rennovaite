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
    // Rates are SUPERSEDED, not replaced: the ground-truth reseed adds newer
    // rows (newer valid_from) rather than deleting. Read newest-first and keep
    // the first row seen per (item_key, grade) so the latest rate wins while
    // saved what-if scenarios (which key off item_key/grade) keep resolving.
    // `valid_from` may be absent on pre-022 rows → treat as epoch.
    // Newest valid_from wins; ties (same-day seed vs actual) break by
    // provenance — 'actual_transaction' sorts before 'seed' ascending, so an
    // actual-transaction rate supersedes a same-dated seed rate.
    const { data, error } = await supabase
      .from("rate_book")
      .select("item_key, grade, rate_aed, source, qs_validated, valid_from")
      .eq("city", "Dubai")
      .order("valid_from", { ascending: false })
      .order("provenance", { ascending: true });
    if (error || !data) return rb;
    const seen = new Set<string>();
    for (const r of data as {
      item_key: GradeableItem;
      grade: Grade;
      rate_aed: number;
      source: string;
      qs_validated: boolean;
      valid_from: string | null;
    }[]) {
      const key = `${r.item_key}/${r.grade}`;
      if (seen.has(key)) continue; // older superseded row → skip
      const cell = rb[r.item_key]?.[r.grade];
      if (cell) {
        rb[r.item_key][r.grade] = {
          rate_aed: Number(r.rate_aed),
          source: r.source,
          qs_validated: !!r.qs_validated,
          spec: cell.spec, // spec label stays from grades.ts
        };
        seen.add(key);
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
): Promise<{
  selections: Selections;
  total: number | null;
  /** D1: item_key → accessory_catalog id this scenario prices with. */
  accessorySelections: Record<string, string>;
} | null> {
  try {
    const { data, error } = await supabase
      .from("whatif_scenarios")
      .select("selections, total, accessory_selections")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        selections: Selections | null;
        total: number | null;
        accessory_selections: Record<string, string> | null;
      }>();
    if (error || !data) return null;
    return {
      selections: data.selections ?? {},
      total: data.total != null ? Number(data.total) : null,
      accessorySelections: data.accessory_selections ?? {},
    };
  } catch {
    // Pre-028 the accessory_selections column is absent, which makes the whole
    // select fail — fall back to the columns that have always existed so
    // what-if keeps working rather than losing its saved scenario.
    try {
      const { data } = await supabase
        .from("whatif_scenarios")
        .select("selections, total")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ selections: Selections | null; total: number | null }>();
      if (!data) return null;
      return {
        selections: data.selections ?? {},
        total: data.total != null ? Number(data.total) : null,
        accessorySelections: {},
      };
    } catch {
      return null;
    }
  }
}

export async function saveScenario(
  supabase: SupabaseClient,
  projectId: string,
  selections: Selections,
  total: number,
  /** D1: accessory picks this scenario prices with, so a scenario can hold a
   *  different spec set without disturbing the project's own selections. */
  accessorySelections?: Record<string, string>,
): Promise<boolean> {
  try {
    const row: Record<string, unknown> = { project_id: projectId, selections, total };
    if (accessorySelections && Object.keys(accessorySelections).length > 0) {
      row.accessory_selections = accessorySelections;
    }
    const { error } = await supabase.from("whatif_scenarios").insert(row);
    if (!error) return true;
    // Pre-028: retry without the new column rather than losing the scenario.
    if (accessorySelections) {
      const { error: retry } = await supabase
        .from("whatif_scenarios")
        .insert({ project_id: projectId, selections, total });
      return !retry;
    }
    return false;
  } catch {
    return false;
  }
}
