// =============================================================================
// lib/boq/review-types.ts — the BoQ & Review screen's data, as the browser
// receives it (K3, R7 §3.2). Client-safe: plain data. Built on the server by
// lib/boq/review-model.ts from the STORED, curated BoQ — every mark comes from
// tierOf(), every chain from the I4 provenance source (identity-curated), so
// nothing on the screen is re-derived from raw fields in the browser.
// =============================================================================

import type { LineTiers, Persona, ProvTier } from "@/lib/provenance/tier-vocab";
import type { FigureProvenance, LineProvenance } from "@/lib/provenance/types";

export interface ReviewLine {
  /** `${work_section}-${idx}` — the row key the provenance and REF maps use. */
  key: string;
  ref: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  tiers: LineTiers;
  /** QS-to-price at rate 0 — never inside a total. */
  unpriced: boolean;
  /** "≈ Derived from the reference layout — firm after site verification." */
  derivedNote: string | null;
  /** B5: a question the line asks before its figure is firm ("Is the leak fixed?"). */
  confirm: string | null;
  /** B5: what the rate rests on — calibrated · market · allowance · TBC (lib/boq/rate-basis.ts). */
  basis: string | null;
  itemKey: string | null;
  elementRefs: string[];
  /** Why an unpriced line has no rate, in curated words. */
  unpricedReason: string | null;
  prov: LineProvenance | null;
  /** Firm persona only: the firm's book has no active entry for this item; `canAdd` = it is in the entry vocabulary. */
  book: { hasEntry: boolean; canAdd: boolean; unit: string | null } | null;
  /** B7 5: on a wet-room BoQ, the product group this line belongs to and what else it could be (lib/boq/product-swaps.ts). */
  product: { field: string; group: string; current: string | boolean; options: { value: string | boolean; label: string; rate: number | null; unit: string; basis?: "catalogue" | "calibrated" | "allowance" | null }[] } | null;
}

export interface ReviewSection {
  name: string;
  /** The section's REF code (PRE, HRD, …). */
  code: string;
  lines: ReviewLine[];
  subtotal: number;
  /** Weakest counted line (R1); "unpriced" when every line is to be priced. */
  tier: ProvTier | null;
  /** Lines to be priced in this section. */
  tbp: number;
  prov: FigureProvenance | null;
}

export interface ExcludedLine {
  ref: string;
  description: string;
  quantity: number;
  unit: string;
  reason: string;
}

export interface ChainRow {
  pct: number;
  base: number;
  amount: number;
  prov: FigureProvenance | null;
}

export interface ReviewModel {
  projectId: string;
  boqId: string;
  rev: number;
  revDate: string;
  persona: Persona;
  firm: { id: string; brand: string } | null;
  sections: ReviewSection[];
  headline: {
    total: number;
    /** "≈" — the weakest counted mark is derived, or the plan is a draft. */
    estimate: boolean;
    tier: ProvTier | null;
    excluded: ExcludedLine[];
    spoken: string;
  };
  basis: { tier: ProvTier; lines: number; amount: number }[];
  counted: number;
  totalLines: number;
  chain: {
    subtotal: number;
    subtotalTier: ProvTier | null;
    ohp: ChainRow | null;
    /** Why OH&P is not applied, when it is not. */
    ohpNote: string | null;
    contingency: ChainRow;
    vat: ChainRow;
    grand: number;
    subtotalProv: FigureProvenance | null;
    grandProv: FigureProvenance | null;
  };
  notices: {
    draft: { key: string; sentence: string; derivedLines: number; note: string | null } | null;
    reference: {
      key: string;
      referenceLines: number;
      totalLines: number;
      firmLines: number;
      status: "open" | "accepted" | "book_reviewed" | "no_firm";
      acceptedOn: string | null;
      acceptedNote: string | null;
    } | null;
    /** K11 #3: `lineKeys` = the two lines a finding names (row keys), for the Issues navigator. */
    duplicates: { label: string; detail: string; lineKeys?: string[] }[];
    garden: { kept: number; removed: number; undecided: number } | null;
    /** C1: the plan-check reason when the plan priced no glazing ("No windows or doors drawn — glazing not priced."). Absent / null = none. */
    glazing?: string | null;
  };
  /** The client's own entered budget — owner projects only (H7). */
  budget: number | null;
  /** K11: applied prices whose line is not in this revision — never dropped silently (Issues navigator). */
  unmatchedPrices: { correctionId: string; item: string; type: "rate" | "quantity"; value: number; basis: string | null; by: string | null }[];
  programme: { total_days: number; phases: { name: string; start_day: number; days: number }[]; basis: string } | null;
  /** B5: priced OUTSIDE the total — what each adds, what it replaces, and what it moves the total by. */
  options: ReviewOption[];
  /** B5: what the rates rest on, by line count and amount (absent on a BoQ that does not record it). */
  rateBasis: { basis: string; lines: number; amount: number }[] | null;
}

export interface ReviewOption {
  key: string;
  label: string;
  note: string;
  net: number;
  /** The grand total if taken, minus the grand total — incl. OH&P, contingency and VAT. */
  delta: number | null;
  adds: { description: string; quantity: number; unit: string; rate: number; amount: number; basis: string | null }[];
  replaces: { description: string; amount: number }[];
}
