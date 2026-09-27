// =============================================================================
// lib/boq/revisions.ts — a project's BoQ revisions, and the diff of two (U4 / L3).
//
// Every `generate-boq` inserts a new `boqs` row and never deletes one, so the
// project's revision history already exists; this module reads it. ONE function
// (`buildProjectRevisionDiff`) assembles what the in-app view, the JSON route and
// the PDF all render: the diff (lib/boq/revision-diff.ts), the two curated BoQs,
// their provenance chains (for the popovers), the REF codes, the approval trail
// and the project's document name.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { curateBoq, curateText } from "@/lib/identity/curation";
import { loadDocumentProject, type DocumentProject } from "@/lib/documents/project-name";
import { buildBoqProvenance, type ProvBoq } from "@/lib/provenance/boq";
import { loadProvenanceContext } from "@/lib/provenance/load";
import type { BoqProvenance } from "@/lib/provenance/types";

import { approvalStatus, listApprovals, type BoqApproval, type RevisionApprovalStatus } from "./approvals";
import { assignRefs } from "./refs";
import { loadRecordedCauses } from "./revision-causes";
import { diffRevisions, snapshotRevision, type RevisionBoq, type RevisionDiff } from "./revision-diff";

export interface RevisionSummary {
  boq_id: string;
  created_at: string;
  grand_total_aed: number;
  line_count: number;
  draft: boolean;
  approvals: RevisionApprovalStatus;
}

type BoqRow = { id: string; created_at: string; sections: RevisionBoq | null };

function isBoq(v: unknown): v is RevisionBoq {
  return !!v && typeof v === "object" && Array.isArray((v as RevisionBoq).sections) && typeof (v as RevisionBoq).grand_total_aed === "number";
}

/** Every revision of the project, newest first, with its approval status. */
export async function listRevisions(db: SupabaseClient, projectId: string): Promise<RevisionSummary[]> {
  const [{ data, error }, approvals] = await Promise.all([
    db.from("boqs").select("id, created_at, sections").eq("project_id", projectId).order("created_at", { ascending: false }),
    listApprovals(db, projectId),
  ]);
  if (error) throw new Error(`boqs read failed: ${error.message}`);
  return ((data ?? []) as BoqRow[])
    .filter((r) => isBoq(r.sections))
    .map((r) => ({
      boq_id: r.id,
      created_at: r.created_at,
      grand_total_aed: Number(r.sections!.grand_total_aed),
      line_count: r.sections!.sections.reduce((n, s) => n + s.lines.length, 0),
      draft: r.sections!.garden?.draft?.draft === true,
      approvals: approvalStatus(approvals, r.id),
    }));
}

export interface RevisionDocument {
  boq_id: string;
  created_at: string;
  /** Curated: no withheld identity remains in any string. */
  boq: RevisionBoq & ProvBoq;
  provenance: BoqProvenance;
  /** `${work_section}-${idx}` → REF code. */
  refs: Record<string, string>;
}

export interface ProjectRevisionDiff {
  project: DocumentProject;
  diff: RevisionDiff;
  before: RevisionDocument;
  after: RevisionDocument;
  approvals: { before: RevisionApprovalStatus; after: RevisionApprovalStatus; all: BoqApproval[] };
}

async function loadRow(db: SupabaseClient, projectId: string, boqId: string): Promise<BoqRow | null> {
  const { data, error } = await db.from("boqs").select("id, created_at, sections").eq("id", boqId).eq("project_id", projectId).maybeSingle();
  if (error) throw new Error(`boq read failed: ${error.message}`);
  const row = data as BoqRow | null;
  return row && isBoq(row.sections) ? row : null;
}

export class RevisionNotFound extends Error {
  constructor(readonly boqId: string) {
    super(`BoQ revision ${boqId} does not belong to this project.`);
    this.name = "RevisionNotFound";
  }
}

/** THE diff: the same object for the page, the JSON route and the PDF. */
export async function buildProjectRevisionDiff(db: SupabaseClient, projectId: string, fromId: string, toId: string): Promise<ProjectRevisionDiff> {
  const [fromRow, toRow, ctx, project, approvals] = await Promise.all([
    loadRow(db, projectId, fromId),
    loadRow(db, projectId, toId),
    loadProvenanceContext(db, projectId),
    loadDocumentProject(db, projectId, "Untitled project"),
    listApprovals(db, projectId),
  ]);
  if (!fromRow) throw new RevisionNotFound(fromId);
  if (!toRow) throw new RevisionNotFound(toId);

  const doc = (row: BoqRow): RevisionDocument => {
    const boq = curateBoq(row.sections!, ctx.withheldNames) as RevisionBoq & ProvBoq;
    return {
      boq_id: row.id,
      created_at: row.created_at,
      boq,
      provenance: buildBoqProvenance(boq, ctx),
      refs: assignRefs(boq.sections),
    };
  };
  const before = doc(fromRow);
  const after = doc(toRow);
  // Causes are read in the (from, to] window of the two revisions — whichever
  // order the caller asked for, the window is chronological.
  const [early, late] = before.created_at <= after.created_at ? [before, after] : [after, before];
  const recorded = (await loadRecordedCauses(db, projectId, early.created_at, late.created_at, late.boq_id)).map((c) => ({
    ...c,
    summary: curateText(c.summary, ctx.withheldNames),
    descriptions: c.descriptions?.map((d) => curateText(d, ctx.withheldNames)),
  }));
  const diff = diffRevisions(snapshotRevision(before.boq_id, before.created_at, before.boq), snapshotRevision(after.boq_id, after.created_at, after.boq), recorded);
  return {
    project,
    diff,
    before,
    after,
    approvals: { before: approvalStatus(approvals, before.boq_id), after: approvalStatus(approvals, after.boq_id), all: approvals },
  };
}
