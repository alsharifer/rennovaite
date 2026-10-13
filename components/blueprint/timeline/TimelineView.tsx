// =============================================================================
// components/blueprint/timeline/TimelineView.tsx — 05 Timeline (K8 #7, spec
// §6.6, Figma 59:837). Server component: the estimate arrives built
// (lib/timeline — re-derived from the take-off and the latest BoQ on every
// read, never stored).
//
// The headline range carries the DERIVED mark — it is scaled from one
// calibrated project, not measured — with the basis in a sunken note. Phase
// bars: ink for the likely duration and ink at 35% for "could run to", from
// each phase's start on the critical path, on a hairline track (brass draws
// lines only — never a bar). Hover or focus a phase → the driver behind its
// duration. Phases the project has no work for are listed as not in it.
// =============================================================================

import type { TimelineEstimate } from "@/lib/timeline/estimate";
import { tierLabel } from "@/lib/provenance/tier-vocab";

import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));

export function TimelineView({ estimate: e }: { estimate: TimelineEstimate }) {
  // The axis runs to the critical path's "could run to" total, as the frame draws it.
  const span = Math.max(1, Math.ceil(e.total_high_days), ...e.phases.map((p) => Math.ceil(p.start_day + p.high_days)));
  const pct = (d: number) => `${(d / span) * 100}%`;
  const mid = Math.round(span / 2);
  return (
    <div>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-10">
        <div>
          <p className="t-label-caps text-bp-ink-tertiary">ESTIMATED DURATION</p>
          <p className="mt-1.5 flex items-center gap-2.5" data-timeline-weeks={`${e.total_weeks_low}-${e.total_weeks_high}`}>
            <span aria-hidden="true" className="t-num-xl text-bp-ink-primary">
              {e.total_weeks_low}–{e.total_weeks_high} weeks
            </span>
            <ProvenanceMark tier="derived" />
            <span className="sr-only">
              {e.total_weeks_low} to {e.total_weeks_high} weeks, {tierLabel("derived", "owner").toLowerCase()}
            </span>
          </p>
          <p className="t-label-md mt-1.5 font-bp-mono text-bp-ink-tertiary">
            {e.total_low_days}–{e.total_high_days} working days · {e.phases.length} phase{e.phases.length === 1 ? "" : "s"} on the critical path
          </p>
        </div>
        <p className="t-body-sm flex max-w-[520px] items-start gap-2.5 bg-bp-surface-sunken px-3.5 py-3 text-bp-ink-secondary">
          <Icon name="info" className="text-[20px]" />
          {e.basis}
        </p>
      </div>

      <section aria-labelledby="phases-h" className="mt-8">
        <div className="flex flex-wrap items-center gap-4 border-b-2 border-bp-line-strong pb-2.5">
          <h2 id="phases-h" className="t-heading-md flex-1 text-bp-ink-primary">
            Phases
          </h2>
          <span className="flex items-center gap-3.5" aria-hidden="true">
            <span className="h-2 w-[18px] bg-bp-ink-primary" />
            <span className="t-label-md font-bp-mono text-bp-ink-tertiary">likely</span>
            <span className="h-2 w-[18px] bg-bp-ink-tertiary opacity-35" />
            <span className="t-label-md font-bp-mono text-bp-ink-tertiary">could run to</span>
          </span>
        </div>
        <ol>
          {e.phases.map((p) => {
            const tip = `phase-${p.key}-driver`;
            return (
              <li key={p.key} className="group relative border-b border-bp-line-hairline" data-phase={p.key}>
                <div tabIndex={0} aria-describedby={tip} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 outline-offset-2 md:grid-cols-[32px_220px_minmax(0,1fr)_96px]">
                  <span className="t-label-md font-bp-mono text-bp-ink-tertiary">{String(p.n).padStart(2, "0")}</span>
                  <span className="t-body-sm text-bp-ink-primary">{p.label}</span>
                  <span className="relative col-span-3 h-2.5 md:col-span-1 md:col-start-3 md:row-start-1" aria-hidden="true">
                    <span className="absolute inset-x-0 top-[5px] h-px bg-bp-line-hairline" />
                    <span className="absolute top-0 h-2.5 bg-bp-ink-tertiary opacity-35" style={{ left: pct(p.start_day), width: pct(p.high_days) }} />
                    <span className="absolute top-0 h-2.5 bg-bp-ink-primary" style={{ left: pct(p.start_day), width: pct(p.low_days) }} />
                  </span>
                  <span className="t-num-sm text-right text-bp-ink-primary md:col-start-4 md:row-start-1">
                    {p.low_days}–{p.high_days} days
                  </span>
                </div>
                <div id={tip} role="tooltip" className="pointer-events-none invisible absolute right-0 top-full z-10 w-[320px] border border-bp-line-hairline bg-bp-surface-raised p-3 opacity-0 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <span className="t-label-caps block text-bp-ink-tertiary">WHAT SETS THIS PHASE</span>
                  <span className="t-body-sm mt-1 block text-bp-ink-primary">
                    {p.driver_label}: {fmt(p.project_driver_value)} {p.driver_unit} here, {fmt(p.anchor_driver_value)} on the reference project ({p.anchor_days} days).
                  </span>
                  <span className="t-body-sm mt-1 block text-bp-ink-secondary">{p.floored ? "The phase's minimum length decided it, not the quantity." : p.driver_rationale}</span>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] gap-x-4 pt-2 md:grid-cols-[32px_220px_minmax(0,1fr)_96px]" aria-hidden="true">
          <span className="hidden md:block" />
          <span className="hidden md:block" />
          <span className="t-label-md col-span-3 flex justify-between font-bp-mono text-bp-ink-tertiary md:col-span-1">
            <span>day 0</span>
            <span>day {mid}</span>
            <span>day {span}</span>
          </span>
        </div>
      </section>

      {e.excluded.length ? (
        <section aria-labelledby="not-in-h" className="mt-8 border border-bp-line-hairline px-4 py-3.5">
          <h2 id="not-in-h" className="t-label-caps text-bp-ink-tertiary">
            NOT IN THIS PROJECT
          </h2>
          <ul className="mt-1.5">
            {e.excluded.map((x) => (
              <li key={x.key} className="t-body-sm text-bp-ink-primary">
                {x.label} — {x.sections.length === 1 ? `no ${x.sections[0]!.toLowerCase()}` : "none of its work"} in your cost, so the phase is left out.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
