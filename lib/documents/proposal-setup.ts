// =============================================================================
// lib/documents/proposal-setup.ts — what a proposal says beyond the BoQ (K4,
// R7 §3.7, migration 053). Server-only.
//
// The firm's defaults (validity, payment terms, line rates — OFF unless the
// firm turns them on) and one project's own setup (client as the cover names
// them, cover note, and that proposal's copy of the defaults). The first save
// copies the defaults in; every save also makes this proposal's validity /
// payment terms / line-rate choice the firm's defaults, so the next proposal
// starts from them ("saved to your firm, reused on every proposal").
//
// Who: a member of the project's firm (requireFirm: 401 → 404 → 403). A
// project with no firm has no proposal.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Caller } from "@/lib/auth/caller";
import { StoreError, requireFirm } from "@/lib/firms/store";

export interface ProposalSetup {
  firmId: string;
  clientLabel: string | null;
  validityDays: number | null;
  paymentTerms: string | null;
  coverNote: string | null;
  showLineRates: boolean;
  /** false = nothing saved for this project yet (the values are the firm's defaults). */
  saved: boolean;
  updatedAt: string | null;
}

export const DEFAULT_VALIDITY_DAYS = 30;

export const ProposalSetupInput = z
  .object({
    client_label: z.string().trim().max(160).nullable().optional(),
    validity_days: z.number().int().min(1).max(365).nullable().optional(),
    payment_terms: z.string().trim().max(2000).nullable().optional(),
    cover_note: z.string().trim().max(4000).nullable().optional(),
    show_line_rates: z.boolean().optional(),
  })
  .strict();
export type ProposalSetupInput = z.infer<typeof ProposalSetupInput>;

const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "42703" || /does not exist|schema cache/i.test(e.message ?? ""));

async function projectFirm(db: SupabaseClient, projectId: string): Promise<string> {
  const { data, error } = await db.from("projects").select("firm_id").eq("id", projectId).maybeSingle<{ firm_id: string | null }>();
  if (error) throw new Error(`project read failed: ${error.message}`);
  if (!data) throw new StoreError(404, "project_not_found", "Project not found.");
  if (!data.firm_id) throw new StoreError(409, "no_firm", "A proposal is a firm's document — this project has no firm attached.");
  return data.firm_id;
}

/** The document path: no caller (the pack job already holds the project). null = no firm. */
export async function loadProposalSetup(db: SupabaseClient, projectId: string): Promise<ProposalSetup | null> {
  const { data: p } = await db.from("projects").select("firm_id").eq("id", projectId).maybeSingle<{ firm_id: string | null }>();
  if (!p?.firm_id) return null;
  const [firm, row] = await Promise.all([
    db.from("firms").select("proposal_validity_days, proposal_payment_terms, proposal_show_line_rates").eq("id", p.firm_id).maybeSingle(),
    db.from("project_proposals").select("client_label, validity_days, payment_terms, cover_note, show_line_rates, updated_at").eq("project_id", projectId).maybeSingle(),
  ]);
  // Before 053: defaults only — line rates off, nothing saved.
  const f = (isMissing(firm.error) ? null : firm.data) as { proposal_validity_days: number | null; proposal_payment_terms: string | null; proposal_show_line_rates: boolean } | null;
  const r = (isMissing(row.error) ? null : row.data) as { client_label: string | null; validity_days: number | null; payment_terms: string | null; cover_note: string | null; show_line_rates: boolean; updated_at: string } | null;
  if (firm.error && !isMissing(firm.error)) throw new Error(`firm read failed: ${firm.error.message}`);
  if (row.error && !isMissing(row.error)) throw new Error(`project_proposals read failed: ${row.error.message}`);
  return {
    firmId: p.firm_id,
    clientLabel: r?.client_label ?? null,
    validityDays: r ? r.validity_days : (f?.proposal_validity_days ?? DEFAULT_VALIDITY_DAYS),
    paymentTerms: r ? r.payment_terms : (f?.proposal_payment_terms ?? null),
    coverNote: r?.cover_note ?? null,
    showLineRates: r ? r.show_line_rates : (f?.proposal_show_line_rates ?? false),
    saved: !!r,
    updatedAt: r?.updated_at ?? null,
  };
}

export async function getProposalSetup(db: SupabaseClient, projectId: string, caller: Caller | null): Promise<ProposalSetup> {
  const firmId = await projectFirm(db, projectId);
  await requireFirm(db, firmId, caller);
  return (await loadProposalSetup(db, projectId))!;
}

export async function saveProposalSetup(db: SupabaseClient, projectId: string, input: ProposalSetupInput, caller: Caller | null): Promise<ProposalSetup> {
  const firmId = await projectFirm(db, projectId);
  await requireFirm(db, firmId, caller);
  const current = (await loadProposalSetup(db, projectId))!;
  const next = {
    client_label: input.client_label !== undefined ? input.client_label || null : current.clientLabel,
    validity_days: input.validity_days !== undefined ? input.validity_days : current.validityDays,
    payment_terms: input.payment_terms !== undefined ? input.payment_terms || null : current.paymentTerms,
    cover_note: input.cover_note !== undefined ? input.cover_note || null : current.coverNote,
    show_line_rates: input.show_line_rates ?? current.showLineRates,
  };
  const now = new Date().toISOString();
  const up = await db.from("project_proposals").upsert({ project_id: projectId, firm_id: firmId, ...next, updated_by: caller!.id, updated_at: now }, { onConflict: "project_id" });
  if (up.error) {
    if (isMissing(up.error)) throw new StoreError(500, "migration_required", "The proposal setup table has not been migrated yet (053).");
    throw new Error(`project_proposals upsert failed: ${up.error.message}`);
  }
  // Reused on every proposal: this proposal's validity, payment terms and line-rate choice become the firm's defaults.
  const fd = await db.from("firms").update({ proposal_validity_days: next.validity_days, proposal_payment_terms: next.payment_terms, proposal_show_line_rates: next.show_line_rates }).eq("id", firmId);
  if (fd.error && !isMissing(fd.error)) throw new Error(`firm defaults update failed: ${fd.error.message}`);
  return (await loadProposalSetup(db, projectId))!;
}

/** "30 days from issue" / "valid until 11 Nov 2026" — what the cover and terms print. */
export function validityText(days: number | null, issuedISO: string): string | null {
  if (!days) return null;
  const until = new Date(`${issuedISO}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  const d = until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `Valid for ${days} day${days === 1 ? "" : "s"} from issue — until ${d}`;
}
