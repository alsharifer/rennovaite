// =============================================================================
// lib/overlays/boq-feed.ts — merge overlay sections into a generated BoQ (P2).
//
// Called from app/api/generate-boq for BOTH the deterministic-engine path and
// the legacy LLM path. Fixture COUNTS become the line quantities (never the
// LLM). Flagged by OVERLAYS_ENABLED and fully best-effort: if the flag is off,
// the plan_fixtures table is absent, or there are no fixtures, the BoQ is
// returned byte-identical to today. Existing sections / zod / KG are untouched.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildOverlaySections } from "./boq";
import { POMI_ELECTRICAL, POMI_PLUMBING } from "./catalog";
import type { FixtureType } from "./types";

interface BoqSectionLike {
  work_section: string;
  lines: unknown[];
  section_total_aed: number;
}

interface BoqLike {
  sections: BoqSectionLike[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
}

/**
 * Append the Electrical Installations + Plumbing & Sanitary sections (computed
 * from plan_fixtures counts) and recompute the contingency/VAT/grand-total
 * chain. Returns the same object shape it was given.
 */
export async function appendOverlaySections<T extends BoqLike>(
  boq: T,
  projectId: string,
  supabase: SupabaseClient,
): Promise<T> {
  if (process.env.OVERLAYS_ENABLED !== "true") return boq;

  let fixtures: { id: string; type: FixtureType }[] = [];
  try {
    const { data, error } = await supabase
      .from("plan_fixtures")
      .select("id, type")
      .eq("project_id", projectId);
    if (error || !data) return boq; // table missing / error → no-op
    fixtures = data as { id: string; type: FixtureType }[];
  } catch {
    return boq;
  }
  if (fixtures.length === 0) return boq;

  const overlay = buildOverlaySections(fixtures);
  if (overlay.length === 0) return boq;

  // Idempotent: drop any prior overlay sections before appending fresh ones.
  const kept = boq.sections.filter(
    (s) => s.work_section !== POMI_ELECTRICAL && s.work_section !== POMI_PLUMBING,
  );
  const sections = [...kept, ...(overlay as unknown as BoqSectionLike[])];

  const subtotal_aed = sections.reduce((s, x) => s + x.section_total_aed, 0);
  const contingency_aed = Math.round((subtotal_aed * boq.contingency_pct) / 100);
  const vat_aed = Math.round(((subtotal_aed + contingency_aed) * boq.vat_pct) / 100);

  return {
    ...boq,
    sections,
    subtotal_aed,
    contingency_aed,
    vat_aed,
    grand_total_aed: subtotal_aed + contingency_aed + vat_aed,
  } as T;
}
