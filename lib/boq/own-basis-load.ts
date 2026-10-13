// =============================================================================
// lib/boq/own-basis-load.ts — a project's applied, un-reverted corrections
// (K11 #4, migration 057): what every regeneration re-applies
// (lib/boq/assemble.ts) and what an application lays over the latest revision
// (lib/boq/apply-correction.ts). [] before 057. Reads no flag.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingSchema } from "@/lib/rates/firm";

import type { AppliedCorrection } from "./own-basis";
import type { BasisKind } from "./own-basis-vocab";

type Row = Record<string, unknown>;

export const toApplied = (r: Row): AppliedCorrection => ({
  id: String(r.id),
  type: r.correction_type === "quantity" ? "quantity" : "rate",
  lineKey: String(r.line_key),
  value: Number(r.new_value),
  origin: r.origin === "add_price" ? "add_price" : "correction",
  basisKind: (r.basis_kind as BasisKind | null) ?? null,
  note: (r.note as string | null) ?? null,
  byName: (r.applied_by_name as string | null) ?? null,
  appliedAt: String(r.applied_at),
  label: (r.line_description as string | null) ?? null,
});

/** The project's applied, un-reverted corrections — [] before 057. */
export async function loadAppliedCorrections(db: SupabaseClient, projectId: string): Promise<AppliedCorrection[]> {
  try {
    const { data, error } = await db
      .from("boq_corrections")
      .select("id, correction_type, line_key, new_value, origin, basis_kind, note, applied_by_name, applied_at, applied_boq_id, reverted_at, line_description")
      .eq("project_id", projectId)
      .not("applied_boq_id", "is", null)
      .is("reverted_at", null);
    if (error) {
      if (isMissingSchema(error)) return [];
      throw new Error(`boq_corrections read failed: ${error.message}`);
    }
    return ((data ?? []) as Row[]).filter((r) => r.line_key && r.new_value != null && r.applied_at).map(toApplied);
  } catch (e) {
    if (isMissingSchema(e as { code?: string; message?: string })) return [];
    throw e;
  }
}
