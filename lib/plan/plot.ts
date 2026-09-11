// =============================================================================
// lib/plan/plot.ts — the two numbers that make a drawn plan metric (G1).
//
// A drawn plan has no scale bar and no sheet to read one off, so the plot IS
// the scale: a zone's area is its share of the canvas times the plot the user
// measured. Nothing downstream can invent it, which is why both fields are
// required rather than optional-with-a-default — a defaulted plot produces
// confident areas that are simply wrong.
//
// Pure and separate from the input component so it can be unit-tested, and so
// its keys have one definition. They are named for the API body and the `plans`
// columns on purpose: a call site spreads this result straight into a request,
// and when the names did not match, the form posted two undefined numbers
// behind a valid-looking m² readout.
// =============================================================================

export interface PlotDraft {
  width: string;
  depth: string;
}

export const EMPTY_PLOT: PlotDraft = { width: "", depth: "" };

/** Metres. A 2 m plot is a typo; a 500 m plot is a site, not a villa. */
export const MIN_PLOT_M = 2;
export const MAX_PLOT_M = 500;

export interface PlotSize {
  plot_width_m: number;
  plot_depth_m: number;
}

/** Parse a draft into metres, or null when it is not yet usable. */
export function parsePlot(draft: PlotDraft): PlotSize | null {
  if (draft.width.trim() === "" || draft.depth.trim() === "") return null;
  const plot_width_m = Number(draft.width);
  const plot_depth_m = Number(draft.depth);
  if (!Number.isFinite(plot_width_m) || !Number.isFinite(plot_depth_m)) return null;
  if (plot_width_m < MIN_PLOT_M || plot_depth_m < MIN_PLOT_M) return null;
  if (plot_width_m > MAX_PLOT_M || plot_depth_m > MAX_PLOT_M) return null;
  return { plot_width_m, plot_depth_m };
}
