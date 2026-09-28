// =============================================================================
// lib/documents/reference-basis.ts — where a BoQ's rates came from, as a gate (L4).
//
// The TV finding: a firm's project whose book does not cover every line is
// priced, line by line, from the market reference (tier 3) or a fallback — and
// nothing said so. Now:
//
//   referenceBasisOf(boq)   counts each line by the tier that answered it
//                           (stored `rate_tier`, or inferred exactly as the
//                           provenance popover infers it for a BoQ stored
//                           before L1), so a BoQ knows whether it is the firm's
//                           pricing, the market's, or both;
//   proposalGateVerdict()   a CLIENT-FACING proposal on a reference-priced BoQ
//                           is refused until the firm's book is `reviewed` (U2)
//                           or the firm explicitly accepted the reference basis
//                           for THIS revision (an event, migration 047). The
//                           fallback becomes a stated choice, never a default.
//
// Pure. Server-side (the tier inference reaches the provenance module).
// =============================================================================

import { createHash } from "node:crypto";

import { isUnpricedLine } from "@/lib/documents/boq-derived";
import { lineTierKey, type ProvLine } from "@/lib/provenance/boq";
import { isFirmTier, type RateTier } from "@/lib/rates/tiers";

import type { PricingBasis, ProposalGateVerdict, ReferenceBasis } from "./reference-basis-types";

export { REFERENCE_BASIS_BANNER, PREPARED_WITH_MARK } from "./reference-basis-types";
export type { PricingBasis, ProposalGateVerdict, ReferenceBasis, ReferenceBasisAcceptance } from "./reference-basis-types";

interface BasisBoq {
  sections: { work_section: string; lines: ProvLine[] }[];
}

export function referenceBasisOf(boq: BasisBoq | null | undefined): ReferenceBasis {
  let firm = 0;
  let reference = 0;
  let unpriced = 0;
  let referenceAed = 0;
  for (const s of boq?.sections ?? []) {
    for (const l of s.lines) {
      if (isUnpricedLine(l)) {
        unpriced++;
        continue;
      }
      const tier = lineTierKey(l, s.work_section);
      // A selected product (D1) is laid over whichever tier answered; the stored
      // rate_tier is the underlying one, so `selection` never reaches here. A
      // line whose tier cannot be named is NOT the firm's.
      if (isFirmTier(tier as RateTier)) firm++;
      else {
        reference++;
        referenceAed += Number(l.total_aed) || 0;
      }
    }
  }
  const total = firm + reference + unpriced;
  const basis: PricingBasis = total === 0 ? "none" : firm + reference === 0 ? "unpriced" : reference === 0 ? "firm" : firm === 0 ? "reference" : "mixed";
  return { basis, firm_lines: firm, reference_lines: reference, unpriced_lines: unpriced, total_lines: total, reference_aed: Math.round(referenceAed * 100) / 100 };
}

/**
 * The PRICING identity of a BoQ revision: every line's description, quantity,
 * unit, rate and total, plus the summary chain — nothing else (not the
 * generation timestamp, not provenance). An acceptance covers a revision by
 * this fingerprint: a regenerated BoQ with identical pricing is the same basis
 * the firm accepted; a BoQ where any line moved needs a new acceptance.
 */
export function boqPricingFingerprint(boq: (BasisBoq & { subtotal_aed?: number; ohp_aed?: number; contingency_aed?: number; vat_aed?: number; grand_total_aed?: number }) | null | undefined): string {
  const canon = {
    sections: (boq?.sections ?? []).map((s) => ({ w: s.work_section, l: s.lines.map((l) => [l.description, Number(l.quantity), l.unit, Number(l.rate_aed), Number(l.total_aed)]) })),
    t: [boq?.subtotal_aed ?? 0, boq?.ohp_aed ?? 0, boq?.contingency_aed ?? 0, boq?.vat_aed ?? 0, boq?.grand_total_aed ?? 0],
  };
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

/** True when the in-app banner shows: at least one line below tier 1. */
export const needsReferenceBanner = (b: ReferenceBasis) => b.reference_lines > 0;

export function proposalGateVerdict(input: { basis: ReferenceBasis; bookStatus: "draft" | "reviewed" | null; accepted: boolean }): ProposalGateVerdict {
  const { basis, bookStatus, accepted } = input;
  if (basis.reference_lines === 0) return { ok: true, reason: "firm_basis", refusal: null };
  if (bookStatus === "reviewed") return { ok: true, reason: "book_reviewed", refusal: null };
  if (accepted) return { ok: true, reason: "accepted", refusal: null };
  const n = basis.reference_lines;
  return {
    ok: false,
    reason: null,
    refusal: `${n} of ${basis.total_lines} lines are priced from the market reference, not the firm's book. Mark the rate book reviewed, or accept the reference basis for this BoQ revision — the acceptance is recorded.`,
  };
}
