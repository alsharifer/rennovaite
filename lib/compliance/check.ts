// =============================================================================
// lib/compliance/check.ts — server-side permit check (P6).
//
// Loads the as-built + proposed plan snapshots + fixtures, computes the diff,
// evaluates the Dubai permit triggers, and persists the fired list to
// permit_checks so the concierge sees the same checklist. Best-effort
// persistence (table may not be applied yet).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlanFixture } from "@/lib/overlays/types";
import { derivePlanGraph } from "@/lib/plan/derive";
import type { PlanGraph } from "@/lib/plan/geometry";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { resolveCommunity, type CommunityAuthority } from "./authorities";
import { computePlanDiff } from "./diff";
import { evaluatePermits, type FiredRule } from "./dubai-triggers";

export interface PermitCheckResult {
  fired: FiredRule[];
  community: CommunityAuthority;
  hasProposed: boolean;
}

async function latestSnapshot(
  sb: SupabaseClient,
  projectId: string,
  kind: "as_built" | "proposed",
): Promise<{ id: string; graph: PlanGraph } | null> {
  try {
    const { data, error } = await sb
      .from("plan_snapshots")
      .select("id, graph")
      .eq("project_id", projectId)
      .eq("kind", kind)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; graph: PlanGraph }>();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

export async function runPermitCheck(projectId: string): Promise<PermitCheckResult> {
  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  const asBuiltSnap = await latestSnapshot(sb, projectId, "as_built");
  const proposedSnap = await latestSnapshot(sb, projectId, "proposed");
  const asBuilt = asBuiltSnap?.graph ?? (await derivePlanGraph(projectId));
  const proposed = proposedSnap?.graph ?? null;

  const diff = computePlanDiff(asBuilt, proposed);

  const { data: project } = await supabase
    .from("projects")
    .select("name, city")
    .eq("id", projectId)
    .maybeSingle();
  const community = resolveCommunity({ name: project?.name, city: project?.city });

  let fixtures: PlanFixture[] = [];
  try {
    const { data } = await sb
      .from("plan_fixtures")
      .select("id, layer, type, room_id, position, wall_id, spec, source")
      .eq("project_id", projectId);
    fixtures = (data ?? []) as PlanFixture[];
  } catch {
    /* plan_fixtures absent → no fixture-based rules */
  }

  const fired = evaluatePermits(diff, proposed ?? asBuilt, fixtures, community);

  // Persist (best-effort) so the concierge team sees the same list.
  try {
    await sb.from("permit_checks").insert({
      project_id: projectId,
      plan_snapshot_id: proposedSnap?.id ?? asBuiltSnap?.id ?? null,
      fired,
    });
  } catch {
    /* permit_checks table absent → skip */
  }

  return { fired, community, hasProposed: diff.hasProposed };
}
