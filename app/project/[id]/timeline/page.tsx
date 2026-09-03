import Link from "next/link";

import { AppShell } from "@/components/app/AppShell";
import { JourneyChrome } from "@/components/app/JourneyChrome";
import { journeyFlagsFromEnv, nextStep } from "@/lib/journey";
import { loadTimeline } from "@/lib/timeline/load";

import { PhasePlan } from "./_components/phase-plan";

export const dynamic = "force-dynamic";

/**
 * Journey step 7 — Scope & timeline. Re-derived on every visit from the
 * project's current take-off and latest BoQ, so it follows accessory picks and
 * plan edits without anyone having to remember to refresh it.
 */
export default async function TimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadTimeline(id);

  const flags = journeyFlagsFromEnv();
  const next = nextStep("scope_timeline", flags);

  return (
    <AppShell pageName="Scope & Timeline">
      <div className="mx-auto max-w-[1100px] pb-2xl">
        <JourneyChrome
          stepKey="scope_timeline"
          projectId={id}
          title="How long will it take?"
          intro="A phase plan scaled from one real Dubai villa refit. Durations are ranges, because a single calibrated project earns an honest estimate — not a promise."
        />

        {data.estimate ? (
          <PhasePlan
            estimate={data.estimate}
            boqHref={`/project/${id}/boq`}
            nextHref={next ? next.href(id) : null}
            nextLabel={next ? `Continue to ${next.label.toLowerCase()}` : ""}
          />
        ) : (
          <section className="rounded-xl border border-dashed border-ink-100 bg-paper p-2xl text-center">
            <span
              className="material-symbols-outlined mb-sm text-[32px] text-ink-500"
              aria-hidden="true"
            >
              calendar_month
            </span>
            <p className="mb-xs font-display text-headline-md italic text-ink-900">
              No phase plan yet.
            </p>
            <p className="mx-auto mb-lg max-w-[54ch] font-body text-body-md text-on-surface-variant">
              {data.blocked}
            </p>
            <Link
              href={`/project/${id}/boq`}
              className="focus-ring inline-flex h-11 items-center rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary hover:bg-primary"
            >
              Go to the BoQ
            </Link>
          </section>
        )}
      </div>
    </AppShell>
  );
}
