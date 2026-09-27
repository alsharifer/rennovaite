// =============================================================================
// lib/documents/reference-basis-types.ts — the reference-basis vocabulary (L4).
// CLIENT-SAFE: no imports. The logic (lib/documents/reference-basis.ts) infers
// tiers through the provenance module, which a client component must not reach.
// =============================================================================

/** The in-app banner on any BoQ with a line resolved below the firm's own book. */
export const REFERENCE_BASIS_BANNER = "priced from market reference — review rates before client use";

/** The proposal's discreet mark — the firm is the brand. */
export const PREPARED_WITH_MARK = "Prepared with RennovAIte";

export type PricingBasis = "firm" | "reference" | "mixed" | "unpriced" | "none";

export interface ReferenceBasis {
  basis: PricingBasis;
  /** Lines resolved at the firm's own tiers (firm_private / firm_correction). */
  firm_lines: number;
  /** Lines resolved below tier 1 — the market reference, a fallback, an indicative rate. */
  reference_lines: number;
  /** QS-to-price lines at rate 0 (D4) — counted separately, never as a reference rate. */
  unpriced_lines: number;
  total_lines: number;
  /** The AED total of the reference-priced lines, before markups. */
  reference_aed: number;
}

export type ProposalGateReason = "firm_basis" | "book_reviewed" | "accepted";

export interface ProposalGateVerdict {
  ok: boolean;
  /** Why it passed, when it did. */
  reason: ProposalGateReason | null;
  /** Why it did not, when it did not — client-safe prose. */
  refusal: string | null;
}

export interface ReferenceBasisAcceptance {
  id: string;
  project_id: string;
  firm_id: string;
  boq_id: string;
  accepted_by: string | null;
  reference_lines: number;
  note: string | null;
  created_at: string;
}
