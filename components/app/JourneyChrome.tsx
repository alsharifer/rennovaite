import { ownerStep, type OwnerStepKey } from "@/lib/journey";

// =============================================================================
// components/app/JourneyChrome.tsx — the step header of the pages still on
// Atelier (K8 transition). Since K8.1 the owner journey has fixed numbers
// (lib/journey.ts OWNER_STEPS) and the Blueprint rail shows where the reader
// is, so this only names the step. Deleted in K8.2, when every page renders the
// Blueprint shell.
// =============================================================================

function eyebrow(stepKey: OwnerStepKey): string {
  const s = ownerStep(stepKey);
  return `${s.number} · ${s.label.toUpperCase()}`;
}

/** Just the step eyebrow — for pages that own their heading and intro copy. */
export function JourneyProgress({ stepKey }: { stepKey: OwnerStepKey; projectId?: string | null }) {
  return <p className="label-caps mb-md text-brass-600">{eyebrow(stepKey)}</p>;
}

export function JourneyChrome({ stepKey, title, intro }: { stepKey: OwnerStepKey; projectId?: string | null; title: string; intro?: string }) {
  return (
    <header className="mb-2xl">
      <p className="label-caps mb-md text-brass-600">{eyebrow(stepKey)}</p>
      <h1 className="font-display text-headline-lg-mobile text-ink-900 md:text-headline-lg">{title}</h1>
      {intro ? <p className="mt-md max-w-[720px] font-body text-body-lg text-on-surface-variant">{intro}</p> : null}
    </header>
  );
}
