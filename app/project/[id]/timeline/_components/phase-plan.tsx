"use client";

// =============================================================================
// phase-plan.tsx — D2 timeline. Horizontal phase bars with ranges.
//
// Three things this view refuses to do:
//   · quote a single day for anything — every bar is a range, because one
//     calibrated project cannot support false precision;
//   · hide where a duration came from — hovering a bar shows its driver, the
//     project's value, Mudon's value and the resulting scale factor, the same
//     provenance habit the BoQ lines follow;
//   · imply a schedule it does not have — these are durations, not dates. No
//     calendar is drawn, because we do not know the start date.
// =============================================================================

import Link from "next/link";
import { useState } from "react";

import type { PhaseEstimate, TimelineEstimate } from "@/lib/timeline/estimate";
import { cn } from "@/lib/utils";

const BAR = "#A4793A";
const BAR_SOFT = "#E8D9BF";

export function PhasePlan({
  estimate,
  boqHref,
  nextHref,
  nextLabel,
}: {
  estimate: TimelineEstimate;
  boqHref: string;
  nextHref: string | null;
  nextLabel: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // The widest possible plan sets the scale, so the bars never overflow.
  const span = Math.max(
    estimate.total_high_days,
    ...estimate.phases.map((p) => p.end_day),
    1,
  );
  const pct = (d: number) => `${(d / span) * 100}%`;

  return (
    <div className="space-y-xl">
      {/* Headline range ------------------------------------------------ */}
      <section className="rounded-xl border border-ink-100 bg-paper p-xl">
        <p className="label-caps mb-sm text-brass-600">Estimated duration</p>
        <p className="font-display text-display-hero leading-none text-ink-900">
          {estimate.total_weeks_low}–{estimate.total_weeks_high}
          <span className="ml-sm font-body text-headline-md text-ink-500">weeks</span>
        </p>
        <p className="mt-sm font-mono text-data-mono tabular-nums text-ink-500">
          {estimate.total_low_days}–{estimate.total_high_days} days ·{" "}
          {estimate.phases.length} phase{estimate.phases.length === 1 ? "" : "s"} on the
          critical path
        </p>
        <p className="mt-lg max-w-[70ch] rounded-lg bg-surface-container-low p-md font-body-sm text-body-sm text-on-surface-variant">
          <span className="material-symbols-outlined mr-1 align-[-4px] text-[18px] text-brass-600">
            info
          </span>
          {estimate.basis}
        </p>
      </section>

      {/* Bars ---------------------------------------------------------- */}
      <section className="rounded-xl border border-ink-100 bg-paper p-lg">
        <div className="mb-lg flex items-baseline justify-between">
          <h2 className="font-display text-headline-md text-ink-900">Phases</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Hover a bar for the driver behind its duration
          </p>
        </div>

        <ol className="space-y-md">
          {estimate.phases.map((p) => (
            <li key={p.key}>
              <PhaseBar
                phase={p}
                pct={pct}
                span={span}
                open={open === p.key}
                onToggle={() => setOpen(open === p.key ? null : p.key)}
              />
            </li>
          ))}
        </ol>

        {/* Day axis — durations, not dates. */}
        <div className="mt-lg flex justify-between border-t border-ink-100 pt-sm font-mono text-[11px] tabular-nums text-ink-500">
          <span>day 0</span>
          <span>day {Math.round(span / 2)}</span>
          <span>day {span}</span>
        </div>
      </section>

      {estimate.excluded.length > 0 && (
        <section className="rounded-xl border border-ink-100 bg-paper p-lg">
          <p className="label-caps mb-sm text-ink-500">Not in this project</p>
          <ul className="space-y-xs">
            {estimate.excluded.map((x) => (
              <li key={x.key} className="font-body-sm text-body-sm text-on-surface-variant">
                <span className="text-ink-900">{x.label}</span> — {x.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-md">
        <Link
          href={boqHref}
          className="focus-ring flex h-12 items-center rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 hover:bg-surface-container"
        >
          Back to the BoQ
        </Link>
        {nextHref && (
          <Link
            href={nextHref}
            className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm font-semibold text-on-primary hover:bg-primary"
          >
            {nextLabel}
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              arrow_forward
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

function PhaseBar({
  phase: p,
  pct,
  span,
  open,
  onToggle,
}: {
  phase: PhaseEstimate;
  pct: (d: number) => string;
  span: number;
  open: boolean;
  onToggle: () => void;
}) {
  // The soft band shows the uncertainty; the solid bar the point estimate.
  const bandStart = p.start_day;
  const bandEnd = p.start_day + p.high_days;

  return (
    <div
      className="group rounded-lg p-sm transition-colors hover:bg-surface-container-low"
      onMouseEnter={onToggle}
      onMouseLeave={onToggle}
    >
      <div className="mb-xs flex flex-wrap items-baseline justify-between gap-sm">
        <span className="font-body text-body-md font-semibold text-ink-900">
          <span className="mr-sm font-mono text-[11px] text-ink-500">
            {String(p.n).padStart(2, "0")}
          </span>
          {p.label}
        </span>
        <span className="flex items-center gap-sm font-mono text-data-mono tabular-nums text-ink-700">
          {p.low_days}–{p.high_days} days
          {p.floored && (
            <span
              className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-semibold text-[#92400E]"
              title="The floor decided this duration, not the project's own quantity."
            >
              minimum
            </span>
          )}
        </span>
      </div>

      {/* Track */}
      <div className="relative h-6 w-full rounded bg-canvas">
        {/* Uncertainty band */}
        <div
          className="absolute top-1 h-4 rounded"
          style={{
            left: pct(bandStart),
            width: pct(Math.max(bandEnd - bandStart, 0.5)),
            background: BAR_SOFT,
          }}
        />
        {/* Point estimate */}
        <div
          className="absolute top-1 h-4 rounded"
          style={{
            left: pct(p.start_day),
            width: pct(Math.max(p.days, 0.5)),
            background: BAR,
          }}
        />
        {/* Low edge marker, so the range reads as a range. */}
        <div
          className="absolute top-0 h-6 w-px bg-ink-900/40"
          style={{ left: pct(p.start_day + p.low_days) }}
          aria-hidden="true"
        />
      </div>

      {/* Provenance — the habit the BoQ lines follow, applied to durations. */}
      <div
        className={cn(
          "overflow-hidden transition-all",
          open ? "mt-sm max-h-40" : "max-h-0",
        )}
      >
        <div className="rounded-lg border border-ink-100 bg-paper p-md">
          <p className="mb-xs font-body-sm text-body-sm text-ink-900">
            <span className="font-semibold">{p.driver_label}</span>{" "}
            <span className="font-mono tabular-nums text-ink-700">
              {p.project_driver_value.toLocaleString("en-US")} {p.driver_unit}
            </span>{" "}
            <span className="text-ink-500">
              vs Mudon&apos;s {p.anchor_driver_value.toLocaleString("en-US")}{" "}
              {p.driver_unit} → ×{p.scale_factor} on a {p.anchor_days}-day anchor
            </span>
          </p>
          <p className="font-body-sm text-[12px] text-on-surface-variant">
            {p.driver_rationale}
          </p>
          <p className="mt-xs font-body-sm text-[11px] italic text-ink-500">
            Milestone: {p.milestone} · derived, not measured
          </p>
        </div>
      </div>
      <span className="sr-only">
        {`Phase ${p.n}, ${p.label}: ${p.low_days} to ${p.high_days} days, driven by ${p.driver_label}. ${p.driver_rationale}`}
      </span>
      <span className="hidden">{span}</span>
    </div>
  );
}
