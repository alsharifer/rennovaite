// =============================================================================
// lib/provenance/types.ts — the source chain behind one displayed figure (I4).
//
// Plain data, client-safe. Built on the server from a stored BoQ + the plan
// (lib/provenance/boq.ts), or in the browser for a figure the browser computes
// (a what-if total). Every string in it is either a code-authored label or BoQ
// text that has passed identity curation (lib/identity/curation.ts) — never a
// raw `rate_book.source`.
// =============================================================================

export type ChainStepKind = "geometry" | "rule" | "tier" | "source" | "qs" | "arith" | "flag";

export interface ChainStep {
  kind: ChainStepKind;
  label: string;
  detail: string;
}

export interface FigureProvenance {
  /** What this figure is, e.g. "Rate — PCC base under paving". */
  title: string;
  steps: ChainStep[];
  /** Short chips: "derived", "sized to measured aggregate", "QS to price", … */
  flags: string[];
  /** false = the figure cannot be traced to a source; `gap` says why. Never hidden. */
  traceable: boolean;
  gap?: string;
}

export interface LineProvenance {
  quantity: FigureProvenance;
  rate: FigureProvenance;
  total: FigureProvenance;
}

export interface BoqProvenance {
  /** Keyed `${work_section}-${lineIndex}` — the BoQ view's row key. */
  lines: Record<string, LineProvenance>;
  /** Keyed by work_section. */
  sections: Record<string, FigureProvenance>;
  summary: {
    subtotal: FigureProvenance;
    ohp: FigureProvenance | null;
    contingency: FigureProvenance;
    vat: FigureProvenance;
    grand: FigureProvenance;
  };
  /** Every figure that could not be traced, and why. The report lists these. */
  findings: { figure: string; gap: string }[];
}
