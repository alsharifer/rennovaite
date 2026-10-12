// =============================================================================
// components/blueprint/TierLabel.tsx — mark + tier words (R7 §1.4).
// Provenance colour reaches TEXT only here: the tier label beside its glyph
// (label/caps, the tier's --color-prov-*-text). Unpriced has no hue.
// =============================================================================

import { tierLabelWithWhy, type FigureRole, type Persona, type ProvTier } from "@/lib/provenance/tier-vocab";

import { ProvenanceMark } from "./ProvenanceMark";

const TEXT_CLASS: Record<ProvTier, string> = {
  measured: "text-bp-prov-measured-text",
  validated: "text-bp-prov-validated-text",
  market: "text-bp-prov-market-text",
  derived: "text-bp-prov-derived-text",
  unpriced: "text-bp-ink-tertiary",
};

export function TierLabel({ tier, why = null, persona = "firm", role = "amount" }: { tier: ProvTier; why?: string | null; persona?: Persona; role?: FigureRole }) {
  return (
    <span className="inline-flex items-center gap-1">
      <ProvenanceMark tier={tier} />
      <span className={`t-label-caps ${TEXT_CLASS[tier]}`}>{tierLabelWithWhy(tier, why, persona, role)}</span>
    </span>
  );
}
