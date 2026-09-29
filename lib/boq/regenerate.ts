// =============================================================================
// lib/boq/regenerate.ts — may this caller regenerate this project's BoQ? (H4)
//
// ONE answer, read by both sides: the generate-boq route enforces it on every
// run that stores a revision, and the BoQ page's Regenerate control shows it
// (disabled, with the reason and the fix, when the answer is no). The two can
// therefore never disagree about why a button is grey.
//
// Who (H5): a MEMBER of the project (lib/projects/access.ts). H4 asked for "the
// project's firm's member, or the project's owner once projects have one";
// with project membership required by every project route, and attaching a
// firm requiring membership of BOTH the firm and the project, that is exactly
// the project's members.
//
// What: the plan must be priceable — the same refusals the assembly answers
// with (lib/boq/assemble.ts → loadPriceablePlan), so a disabled button names
// the exact thing generation would have refused on.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { isProjectMember } from "@/lib/projects/access";

import { loadPriceablePlan } from "./assemble";

export type RegenerateBlockCode = "unauthenticated" | "not_a_project_member" | "project_not_found" | "no_plan" | "no_area" | "no_rooms" | "plan_has_overlaps" | "not_priceable";

export interface RegenerateBlock {
  code: RegenerateBlockCode;
  /** One sentence, shown beside the disabled control. */
  reason: string;
  fix?: { label: string; href: string };
}

export interface RegenerateReadiness {
  ok: boolean;
  /** The first thing standing in the way (null when ok). */
  block: RegenerateBlock | null;
  /** The latest stored revision — the "from" of the diff a regeneration links to. */
  previous: { id: string; total_aed: number; created_at: string } | null;
}

/** Who may store a new revision: the project's members. */
export async function regenerateAuthority(db: SupabaseClient, projectId: string, caller: Caller | null): Promise<RegenerateBlock | null> {
  if (!caller) return { code: "unauthenticated", reason: "Sign in to regenerate the BoQ." };
  const { data, error } = await db.from("projects").select("id").eq("id", projectId).maybeSingle<{ id: string }>();
  if (error) throw new Error(`project read failed: ${error.message}`);
  if (!data) return { code: "project_not_found", reason: "Project not found." };
  if (await isProjectMember(db, projectId, caller.id)) return null;
  return { code: "not_a_project_member", reason: "Only the project's members can regenerate its BoQ." };
}

function planBlock(refusal: { status: number; body: Record<string, unknown> }, projectId: string): RegenerateBlock {
  const code = String(refusal.body.code ?? "not_priceable") as RegenerateBlockCode;
  const toPlan = { label: "Open the plan", href: `/project/${projectId}/plan` };
  switch (code) {
    case "plan_has_overlaps": {
      const n = (refusal.body.overlap_room_names as string[] | undefined)?.length ?? 0;
      return { code, reason: `${n} room${n === 1 ? "" : "s"} on the plan overlap — they would double-count floor and wall area.`, fix: { label: "Fix overlaps on the plan", href: `/project/${projectId}/plan` } };
    }
    case "no_plan":
      return { code, reason: "The project has no plan to price yet.", fix: { label: "Add a plan", href: `/project/${projectId}/plan` } };
    case "no_area":
      return { code, reason: "The plan has no total area, so nothing can be measured.", fix: toPlan };
    case "no_rooms":
      return { code, reason: "The plan has no rooms to price.", fix: toPlan };
    case "project_not_found":
      return { code, reason: "Project not found." };
    default:
      return { code: "not_priceable", reason: String(refusal.body.error ?? "The plan cannot be priced."), fix: toPlan };
  }
}

/** Everything the Regenerate control needs to know before it is pressed. */
export async function regenerateReadiness(db: SupabaseClient, projectId: string, caller: Caller | null): Promise<RegenerateReadiness> {
  const [authority, priceable, prev] = await Promise.all([
    regenerateAuthority(db, projectId, caller),
    loadPriceablePlan(db, projectId),
    db.from("boqs").select("id, total_aed, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; total_aed: number; created_at: string }>(),
  ]);
  const previous = prev.data ? { id: prev.data.id, total_aed: Number(prev.data.total_aed), created_at: prev.data.created_at } : null;
  const block = authority ?? (priceable.refusal ? planBlock(priceable.refusal, projectId) : null);
  return { ok: block === null, block, previous };
}
