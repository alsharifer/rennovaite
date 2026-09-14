// =============================================================================
// lib/documents/pack-readiness.ts — may this garden's pack export? (G5)
//
// A pack is what a client reads, so it must not carry an unmade decision dressed
// as a price. It refuses to export while:
//   - a counter run that is NEW work has no type (its line would be
//     needs_selection — the cheaper default of a choice nobody has made);
//   - an existing item placed from the site photos has no keep / remove /
//     replace (it would be in no quantity at all, silently);
//   - the latest BoQ still carries a needs_selection line (the plan was fixed
//     but the BoQ was not regenerated).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadGardenSiteData } from "@/lib/plan/garden-site-data";

export interface PackReadiness {
  ready: boolean;
  untyped_counters: string[];
  undecided: string[];
  stale_boq_needs_selection: string[];
  has_boq: boolean;
}

export function readinessFrom(input: { untypedCounters: string[]; undecided: string[]; boqNeedsSelection: string[] | null }): PackReadiness {
  const stale = input.untypedCounters.length === 0 ? input.boqNeedsSelection ?? [] : [];
  return {
    ready: input.untypedCounters.length === 0 && input.undecided.length === 0 && stale.length === 0 && input.boqNeedsSelection !== null,
    untyped_counters: input.untypedCounters,
    undecided: input.undecided,
    stale_boq_needs_selection: stale,
    has_boq: input.boqNeedsSelection !== null,
  };
}

export function readinessMessage(r: PackReadiness): string {
  const parts: string[] = [];
  if (r.untyped_counters.length) parts.push(`${r.untyped_counters.length} counter run(s) need a type: ${r.untyped_counters.join(", ")}`);
  if (r.undecided.length) parts.push(`${r.undecided.length} existing item(s) need keep / remove / replace: ${r.undecided.slice(0, 6).join(", ")}${r.undecided.length > 6 ? "…" : ""}`);
  if (!r.has_boq) parts.push("no BoQ has been generated yet");
  if (r.stale_boq_needs_selection.length) parts.push("the BoQ still carries an untyped counter — regenerate it");
  return parts.length ? `The pack cannot export yet: ${parts.join("; ")}.` : "Ready to export.";
}

export async function loadPackReadiness(sb: SupabaseClient, projectId: string): Promise<PackReadiness> {
  const { data: plan } = await sb.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  const site = plan ? await loadGardenSiteData(sb, projectId, plan.id) : null;
  const { data: boq } = await sb
    .from("boqs")
    .select("sections")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ sections: { sections?: { lines?: { rate_status?: string; description?: string }[] }[] } | null }>();
  const boqNeedsSelection = boq
    ? (boq.sections?.sections ?? []).flatMap((s) => (s.lines ?? []).filter((l) => l.rate_status === "needs_selection").map((l) => String(l.description ?? "")))
    : null;
  return readinessFrom({
    untypedCounters: site?.untypedCounters ?? [],
    undecided: (site?.items ?? []).filter((i) => i.disposition === null).map((i) => i.name),
    boqNeedsSelection,
  });
}
