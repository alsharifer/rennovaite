// =============================================================================
// components/blueprint/timeline/TimelineView.tsx — 05 Timeline (K8 #7, spec
// §6.6, Figma 59:837). Server component.
//
// C4: ONE programme for every project — `programmeOf` over the latest BoQ
// (lib/timeline/programme.ts), the same function the Overview, the BoQ page,
// the BoQ PDF, the proposal and the room pack read. The headline is the one
// number ("≈ N working days (low–high)") with the DERIVED mark and the basis in
// a sunken note; phases are ink bars on a hairline track (brass draws lines
// only — never a bar), a phase that runs alongside another drawn at 35%. Hover
// or focus a phase → how its days were derived (quantity ÷ productivity).
// =============================================================================

import type { Programme } from "@/lib/timeline/programme";
import { programmeLabel } from "@/lib/timeline/programme";
import { tierLabel } from "@/lib/provenance/tier-vocab";

import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";

export function TimelineView({ programme: p }: { programme: Programme }) {
  const span = Math.max(1, p.total_days, ...p.phases.map((ph) => ph.start_day + ph.days));
  const pct = (d: number) => `${(d / span) * 100}%`;
  const mid = Math.round(span / 2);
  return (
    <div data-programme>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-10">
        <div>
          <p className="t-label-caps text-bp-ink-tertiary">ESTIMATED DURATION</p>
          <p className="mt-1.5 flex items-center gap-2.5" data-timeline-days={p.total_days}>
            <span aria-hidden="true" className="t-num-xl text-bp-ink-primary">
              {programmeLabel(p)}
            </span>
            <ProvenanceMark tier="derived" />
            <span className="sr-only">
              About {p.total_days} working days, {p.low_days} to {p.high_days}, {tierLabel("derived", "owner").toLowerCase()}
            </span>
          </p>
          <p className="t-label-md mt-1.5 font-bp-mono text-bp-ink-tertiary">
            {p.phases.length} phase{p.phases.length === 1 ? "" : "s"} · indicative · lead times excluded
          </p>
        </div>
        <p className="t-body-sm flex max-w-[520px] items-start gap-2.5 bg-bp-surface-sunken px-3.5 py-3 text-bp-ink-secondary" data-programme-basis>
          <Icon name="info" className="text-[20px]" />
          {p.basis}
        </p>
      </div>

      <section aria-labelledby="phases-h" className="mt-8">
        <div className="flex flex-wrap items-center gap-4 border-b-2 border-bp-line-strong pb-2.5">
          <h2 id="phases-h" className="t-heading-md flex-1 text-bp-ink-primary">
            Phases
          </h2>
          <span className="flex items-center gap-3.5" aria-hidden="true">
            <span className="h-2 w-[18px] bg-bp-ink-primary" />
            <span className="t-label-md font-bp-mono text-bp-ink-tertiary">in sequence</span>
            <span className="h-2 w-[18px] bg-bp-ink-tertiary opacity-35" />
            <span className="t-label-md font-bp-mono text-bp-ink-tertiary">alongside</span>
          </span>
        </div>
        <ol>
          {p.phases.map((ph, i) => {
            const tip = `phase-${i}-basis`;
            return (
              <li key={`${ph.label}-${i}`} className="group relative border-b border-bp-line-hairline" data-phase={ph.label}>
                <div tabIndex={0} aria-describedby={tip} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 outline-offset-2 md:grid-cols-[32px_260px_minmax(0,1fr)_96px]">
                  <span className="t-label-md font-bp-mono text-bp-ink-tertiary">{String(i + 1).padStart(2, "0")}</span>
                  <span className="t-body-sm text-bp-ink-primary">{ph.label}</span>
                  <span className="relative col-span-3 h-2.5 md:col-span-1 md:col-start-3 md:row-start-1" aria-hidden="true">
                    <span className="absolute inset-x-0 top-[5px] h-px bg-bp-line-hairline" />
                    <span className={`absolute top-0 h-2.5 ${ph.parallel ? "bg-bp-ink-tertiary opacity-35" : "bg-bp-ink-primary"}`} style={{ left: pct(ph.start_day), width: pct(ph.days) }} />
                  </span>
                  <span className="t-num-sm text-right text-bp-ink-primary md:col-start-4 md:row-start-1">
                    {ph.days} day{ph.days === 1 ? "" : "s"}
                  </span>
                </div>
                <div id={tip} role="tooltip" className="pointer-events-none invisible absolute right-0 top-full z-10 w-[320px] border border-bp-line-hairline bg-bp-surface-raised p-3 opacity-0 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <span className="t-label-caps block text-bp-ink-tertiary">HOW ITS DAYS ARE DERIVED</span>
                  <span className="t-body-sm mt-1 block text-bp-ink-primary">{ph.basis}</span>
                  {ph.parallel ? <span className="t-body-sm mt-1 block text-bp-ink-secondary">Runs alongside another phase — it does not add to the total.</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] gap-x-4 pt-2 md:grid-cols-[32px_260px_minmax(0,1fr)_96px]" aria-hidden="true">
          <span className="hidden md:block" />
          <span className="hidden md:block" />
          <span className="t-label-md col-span-3 flex justify-between font-bp-mono text-bp-ink-tertiary md:col-span-1">
            <span>day 0</span>
            <span>day {mid}</span>
            <span>day {span}</span>
          </span>
        </div>
      </section>
    </div>
  );
}
