"use client";

// =============================================================================
// components/blueprint/plan/PlotSizeFields.tsx — the plot's width × depth, the
// scale of a drawn plan (G1). The Blueprint input (K8 #12); the parsing lives
// in lib/plan/plot.ts so it can be unit-tested.
// =============================================================================

import { MAX_PLOT_M, MIN_PLOT_M, parsePlot, type PlotDraft } from "@/lib/plan/plot";

const INPUT =
  "t-num-md h-11 w-32 rounded-none border border-bp-line-control bg-bp-surface-raised px-3 text-bp-ink-primary placeholder:text-bp-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring disabled:text-bp-ink-tertiary";

export function PlotSizeFields({ value, onChange, idPrefix = "plot", disabled = false }: { value: PlotDraft; onChange: (next: PlotDraft) => void; idPrefix?: string; disabled?: boolean }) {
  const plot = parsePlot(value);
  const touched = value.width !== "" && value.depth !== "";
  const hint = `${idPrefix}-plot-hint`;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        {(["width", "depth"] as const).map((side, i) => (
          <div key={side} className="flex items-end gap-4">
            {i === 1 ? (
              <span className="t-num-md pb-3 text-bp-ink-tertiary" aria-hidden="true">
                ×
              </span>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idPrefix}-${side}`} className="t-label-caps text-bp-ink-tertiary">
                {side === "width" ? "PLOT WIDTH (M)" : "PLOT DEPTH (M)"}
              </label>
              <input
                id={`${idPrefix}-${side}`}
                type="number"
                inputMode="decimal"
                min={MIN_PLOT_M}
                max={MAX_PLOT_M}
                step="0.1"
                value={value[side]}
                disabled={disabled}
                aria-describedby={hint}
                aria-invalid={touched && !plot ? true : undefined}
                onChange={(e) => onChange({ ...value, [side]: e.target.value })}
                className={INPUT}
                placeholder={side === "width" ? "18.0" : "12.0"}
              />
            </div>
          </div>
        ))}
        {plot ? <p className="t-num-md pb-3 text-bp-ink-secondary">= {(plot.plot_width_m * plot.plot_depth_m).toFixed(1)} m²</p> : null}
      </div>
      <p id={hint} className="t-body-sm mt-2 text-bp-ink-secondary">
        {touched && !plot
          ? `Both sides must be between ${MIN_PLOT_M} and ${MAX_PLOT_M} metres.`
          : "This is the drawing’s scale, so everything you draw comes out in real metres. Measure it once — on site or off the title deed."}
      </p>
    </div>
  );
}
