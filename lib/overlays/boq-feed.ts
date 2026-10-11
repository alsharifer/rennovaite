// =============================================================================
// lib/overlays/boq-feed.ts — merge overlay sections into a generated BoQ (P2).
//
// Called from app/api/generate-boq for BOTH the deterministic-engine path and
// the legacy LLM path. Fixture COUNTS become the line quantities (never the
// LLM). Best-effort: if the plan_fixtures table is absent or there are no
// fixtures, the BoQ is returned byte-identical. Existing sections / zod / KG
// are untouched.
//
// H3: NOT flag-gated. This used to return early when OVERLAYS_ENABLED was off,
// so a flag-off deployment silently dropped Electrical Installations and
// Plumbing & Sanitary from every BoQ that had fixtures (Mudon: ~AED 8,380 +
// ~6,440). The flag now gates only the overlay layer UI, its rule seeding and
// the services drawing sheets; the fixtures a project has are priced always.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { rechain, type ChainedDoc } from "@/lib/boq/totals";

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
  // H7: canonical order, section totals, subtotal and chain — all by rechain.
  return rechain({ ...boq, sections: [...kept, ...(overlay as unknown as BoqSectionLike[])] } as unknown as ChainedDoc) as unknown as T;
}
