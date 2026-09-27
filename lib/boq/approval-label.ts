// =============================================================================
// lib/boq/approval-label.ts — how an approval reads (U4). CLIENT-SAFE, no imports.
//
// Never a member identity: a firm approval reads "the firm"; a client approval
// reads as what it is — an event the firm recorded, with the name and date the
// client gave.
// =============================================================================

export type ApprovalKind = "firm" | "client";

export interface BoqApproval {
  id: string;
  project_id: string;
  boq_id: string;
  firm_id: string | null;
  kind: ApprovalKind;
  /** The signed-in member who marked (firm) or recorded (client) it. */
  approved_by: string | null;
  client_name: string | null;
  /** YYYY-MM-DD, as the client gave it. */
  client_date: string | null;
  note: string | null;
  created_at: string;
}

export function approvalLabel(a: BoqApproval): string {
  const day = a.created_at.slice(0, 10);
  return a.kind === "firm" ? `Approved by the firm · ${day}` : `Client approval recorded by the firm · ${a.client_name} · ${a.client_date}`;
}
