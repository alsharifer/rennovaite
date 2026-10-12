// =============================================================================
// lib/journey-eyebrow.ts — a page's "06 · DOCUMENTS" eyebrow, from the journey
// (K4). Never a literal number: the firm journey's numbers are fixed
// (FIRM_STEPS), the owner's drop flag-disabled steps (journeySteps). A page
// reached on both journeys names the step for the persona that is reading it.
// =============================================================================

import { FIRM_STEPS, journeyStep, type JourneyFlags, type JourneyStepKey } from "./journey";

export function stepEyebrow(persona: "firm" | "owner", firmKey: string, ownerKey: JourneyStepKey | null, flags: JourneyFlags, fallback: string): string {
  if (persona === "firm") {
    const s = FIRM_STEPS.find((x) => x.key === firmKey);
    return s ? `${s.number} · ${s.label.toUpperCase()}` : fallback.toUpperCase();
  }
  const s = ownerKey ? journeyStep(ownerKey, flags) : null;
  return s ? `${String(s.number).padStart(2, "0")} · ${s.label.toUpperCase()}` : fallback.toUpperCase();
}
