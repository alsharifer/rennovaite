// T5 — the export gate WITHOUT running an export: the same checklist a run
// blocks on, for the Export pack panel to show before anything is started.
// Server-only (reads the DB and builds the drawing set for parity).

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadPackReadiness } from "@/lib/documents/pack-readiness";
import { loadParity } from "@/lib/documents/parity-load";

import { buildChecklist, checklistReady } from "./checklist";
import type { ChecklistItem } from "./types";

export async function preflightChecklist(db: SupabaseClient, projectId: string): Promise<{ ready: boolean; documentName: string | null; checklist: ChecklistItem[] }> {
  const [{ data: proj }, readiness, parity] = await Promise.all([
    db.from("projects").select("name, display_name").eq("id", projectId).maybeSingle<{ name: string | null; display_name: string | null }>(),
    loadPackReadiness(db, projectId),
    loadParity(db, projectId).catch(() => null),
  ]);
  const documentName = proj?.display_name ?? proj?.name ?? null;
  const checklist = buildChecklist({ projectId, readiness, parity, documentName });
  return { ready: checklistReady(checklist), documentName, checklist };
}
