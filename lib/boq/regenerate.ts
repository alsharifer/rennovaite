// =============================================================================
// lib/boq/regenerate.ts — may this caller regenerate this project's BoQ? (H4)
//
// ONE answer, read by both sides: the generate-boq route enforces it on every
// run that stores a revision, and the BoQ page's Regenerate control shows it
// (disabled, with the reason and the fix, when the answer is no). The two can
// therefore never disagree about why a button is grey.
//
// Who: a project WITH a firm is that firm's to price — a signed-in member of it
// (requireFirm: 401 / 404 / 403, the order every firm surface answers in). A
// project with no firm: any signed-in account, as approvals already decide.
// TODO(H5): or the project's owner, once projects have one.
//
// What: the plan must be priceable — the same refusals the assembly answers
// with (lib/boq/assemble.ts → loadPriceablePlan), so a disabled button names
// the exact thing generation would have refused on.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { StoreError, requireFirm } from "@/lib/firms/store";

import { loadPriceablePlan } from "./assemble";

export type RegenerateBlockCode = "unauthenticated" | "not_a_member" | "project_not_found" | "no_plan" | "no_area" | "no_rooms" | "plan_has_overlaps" | "not_priceable";

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

/** Who may store a new revision: the firm's members on a firm project, anyone signed in otherwise. */
export async function regenerateAuthority(db: SupabaseClient, projectId: string, caller: Caller | null): Promise<RegenerateBlock | null> {
  if (!caller) return { code: "unauthenticated", reason: "Sign in to regenerate the BoQ." };
  const { data, error } = await db.from("projects").select("id, firm_id").eq("id", projectId).maybeSingle<{ id: string; firm_id: string | null }>();
  if (error) throw new Error(`project read failed: ${error.message}`);
  if (!data) return { code: "project_not_found", reason: "Project not found." };
  if (!data.firm_id) return null;
  try {
    await requireFirm(db, data.firm_id, caller);
    return null;
  } catch (e) {
    if (e instanceof StoreError && e.status === 403) {
      return { code: "not_a_member", reason: "This project is priced by a firm you are not a member of — only its members can regenerate the BoQ." };
    }
    if (e instanceof StoreError && e.status === 404) return null; // the firm is gone; the project is nobody's to guard
    throw e;
  }
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
