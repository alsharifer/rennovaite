import Link from "next/link";

import { Footer } from "@/components/marketing/Footer";
import { TopNav } from "@/components/marketing/TopNav";

import { WatchDemoButton } from "./_components/watch-demo";

const TRUSTED = [
  "BRKZ",
  "DANUBE HOME",
  "IKEA UAE",
  "SAINT-GOBAIN GYPROC",
  "HOME CENTRE",
];

const STEPS = [
  {
    n: "01",
    icon: "upload_file",
    title: "Upload your plan.",
    body: "Direct digital intake of your technical drawings. Our AI understands every wall, window, and socket.",
  },
  {
    n: "02",
    icon: "brush",
    title: "Choose your direction.",
    body: "Select from curated aesthetics or build your own. AI generates high-fidelity visual renders instantly.",
  },
  {
    n: "03",
    icon: "receipt_long",
    title: "Lock the BoQ.",
    body: "Receive a precise, local-market bill of quantities in AED. Real prices from local suppliers.",
  },
];

const STATS = [
  { label: "BoQ Precision", value: "AED 587,400" },
  { label: "Design Delivery", value: "6 hours" },
  { label: "Execution Team", value: "3 vetted" },
];

export default function Home() {
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
              From your floorplan to a built villa, in five days.
            </h1>
            <p className="mt-xs max-w-[540px] font-body text-body-lg text-on-surface-variant">
              RennovAIte turns your villa&apos;s drawings into photoreal
              designs, a real bill of quantities in AED, and three vetted
              contractors ready to bid. Built for Dubai owners.
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
              No card required. Average first-render in under 6 minutes.
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
        <div className="flex h-24 items-center justify-center border-y border-ink-100 px-margin">
          <div className="flex items-center gap-xl font-body text-body-sm text-on-surface-variant">
            {TRUSTED.map((name, i) => (
              <span key={name} className="flex items-center gap-xl">
                <span className="tracking-widest">{name}</span>
                {i < TRUSTED.length - 1 && (
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
        <section className="px-margin py-3xl">
          <div className="mb-xl">
            <span className="label-caps text-brass-600 tracking-[0.2em]">
              The flow
            </span>
            <h2 className="mt-xs font-display text-headline-lg italic text-ink-900">
              Five steps. One villa. Zero spreadsheets.
            </h2>
          </div>
          <div className="grid grid-cols-12 gap-gutter">
            {STEPS.map((step) => (
              <div
                key={step.n}
                className="col-span-12 flex flex-col gap-md rounded-lg border border-ink-100 bg-paper p-8 transition-shadow duration-300 hover:shadow-level-1 md:col-span-4"
              >
                <span className="font-display text-headline-lg-mobile text-brass-600">
                  {step.n}
                </span>
                <span
                  className="material-symbols-outlined text-[32px] text-brass-600"
                  aria-hidden="true"
                >
                  {step.icon}
                </span>
                <h3 className="font-display text-headline-md text-ink-900">
                  {step.title}
                </h3>
                <p className="font-body text-body-md text-ink-700">
                  {step.body}
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
              <p className="font-body text-body-md italic text-ink-700">
                &ldquo;The accuracy of the bill of quantities allowed us to
                start construction two weeks earlier than our previous manual
                processes.&rdquo;
              </p>
            </div>
          </div>
        </section>

        {/* PRICING ---------------------------------------------------- */}
        <section className="px-margin py-3xl text-center">
          <div className="mx-auto max-w-[720px]">
            <span className="label-caps text-brass-600 tracking-[0.2em]">
              Pricing
            </span>
            <h2 className="mb-xl mt-xs font-display text-headline-lg text-ink-900">
              One platform fee. No design retainer.
            </h2>
            <div className="w-full rounded-xl border border-ink-100 bg-paper p-xl shadow-level-1">
              <span className="label-caps text-ink-500">
                Standard Project Fee
              </span>
              <div className="my-md font-display text-[56px] leading-none text-ink-900">
                AED 2,500
              </div>
              <p className="mb-xl font-body text-body-md text-ink-700">
                paid once your BoQ is locked and contractors are invited.
              </p>
              <div className="flex flex-col gap-md">
                <Link
                  href="/project/new"
                  className="focus-ring flex h-[56px] items-center justify-center rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm text-on-primary transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  Start a project
                </Link>
                <Link
                  href="#"
                  className="focus-ring flex h-[56px] items-center justify-center rounded-lg border border-ink-100 bg-paper px-xl font-body-sm text-body-sm text-ink-900 transition-all hover:bg-canvas"
                >
                  Talk to a designer first
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
