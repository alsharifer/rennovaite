// =============================================================================
// lib/journey-eyebrow.ts — a page's "06 · DOCUMENTS" eyebrow, from the journey
// (K4). Never a literal number: both journeys number their steps in
// lib/journey.ts (firm 00–08, owner 00–06 since K8). A page reached on both
// journeys names the step for the persona that is reading it.
// =============================================================================

import { FIRM_STEPS, ownerStep, type OwnerStepKey } from "./journey";

export function stepEyebrow(persona: "firm" | "owner", firmKey: string, ownerKey: OwnerStepKey | null, fallback: string): string {
  if (persona === "firm") {
    const s = FIRM_STEPS.find((x) => x.key === firmKey);
    return s ? `${s.number} · ${s.label.toUpperCase()}` : fallback.toUpperCase();
  }
  const s = ownerKey ? ownerStep(ownerKey) : null;
  return s ? `${s.number} · ${s.label.toUpperCase()}` : fallback.toUpperCase();
}

/** An owner page's eyebrow — "04 · COST". */
export function ownerEyebrow(key: OwnerStepKey): string {
  return stepEyebrow("owner", "", key, key);
}
