// =============================================================================
// components/blueprint/Figure.tsx — a number and its provenance mark
// (R7 §1.3 / §1.4 / §4.2 #1, K1).
//
// The number is always ink (R4) in mono tabular figures; the mark sits beside
// it. Screen readers hear ONE description — "7,329.70, derived — quantity
// derived, rate market reference" — not a number followed by a mystery glyph.
// An unpriced figure never shows a number: a rate reads "—", an amount reads
// "to be priced" (label/md, ink-tertiary) with the dashed mark.
//
// The interactive provenance popover is K3's: this is the static primitive.
// Server-safe (no hooks), so client components can render it too. Marks come
// in as data from tierOf() on the server.
// =============================================================================

import { formatAED, formatDelta, formatQty } from "@/lib/format/aed";
import { describeFigure, type FigureRole, type LineTiers, type Persona, type ProvTier } from "@/lib/provenance/tier-vocab";

import { ProvenanceMark } from "./ProvenanceMark";

export type FigureFormat = "aed" | "qty" | "delta";

const SIZE_CLASS = { xl: "t-num-xl", lg: "t-num-lg", md: "t-num-md", sm: "t-num-sm" } as const;

export interface FigureProps {
  value: number | null;
  tier: ProvTier;
  /** "aed" (2 dp, default) · "qty" (integer or 2 dp) · "delta" (signed, U+2212). */
  format?: FigureFormat;
  /** Which figure on a line this is — picks the label ("Own basis" is a rate's). */
  role?: FigureRole;
  /** For an amount: the quantity and rate marks it took the weaker of (R1) — spoken in the description. */
  inputs?: Pick<LineTiers, "qty" | "rate">;
  /** Replaces the generated accessible description entirely. */
  description?: string;
  persona?: Persona;
  size?: keyof typeof SIZE_CLASS;
  /** Shown after the number, e.g. "m²" (part of the description too). */
  unit?: string;
  className?: string;
}

function display(value: number | null, format: FigureFormat): string {
  if (format === "qty") return formatQty(value);
  if (format === "delta") return formatDelta(value);
  return formatAED(value);
}

export function Figure({ value, tier, format = "aed", role = "amount", inputs, description, persona = "firm", size = "md", unit, className }: FigureProps) {
  const unpriced = tier === "unpriced";
  // An unpriced rate is "—"; an unpriced amount is "to be priced". A quantity is still a quantity.
  const text = unpriced && role !== "qty" ? (role === "rate" ? "—" : "to be priced") : `${display(value, format)}${unit ? ` ${unit}` : ""}`;
  const spoken = description ?? describeFigure(text, tier, { persona, role, inputs });
  return (
    <span data-bp-figure="" data-tier={tier} data-role={role} className={`inline-flex items-baseline gap-1 whitespace-nowrap${className ? ` ${className}` : ""}`}>
      <span aria-hidden="true" className={unpriced && role !== "qty" ? "t-label-md text-bp-ink-tertiary" : `${SIZE_CLASS[size]} text-bp-ink-primary`}>
        {text}
      </span>
      <ProvenanceMark tier={tier} />
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
