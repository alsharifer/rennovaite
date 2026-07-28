// =============================================================================
// lib/plan/snapshots.ts — server-only PlanGraph snapshot helpers (P1).
//
// as-built: written once at parse-confirm. proposed: written on design lock.
// Both are BEST-EFFORT — if the plan_snapshots table (migration 013) isn't
// applied yet, these no-op gracefully so nothing in the existing flow breaks.
// This module never touches EditablePlanViewer or the parse pipeline.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { derivePlanGraph } from "./derive";
import type { PlanGraph } from "./geometry";

type SnapshotKind = "as_built" | "proposed";

function untyped(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

async function latestSnapshot(
  projectId: string,
  kind: SnapshotKind,
): Promise<{ id: string; graph: PlanGraph } | null> {
  try {
    const { data, error } = await untyped()
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

/**
 * Ensure an as-built snapshot exists, deriving + persisting one on first call
 * (idempotent). Returns the live derived graph regardless of persistence.
 */
export async function ensureAsBuiltSnapshot(projectId: string): Promise<PlanGraph> {
  const graph = await derivePlanGraph(projectId);
  const existing = await latestSnapshot(projectId, "as_built");
  if (!existing) {
    try {
      await untyped()
        .from("plan_snapshots")
        .insert({ project_id: projectId, kind: "as_built", graph });
    } catch {
      // table not present yet — best-effort, ignore.
    }
  }
  return graph;
}

/**
 * Write a proposed snapshot from the current derived geometry (called on design
 * lock). Returns the graph, or null if persistence failed.
 */
export async function writeProposedSnapshot(
  projectId: string,
  graph?: PlanGraph,
): Promise<PlanGraph | null> {
  const g = graph ?? (await derivePlanGraph(projectId));
  try {
    const { error } = await untyped()
      .from("plan_snapshots")
      .insert({ project_id: projectId, kind: "proposed", graph: g });
    if (error) return null;
    return g;
  } catch {
    return null;
  }
}

export async function getProposedGraph(projectId: string): Promise<PlanGraph | null> {
  const snap = await latestSnapshot(projectId, "proposed");
  return snap?.graph ?? null;
}
