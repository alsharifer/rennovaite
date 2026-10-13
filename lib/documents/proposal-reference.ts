// =============================================================================
// lib/documents/proposal-reference.ts — the proposal's reference (K9, migration
// 054). Server-side for the two loaders; the two formatters are pure.
//
// A per-firm sequence, "<PREFIX>-P-0001", stored on the project's proposal row.
// Assigned ONCE, at the first issue through the gated export
// (`assign_proposal_reference`, one transaction), and reused by every later
// export of the same project's proposal. The preview never assigns one.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { StoreError } from "@/lib/firms/store";
import { isMissingSchema } from "@/lib/rates/firm";

/** Legal-form and filler words a prefix skips ("Scratch Landscapes & Co." → SL). */
const STOP = new Set(["THE", "AND", "OF", "CO", "COMPANY", "LLC", "LTD", "LIMITED", "FZE", "FZCO", "FZ", "FZLLC", "DMCC", "INC", "GROUP"]);

/**
 * The prefix a firm's series starts with, from its brand: the initials of its
 * significant words (2–4 letters), or the first three letters of a one-word
 * brand. 2–6 of A–Z/0–9, the column's check. A brand with no Latin letters
 * gets "PR". Used once — the firm keeps the prefix it was first issued with.
 */
export function defaultProposalPrefix(brand: string): string {
  const words = brand
    .normalize("NFKD")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const significant = words.filter((w) => !STOP.has(w));
  const use = significant.length > 0 ? significant : words;
  const p = use.length >= 2 ? use.slice(0, 4).map((w) => w[0]).join("") : (use[0] ?? "").slice(0, 3);
  return p.length >= 2 ? p : "PR";
}

/** "<PREFIX>-P-0001" — the SQL function's format (never truncated past 9999). */
export function formatProposalReference(prefix: string, seq: number): string {
  return `${prefix}-P-${seq < 10000 ? String(seq).padStart(4, "0") : String(seq)}`;
}

/**
 * Issue: the project's reference for this firm, assigned now when it has none.
 * Without 054 it refuses (500 `migration_required`) rather than issue a
 * proposal with no reference.
 */
export async function assignProposalReference(db: SupabaseClient, projectId: string, firmId: string, brand: string): Promise<string> {
  const { data, error } = await db.rpc("assign_proposal_reference", { p_project: projectId, p_firm: firmId, p_prefix: defaultProposalPrefix(brand) });
  if (error) {
    if (isMissingSchema(error) || /assign_proposal_reference/.test(error.message ?? "")) {
      throw new StoreError(500, "migration_required", "Proposal references need migration 054 — apply it with npm run db:push.");
    }
    throw new Error(`assign_proposal_reference failed: ${error.message}`);
  }
  if (typeof data !== "string" || !data) throw new Error("assign_proposal_reference returned no reference");
  return data;
}

/** Read only (the preview): the reference this firm already issued the project's proposal under, else null. */
export async function loadProposalReference(db: SupabaseClient, projectId: string, firmId: string): Promise<string | null> {
  const { data, error } = await db.from("project_proposals").select("reference, reference_firm_id").eq("project_id", projectId).maybeSingle<{ reference: string | null; reference_firm_id: string | null }>();
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new Error(`project_proposals read failed: ${error.message}`);
  }
  return data?.reference && data.reference_firm_id === firmId ? data.reference : null;
}
