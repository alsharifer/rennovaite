import Link from "next/link";

import {
  journeyFlagsFromEnv,
  journeySteps,
  journeyStep,
  stepLabel,
  type JourneyStepKey,
} from "@/lib/journey";

// =============================================================================
// components/app/JourneyChrome.tsx — the step header every journey page shares.
//
// Replaces the "Step 03 of 05" string that used to be hand-written on each
// page (and drifted: renders and drawings carried no step at all). The label,
// the segment count and which segments read as done all come from lib/journey,
// so a step that is flag-disabled or unbuilt simply is not shown and the
// numbering closes up behind it.
//
// Server component — the journey is decided by env flags at render time.
// =============================================================================

/**
 * Just the "Step N of M" label and the segment bar — for pages that already own
 * their heading and intro copy. Existing journey pages drop this in where their
 * hand-written step chrome used to be.
 */
export function JourneyProgress({
  stepKey,
  projectId,
}: {
  stepKey: JourneyStepKey;
  projectId: string | null;
}) {
  const flags = journeyFlagsFromEnv();
  const steps = journeySteps(flags);
  const current = journeyStep(stepKey, flags);
  const label = stepLabel(stepKey, flags);

  return (
    <>
      {label && <p className="label-caps mb-md text-brass-600">{label}</p>}
      <nav aria-label="Project journey" className="mb-xl">
        <ol className="flex gap-sm">
          {steps.map((s) => {
            const done = current ? s.number < current.number : false;
            const active = current ? s.number === current.number : false;
            const seg = (
              <span
                className={
                  "block h-1 rounded-full transition-colors " +
                  (done || active ? "bg-brass-600" : "bg-bone")
                }
              />
            );
            return (
              <li key={s.key} className="flex-1">
                {projectId && !active ? (
                  <Link
                    href={s.href(projectId)}
                    title={`${s.label} — ${s.blurb}`}
                    className="focus-ring block rounded-full py-1"
                  >
                    <span className="sr-only">{`Step ${s.number}: ${s.label}`}</span>
                    {seg}
                  </Link>
                ) : (
                  <span className="block py-1" title={`${s.label} — ${s.blurb}`}>
                    <span className="sr-only">
                      {`Step ${s.number}: ${s.label}${active ? " (current)" : ""}`}
                    </span>
                    {seg}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}

export function JourneyChrome({
  stepKey,
  projectId,
  title,
  intro,
}: {
  stepKey: JourneyStepKey;
  /** null on the pre-project intake step (no project to link to yet). */
  projectId: string | null;
  title: string;
  intro?: string;
}) {
  const flags = journeyFlagsFromEnv();
  const steps = journeySteps(flags);
  const current = journeyStep(stepKey, flags);
  const label = stepLabel(stepKey, flags);

  return (
    <header className="mb-2xl">
      {label && <p className="label-caps mb-md text-brass-600">{label}</p>}

      <nav aria-label="Project journey" className="mb-xl">
        <ol className="flex gap-sm">
          {steps.map((s) => {
            const done = current ? s.number < current.number : false;
            const active = current ? s.number === current.number : false;
            const seg = (
              <span
                className={
                  "block h-1 rounded-full transition-colors " +
                  (done || active ? "bg-brass-600" : "bg-bone")
                }
              />
            );
            return (
              <li key={s.key} className="flex-1">
                {projectId && !active ? (
                  <Link
                    href={s.href(projectId)}
                    title={`${s.label} — ${s.blurb}`}
                    className="focus-ring block rounded-full py-1"
                  >
                    <span className="sr-only">{`Step ${s.number}: ${s.label}`}</span>
                    {seg}
                  </Link>
                ) : (
                  <span className="block py-1" title={`${s.label} — ${s.blurb}`}>
                    <span className="sr-only">
                      {`Step ${s.number}: ${s.label}${active ? " (current)" : ""}`}
                    </span>
                    {seg}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <h1 className="mb-md font-display text-headline-lg text-ink-900">{title}</h1>
      {intro && (
        <p className="max-w-[720px] font-body text-body-lg text-on-surface-variant">
          {intro}
        </p>
      )}
    </header>
  );
}
