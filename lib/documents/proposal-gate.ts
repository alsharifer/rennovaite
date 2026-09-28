// =============================================================================
// lib/documents/proposal-gate.ts — the reference-basis gate, loaded (L4).
//
// One loader answers three surfaces with the same verdict: the BoQ page's
// banner + accept control, the Export pack checklist, and the proposal route's
// refusal. The acceptance is an EVENT (reference_basis_acceptances, 047):
// append-only, per BoQ revision, by a member of the project's firm.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { loadFirmBranding, type FirmBranding } from "@/lib/firms/branding";
import { StoreError, requireFirm } from "@/lib/firms/store";
import { recordPilotEvent } from "@/lib/pilot/events";
import { isMissingSchema } from "@/lib/rates/firm";

import { boqPricingFingerprint, proposalGateVerdict, referenceBasisOf } from "./reference-basis";
import type { ProposalGateVerdict, ReferenceBasis, ReferenceBasisAcceptance } from "./reference-basis-types";

export interface ProposalGate {
  /** The project's firm, with its branding and book status; null = no firm (no proposal possible). */
  firm: (FirmBranding & { book_status: "draft" | "reviewed" | null }) | null;
  /** The latest BoQ revision and where its rates came from; null = no BoQ. */
  boq: { id: string; basis: ReferenceBasis } | null;
  /** The latest acceptance recorded for that revision, if any. */
  acceptance: ReferenceBasisAcceptance | null;
  verdict: ProposalGateVerdict;
}

const ACCEPT_COLS = "id, project_id, firm_id, boq_id, accepted_by, reference_lines, note, created_at";

function toAcceptance(r: Record<string, unknown>): ReferenceBasisAcceptance {
  return {
    id: String(r.id),
    project_id: String(r.project_id),
    firm_id: String(r.firm_id),
    boq_id: String(r.boq_id),
    accepted_by: (r.accepted_by ?? null) as string | null,
    reference_lines: Number(r.reference_lines ?? 0),
    note: (r.note ?? null) as string | null,
    created_at: String(r.created_at),
  };
}

export async function listAcceptances(db: SupabaseClient, projectId: string): Promise<ReferenceBasisAcceptance[]> {
  const { data, error } = await db.from("reference_basis_acceptances").select(ACCEPT_COLS).eq("project_id", projectId).order("created_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw new Error(`reference_basis_acceptances read failed: ${error.message}`);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toAcceptance);
}

export async function loadProposalGate(db: SupabaseClient, projectId: string): Promise<ProposalGate> {
  const [{ data: proj }, { data: boqRow }, acceptances] = await Promise.all([
    db.from("projects").select("firm_id").eq("id", projectId).maybeSingle<{ firm_id: string | null }>(),
    db.from("boqs").select("id, sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; sections: Parameters<typeof referenceBasisOf>[0] }>(),
    listAcceptances(db, projectId),
  ]);
  const boq = boqRow ? { id: boqRow.id, basis: referenceBasisOf(boqRow.sections) } : null;
  let firm: ProposalGate["firm"] = null;
  if (proj?.firm_id) {
    const branding = await loadFirmBranding(db, proj.firm_id);
    if (branding) {
      const { data: book } = await db.from("firm_rate_books").select("status").eq("firm_id", proj.firm_id).maybeSingle<{ status: "draft" | "reviewed" | null }>();
      firm = { ...branding, book_status: book?.status ?? null };
    }
  }
  // An acceptance covers the latest revision when it names it, OR when the
  // revision it named has the same PRICING (every line's qty/rate/total and the
  // summary chain): a pack export regenerates the BoQ before its gate, and an
  // identical regeneration is the basis the firm accepted. Any moved line is
  // a new basis and needs its own acceptance.
  let acceptance: ReferenceBasisAcceptance | null = null;
  if (boq && firm) {
    const own = [...acceptances].reverse().filter((a) => a.firm_id === firm.firm_id);
    acceptance = own.find((a) => a.boq_id === boq.id) ?? null;
    if (!acceptance && own.length) {
      const fp = boqPricingFingerprint(boqRow!.sections as Parameters<typeof boqPricingFingerprint>[0]);
      for (const a of own.slice(0, 5)) {
        const { data: prev } = await db.from("boqs").select("sections").eq("id", a.boq_id).eq("project_id", projectId).maybeSingle<{ sections: Parameters<typeof boqPricingFingerprint>[0] }>();
        if (prev && boqPricingFingerprint(prev.sections) === fp) {
          acceptance = a;
          break;
        }
      }
    }
  }
  const verdict: ProposalGateVerdict = !firm
    ? { ok: false, reason: null, refusal: "A client proposal is a firm's document: attach the firm that will send it to this project." }
    : !boq
      ? { ok: false, reason: null, refusal: "No BoQ has been generated yet." }
      : proposalGateVerdict({ basis: boq.basis, bookStatus: firm.book_status, accepted: !!acceptance });
  return { firm, boq, acceptance, verdict };
}

/**
 * The firm accepts the reference basis for ONE BoQ revision. A member of the
 * project's firm (401 / 404 / 403); the revision must be the project's; a BoQ
 * with no reference-priced line needs no acceptance (422) — nothing to accept.
 */
export async function acceptReferenceBasis(db: SupabaseClient, projectId: string, input: { boq_id: string; note?: string | null }, caller: Caller | null): Promise<ReferenceBasisAcceptance> {
  if (!caller) throw new StoreError(401, "unauthenticated", "Sign in to accept the reference basis.");
  const { data: proj } = await db.from("projects").select("id, firm_id").eq("id", projectId).maybeSingle<{ id: string; firm_id: string | null }>();
  if (!proj) throw new StoreError(404, "project_not_found", "Project not found.");
  if (!proj.firm_id) throw new StoreError(422, "no_firm", "This project has no firm; only the firm sending the proposal can accept its pricing basis.");
  await requireFirm(db, proj.firm_id, caller);
  const { data: boq } = await db.from("boqs").select("id, sections").eq("id", input.boq_id).eq("project_id", projectId).maybeSingle<{ id: string; sections: Parameters<typeof referenceBasisOf>[0] }>();
  if (!boq) throw new StoreError(404, "boq_not_found", "That BoQ revision does not belong to this project.");
  const basis = referenceBasisOf(boq.sections);
  if (basis.reference_lines === 0) throw new StoreError(422, "nothing_to_accept", "Every priced line is the firm's own rate; there is no reference basis to accept.");
  const { data, error } = await db
    .from("reference_basis_acceptances")
    .insert({ project_id: projectId, firm_id: proj.firm_id, boq_id: boq.id, accepted_by: caller.id, reference_lines: basis.reference_lines, note: input.note?.trim() || null })
    .select(ACCEPT_COLS)
    .single();
  if (error) {
    if (isMissingSchema(error)) throw new StoreError(500, "acceptances_unavailable", "Reference-basis acceptance needs migration 047.");
    throw new Error(`reference_basis_acceptances insert failed: ${error.message}`);
  }
  const acceptance = toAcceptance(data as Record<string, unknown>);
  // L5: the stated choice is a pilot milestone too (048).
  await recordPilotEvent(db, projectId, "basis_accepted", { acceptance_id: acceptance.id, boq_id: acceptance.boq_id, reference_lines: acceptance.reference_lines }, { actor: caller.id, firmId: proj.firm_id });
  return acceptance;
}
