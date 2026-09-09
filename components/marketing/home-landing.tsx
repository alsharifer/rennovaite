import Link from "next/link";

import { WatchDemoButton } from "@/app/_components/watch-demo";
import { journeyFlagsFromEnv, journeySteps } from "@/lib/journey";
import { Footer } from "@/components/marketing/Footer";
import { TopNav } from "@/components/marketing/TopNav";

// The RennovAIte marketing homepage. Extracted from app/page.tsx so it can be
// rendered both at `/rennovaite` (its permanent home) and at `/` when the
// PROPERTY_OS_LANDING flag is off (unchanged from before the flag).

// Catalogue sources, NOT commercial partners. These names appear because
// their published prices feed the BoQ — nothing more. The strip is labelled to
// say exactly that; a bare logo wall would imply a relationship none of them
// has agreed to.
const CATALOGUE_SOURCES = [
  "BRKZ",
  "DANUBE HOME",
  "IKEA UAE",
  "SAINT-GOBAIN GYPROC",
  "HOME CENTRE",
];

// The steps come from lib/journey.ts — the same module the app numbers its
// pages from. A hand-written list here is how the page ended up announcing five
// steps above three cards while the product ran nine: two sources, no way for
// either to notice the other had moved.
//
// Reading the real list also makes the count flag-aware for free. Turn
// DRAWINGS_ENABLED off and the Downloads card disappears from BOTH the app
// numbering and this page, because there is only one list.

const STATS = [
  { label: "BoQ format", value: "POMI sections" },
  { label: "Currency", value: "AED, local rates" },
  { label: "Calibrated against", value: "1 completed villa" },
];

export function HomeLanding() {
  // Flag-aware: journeySteps() drops any step this deployment does not have and
  // renumbers what remains, so the count below is always what a user will meet.
  const steps = journeySteps(journeyFlagsFromEnv());

  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />

      <main className="mx-auto max-w-[1440px]">
        {/* HERO -------------------------------------------------------- */}
        <section className="grid min-h-[92vh] grid-cols-12 items-center gap-gutter px-margin pt-24">
          <div className="col-span-12 flex flex-col items-start gap-md lg:col-span-6">
            <span className="label-caps text-brass-600 tracking-[0.2em]">
              Renovation, reimagined
            </span>
            <h1 className="font-display text-display-hero text-ink-900">
              From your floorplan to a tender-ready renovation package in five
              days.
            </h1>
            <p className="mt-xs max-w-[540px] font-body text-body-lg text-on-surface-variant">
              Tender-ready means: design renders, an itemised bill of quantities
              in AED, drawings and a permit check &mdash; ready for contractors
              to bid. Built for Dubai owners.
            </p>
            <div className="mt-xl flex flex-wrap items-center gap-md">
              <Link
                href="/project/new"
                className="focus-ring flex h-[56px] items-center rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm text-on-primary transition-all hover:brightness-110 active:scale-[0.98]"
              >
                Start a project
              </Link>
              <WatchDemoButton />
            </div>
            <p className="label-caps mt-md text-ink-500">
              No card required. You pay only when you lock a BoQ.
            </p>
          </div>

          <div className="col-span-12 lg:col-span-6">
            <div className="matte-image shadow-level-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero-villa.png"
                alt="Editorial photograph of a renovated Arabian Ranches villa living room"
                className="aspect-[4/3] w-full rounded-lg object-cover"
              />
            </div>
          </div>
        </section>

        {/* TRUSTED STRIP ---------------------------------------------- */}
        <div className="flex flex-col items-center justify-center gap-xs border-y border-ink-100 px-margin py-lg">
          <span className="label-caps text-ink-500">
            Priced from supplier catalogues and real project quotations
          </span>
          <div className="flex flex-wrap items-center justify-center gap-xl font-body text-body-sm text-on-surface-variant">
            {CATALOGUE_SOURCES.map((name, i) => (
              <span key={name} className="flex items-center gap-xl">
                <span className="tracking-widest">{name}</span>
                {i < CATALOGUE_SOURCES.length - 1 && (
                  <span
                    className="size-1 rounded-full bg-bone"
                    aria-hidden="true"
                  />
                )}
              </span>
            ))}
          </div>
        </div>

        {/* HOW IT WORKS ----------------------------------------------- */}
        <section id="how-it-works" className="px-margin py-3xl">
          <div className="mb-xl">
            <span className="label-caps text-brass-600 tracking-[0.2em]">
              The flow
            </span>
            <h2 className="mt-xs font-display text-headline-lg italic text-ink-900">
              {steps.length} steps. One villa. Zero spreadsheets.
            </h2>
            <p className="mt-sm max-w-[620px] font-body text-body-md text-on-surface-variant">
              The same {steps.length} steps you will see numbered inside the
              app &mdash; this page reads them from the product, so the two
              cannot disagree.
            </p>
          </div>
          <div className="grid grid-cols-12 gap-gutter">
            {steps.map((step) => (
              <div
                key={step.key}
                className="col-span-12 flex flex-col gap-sm rounded-lg border border-ink-100 bg-paper p-6 transition-shadow duration-300 hover:shadow-level-1 sm:col-span-6 md:col-span-4"
              >
                <div className="flex items-center gap-sm">
                  <span className="font-mono text-body-sm tabular-nums text-brass-600">
                    {String(step.number).padStart(2, "0")}
                  </span>
                  <span
                    className="material-symbols-outlined text-[22px] text-brass-600"
                    aria-hidden="true"
                  >
                    {step.glyph}
                  </span>
                </div>
                <h3 className="font-display text-headline-md text-ink-900">
                  {step.label}
                </h3>
                <p className="font-body text-body-md text-ink-700">
                  {step.blurb}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* SAMPLE PROJECT --------------------------------------------- */}
        <section className="bg-surface-container-low px-margin py-3xl">
          <div className="grid grid-cols-12 items-center gap-gutter">
            <div className="col-span-12 lg:col-span-7">
              <div className="matte-image shadow-level-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/canonical-villa-plan.png"
                  alt="Clean architectural floorplan of a Dubai villa, Arabian Ranches Type 3E"
                  className="aspect-video w-full rounded-lg object-cover"
                />
              </div>
            </div>
            <div className="col-span-12 flex flex-col gap-lg lg:col-span-5 lg:pl-xl">
              <div>
                <span className="label-caps text-brass-600 tracking-[0.2em]">
                  The canonical villa
                </span>
                <h2 className="mt-xs font-display text-headline-lg text-ink-900">
                  Arabian Ranches Type 3E · 360 m² · AED 850k budget.
                </h2>
              </div>
              <div className="flex flex-col gap-md border-t border-bone pt-xl">
                {STATS.map((stat) => (
                  <div
                    key={stat.label}
                    className="flex items-end justify-between"
                  >
                    <span className="label-caps text-ink-500">
                      {stat.label}
                    </span>
                    <span className="font-display text-headline-lg text-ink-900">
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
              <p className="font-body text-body-md text-ink-700">
                Every rate traces to a supplier catalogue, a real project
                quotation, or a flagged allowance awaiting QS review &mdash;
                and the BoQ shows you which.
              </p>
            </div>
          </div>
        </section>

        {/* PRICING ---------------------------------------------------- */}
        <section id="pricing" className="px-margin py-3xl text-center">
          <div className="mx-auto max-w-[720px]">
            <span className="label-caps text-brass-600 tracking-[0.2em]">
              Pricing
            </span>
            <h2 className="mb-xl mt-xs font-display text-headline-lg text-ink-900">
              One project fee. No subscription, no design retainer.
            </h2>
            <div className="w-full rounded-xl border border-ink-100 bg-paper p-xl shadow-level-1">
              <span className="label-caps text-ink-500">Project fee</span>
              <div className="my-md font-display text-[56px] leading-none text-ink-900">
                AED 1,000
              </div>
              <p className="mb-xl font-body text-body-md text-ink-700">
                at BoQ lock, credited in full when you execute through the
                platform.
              </p>
              <div className="flex flex-col gap-md">
                <Link
                  href="/project/new"
                  className="focus-ring flex h-[56px] items-center justify-center rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm text-on-primary transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  Start a project
                </Link>
                <a
                  href="mailto:hello@rennovaite.fit"
                  className="focus-ring flex h-[56px] items-center justify-center rounded-lg border border-ink-100 bg-paper px-xl font-body-sm text-body-sm text-ink-900 transition-all hover:bg-canvas"
                >
                  Talk to a designer first
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
