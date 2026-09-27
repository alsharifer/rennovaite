// T5 — the export gate WITHOUT running an export: the same checklist a run
// blocks on, for the Export pack panel to show before anything is started.
// Server-only (reads the DB and builds the drawing set for parity).
// L4 — with `proposal`, the client-proposal items (firm, reference basis,
// branding) are part of the checklist, exactly as the run applies them.

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadPackReadiness } from "@/lib/documents/pack-readiness";
import { loadParity } from "@/lib/documents/parity-load";
import { loadProposalGate } from "@/lib/documents/proposal-gate";

import { buildChecklist, checklistReady, proposalChecklistItems } from "./checklist";
import type { ChecklistItem } from "./types";

export interface Preflight {
  ready: boolean;
  documentName: string | null;
  checklist: ChecklistItem[];
  /** L4: the project's firm as the proposal would print it, or null. */
  firm: { brand: string; logo: boolean; terms: boolean; book_status: "draft" | "reviewed" | null } | null;
}

export async function preflightChecklist(db: SupabaseClient, projectId: string, opts: { proposal?: boolean } = {}): Promise<Preflight> {
  const [{ data: proj }, readiness, parity, gate] = await Promise.all([
    db.from("projects").select("name, display_name").eq("id", projectId).maybeSingle<{ name: string | null; display_name: string | null }>(),
    loadPackReadiness(db, projectId),
    loadParity(db, projectId).catch(() => null),
    loadProposalGate(db, projectId).catch(() => null),
  ]);
  const documentName = proj?.display_name ?? proj?.name ?? null;
  const checklist = buildChecklist({ projectId, readiness, parity, documentName });
  if (opts.proposal && gate) checklist.push(...proposalChecklistItems(projectId, gate));
  const firm = gate?.firm ? { brand: gate.firm.brand, logo: !!gate.firm.logo_path, terms: !!gate.firm.terms_text, book_status: gate.firm.book_status } : null;
  return { ready: checklistReady(checklist), documentName, checklist, firm };
}
