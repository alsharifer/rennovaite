// =============================================================================
// lib/boq/changes-since.ts — "what changed since rev N", in ONE place (K2 review).
//
// The journey rail's 05 BoQ & Review "attention" and K3's Regenerate control
// ("Unchanged — nothing has changed since rev N" / "Ready — 1 book entry
// changed since rev N") must never disagree, so both call
// changesSinceRevision(). It reads the SAME recorded causes the revision diff
// attributes moves to (lib/boq/revision-causes.ts, U4) for the window after the
// latest revision, and counts what can move a regenerated BoQ:
//
//   plan_edit         the plan or a design layer was saved (plan_saved,
//                     design_edit events)
//   scope_change      K12: rooms added to / left out of the renovation (01 Plan)
//   firm_rate         the project's firm's book gained or retired an entry
//   session_decision  a working-session decision was applied
//
// A correction is RECORDED, never applied (L1) — it does not make a BoQ stale.
// "No recorded change ⇒ regenerating leaves the BoQ unchanged" is the runbook
// check (docs/ONBOARDING_RUNBOOK.md step 5); lib/boq/__tests__/changes-since.test.ts
// holds the two together.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadRecordedCauses } from "./revision-causes";
import type { RecordedCause } from "./revision-diff";

export interface UpstreamChanges {
  /** K12: a net change to the rooms in this renovation. */
  scopeChanges: number;
  planEdits: number;
  bookChanges: number;
  decisions: number;
  /** Recorded corrections in the window — shown, never a reason to regenerate. */
  corrections: number;
  /** True when something that moves a regenerated BoQ was recorded. */
  changed: boolean;
  /** "plan edited, 1 book entry changed since rev 4" — null when unchanged. */
  summary: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pure: the recorded causes after a revision → what changed. */
export function summarizeChanges(causes: readonly Pick<RecordedCause, "kind">[], rev: number): UpstreamChanges {
  const count = (k: RecordedCause["kind"]) => causes.filter((c) => c.kind === k).length;
  const scopeChanges = count("scope_change");
  const planEdits = count("plan_edit");
  const bookChanges = count("firm_rate");
  const decisions = count("session_decision");
  const corrections = count("correction");
  const parts: string[] = [];
  if (scopeChanges) parts.push("Scope changed");
  if (planEdits) parts.push("plan edited");
  if (bookChanges) parts.push(`${plural(bookChanges, "book entry", "book entries")} changed`);
  if (decisions) parts.push(`${plural(decisions, "decision")} recorded`);
  const changed = parts.length > 0;
  return { scopeChanges, planEdits, bookChanges, decisions, corrections, changed, summary: changed ? `${parts.join(", ")} since rev ${rev}` : null };
}

/** THE function: what changed after the latest revision, up to `now`. K3's Regenerate calls this. */
export async function changesSinceRevision(db: SupabaseClient, projectId: string, latest: { id: string; created_at: string }, rev: number, now: Date = new Date()): Promise<UpstreamChanges> {
  // toBoqId "" — no later revision exists yet, so no generation event belongs to the window.
  const causes = await loadRecordedCauses(db, projectId, latest.created_at, now.toISOString(), "");
  return summarizeChanges(causes, rev);
}
