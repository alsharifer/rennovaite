// =============================================================================
// lib/boq/approvals.ts — the approval trail of a project's BoQ revisions (U4 / L3).
//
// Two kinds of row, both append-only (there is no delete and no edit):
//
//   firm    a signed-in MEMBER of the project's firm marks a revision approved.
//           `approved_by` is the member; no name is stored (identity curation:
//           a member's email never reaches a document — the trail says "the
//           firm", and who inside it is a database fact for the firm's own eyes).
//   client  the client is not a user. The firm RECORDS that the client approved,
//           with the name and date the client gave — an event, entered by hand,
//           and printed as exactly that ("recorded by the firm").
//
// A project with no firm can still be approved by any signed-in account (the
// pilot's own projects); a project WITH a firm is that firm's to approve.
// Nothing here changes a BoQ. Missing table (pre-046) → no approvals, never an error.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { StoreError, requireFirm } from "@/lib/firms/store";
import { recordPilotEvent } from "@/lib/pilot/events";
import { isMissingSchema } from "@/lib/rates/firm";

import { approvalLabel, type ApprovalKind, type BoqApproval } from "./approval-label";

export { approvalLabel };
export type { ApprovalKind, BoqApproval };

export interface ApprovalInput {
  boq_id: string;
  kind: ApprovalKind;
  client_name?: string | null;
  client_date?: string | null;
  note?: string | null;
}

const COLUMNS = "id, project_id, boq_id, firm_id, kind, approved_by, client_name, client_date, note, created_at";

function toApproval(r: Record<string, unknown>): BoqApproval {
  return {
    id: String(r.id),
    project_id: String(r.project_id),
    boq_id: String(r.boq_id),
    firm_id: (r.firm_id ?? null) as string | null,
    kind: r.kind as ApprovalKind,
    approved_by: (r.approved_by ?? null) as string | null,
    client_name: (r.client_name ?? null) as string | null,
    client_date: (r.client_date ?? null) as string | null,
    note: (r.note ?? null) as string | null,
    created_at: String(r.created_at),
  };
}

/** Every approval of the project, oldest first. */
export async function listApprovals(db: SupabaseClient, projectId: string): Promise<BoqApproval[]> {
  const { data, error } = await db.from("boq_approvals").select(COLUMNS).eq("project_id", projectId).order("created_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw new Error(`boq_approvals read failed: ${error.message}`);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toApproval);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function recordApproval(db: SupabaseClient, projectId: string, input: ApprovalInput, caller: Caller | null): Promise<BoqApproval> {
  if (!caller) throw new StoreError(401, "unauthenticated", "Sign in to approve a BoQ revision.");
  const proj = await db.from("projects").select("id, firm_id").eq("id", projectId).maybeSingle();
  if (proj.error) throw new Error(`project read failed: ${proj.error.message}`);
  const project = proj.data as { id: string; firm_id: string | null } | null;
  if (!project) throw new StoreError(404, "project_not_found", "Project not found.");
  // A project with a firm is that firm's to approve: 401 / 404 / 403 as everywhere else.
  if (project.firm_id) await requireFirm(db, project.firm_id, caller);

  const boq = await db.from("boqs").select("id").eq("id", input.boq_id).eq("project_id", projectId).maybeSingle();
  if (boq.error) throw new Error(`boq read failed: ${boq.error.message}`);
  if (!boq.data) throw new StoreError(404, "boq_not_found", "That BoQ revision does not belong to this project.");

  let client_name: string | null = null;
  let client_date: string | null = null;
  if (input.kind === "client") {
    client_name = input.client_name?.trim() || null;
    client_date = input.client_date?.trim() || null;
    if (!client_name || !client_date || !ISO_DAY.test(client_date) || Number.isNaN(Date.parse(client_date))) {
      throw new StoreError(422, "client_details_required", "A client approval needs the name and the date (YYYY-MM-DD) the client gave.");
    }
  } else if (input.kind !== "firm") {
    throw new StoreError(422, "invalid_kind", 'kind must be "firm" or "client".');
  }

  const { data, error } = await db
    .from("boq_approvals")
    .insert({
      project_id: projectId,
      boq_id: input.boq_id,
      firm_id: project.firm_id,
      kind: input.kind,
      approved_by: caller.id,
      client_name,
      client_date,
      note: input.note?.trim() || null,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    if (isMissingSchema(error)) throw new StoreError(500, "approvals_unavailable", "The approvals table has not been migrated yet (046).");
    throw new Error(`boq_approvals insert failed: ${error.message}`);
  }
  const approval = toApproval(data as Record<string, unknown>);
  // L5: an approval is a pilot milestone (firm and actor on the event, 048).
  await recordPilotEvent(db, projectId, "approval_recorded", { approval_id: approval.id, boq_id: approval.boq_id, kind: approval.kind, client_date: approval.client_date }, { actor: caller.id, firmId: project.firm_id });
  return approval;
}

export interface RevisionApprovalStatus {
  /** The latest firm approval of this revision, if any. */
  firm: BoqApproval | null;
  /** The latest recorded client approval, if any. */
  client: BoqApproval | null;
  /** Every row for the revision, oldest first. */
  trail: BoqApproval[];
}

/** PURE: the status of one revision from the project's approvals. */
export function approvalStatus(approvals: readonly BoqApproval[], boqId: string): RevisionApprovalStatus {
  const trail = approvals.filter((a) => a.boq_id === boqId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const last = (k: ApprovalKind) => [...trail].reverse().find((a) => a.kind === k) ?? null;
  return { firm: last("firm"), client: last("client"), trail };
}
