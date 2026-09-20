import { describe, expect, it } from "vitest";

import { EMPTY_PLOT, MAX_PLOT_M, MIN_PLOT_M, parsePlot } from "@/lib/plan/plot";

describe("plot size", () => {
  it("returns the keys the API and the plans table use", () => {
    // This is the whole reason the function exists rather than two Number()
    // calls at each call site. When it returned { width_m, depth_m }, both
    // callers spread it into a request body that wanted plot_width_m — and the
    // form posted two undefined numbers behind a valid-looking m² readout.
    expect(parsePlot({ width: "20", depth: "10" })).toEqual({
      plot_width_m: 20,
      plot_depth_m: 10,
    });
  });

  it("is null until both sides are filled in", () => {
    expect(parsePlot(EMPTY_PLOT)).toBeNull();
    expect(parsePlot({ width: "20", depth: "" })).toBeNull();
    expect(parsePlot({ width: "  ", depth: "10" })).toBeNull();
  });

  it("rejects nonsense rather than coercing it", () => {
    // Number("") is 0, which is finite — hence the explicit blank check above.
    expect(parsePlot({ width: "abc", depth: "10" })).toBeNull();
    expect(parsePlot({ width: "-5", depth: "10" })).toBeNull();
  });

  it("holds the plot to a believable size", () => {
    expect(parsePlot({ width: String(MIN_PLOT_M - 0.1), depth: "10" })).toBeNull();
    expect(parsePlot({ width: String(MAX_PLOT_M + 1), depth: "10" })).toBeNull();
    expect(parsePlot({ width: String(MIN_PLOT_M), depth: String(MAX_PLOT_M) })).toEqual({
      plot_width_m: MIN_PLOT_M,
      plot_depth_m: MAX_PLOT_M,
    });
  });

  it("accepts decimals, because plots are not whole metres", () => {
    expect(parsePlot({ width: "18.4", depth: "12.75" })).toEqual({
      plot_width_m: 18.4,
      plot_depth_m: 12.75,
    });
  });
});
