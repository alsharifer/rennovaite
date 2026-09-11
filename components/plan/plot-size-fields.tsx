"use client";

// The parsing lives in lib/plan/plot.ts so it can be unit-tested; this file is
// only the input. Re-exported so call sites import the pair from one place.
import {
  MAX_PLOT_M,
  MIN_PLOT_M,
  parsePlot,
  type PlotDraft,
} from "@/lib/plan/plot";

export { EMPTY_PLOT, parsePlot, type PlotDraft, type PlotSize } from "@/lib/plan/plot";

export function PlotSizeFields({
  value,
  onChange,
  idPrefix = "plot",
  disabled = false,
}: {
  value: PlotDraft;
  onChange: (next: PlotDraft) => void;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const plot = parsePlot(value);
  const touched = value.width !== "" && value.depth !== "";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-md">
        <div>
          <label
            htmlFor={`${idPrefix}-width`}
            className="label-caps mb-xs block text-ink-500"
          >
            Plot width (m)
          </label>
          <input
            id={`${idPrefix}-width`}
            type="number"
            inputMode="decimal"
            min={MIN_PLOT_M}
            max={MAX_PLOT_M}
            step="0.1"
            value={value.width}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, width: e.target.value })}
            className="focus-ring h-11 w-32 rounded border border-ink-100 bg-paper px-3 font-mono tabular-nums text-body-sm text-ink-900"
            placeholder="18.0"
          />
        </div>
        <span className="pb-3 font-mono text-body-sm text-ink-500" aria-hidden="true">
          ×
        </span>
        <div>
          <label
            htmlFor={`${idPrefix}-depth`}
            className="label-caps mb-xs block text-ink-500"
          >
            Plot depth (m)
          </label>
          <input
            id={`${idPrefix}-depth`}
            type="number"
            inputMode="decimal"
            min={MIN_PLOT_M}
            max={MAX_PLOT_M}
            step="0.1"
            value={value.depth}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, depth: e.target.value })}
            className="focus-ring h-11 w-32 rounded border border-ink-100 bg-paper px-3 font-mono tabular-nums text-body-sm text-ink-900"
            placeholder="12.0"
          />
        </div>
        {plot && (
          <p className="pb-3 font-mono text-body-sm text-ink-500">
            = {(plot.plot_width_m * plot.plot_depth_m).toFixed(1)} m²
          </p>
        )}
      </div>
      <p className="mt-sm font-body-sm text-body-sm text-on-surface-variant">
        {touched && !plot
          ? `Both sides must be between ${MIN_PLOT_M} and ${MAX_PLOT_M} metres.`
          : "This is the drawing's scale, so every zone you draw comes out in real metres. Measure it once, off site or off the title deed."}
      </p>
    </div>
  );
}
