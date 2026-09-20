import { describe, expect, it } from "vitest";

import {
  LINEAR_ELEMENT_META,
  buildLinearElements,
  isLinearElementKind,
  lengthByKind,
  polylineLength,
  toPolyline,
} from "@/lib/plan/elements";

/** Identity conversion — element maths is tested in its own coordinate space. */
const asIs = (p: [number, number]): [number, number] => p;
/** A 10 m-per-unit plan, so normalised lengths read as round metres. */
const times10 = (p: [number, number]): [number, number] => [p[0] * 10, p[1] * 10];

describe("linear elements", () => {
  it("measures a polyline including its corners", () => {
    // A bench that turns a corner is longer than the straight line between its
    // ends, which is the whole reason runs are polylines and not segments.
    expect(polylineLength([[0, 0], [3, 0], [3, 4]])).toBe(7);
    expect(polylineLength([[0, 0], [3, 4]])).toBe(5);
    expect(polylineLength([[0, 0]])).toBe(0);
  });

  it("rejects polylines that are not two or more real points", () => {
    expect(toPolyline([[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
    expect(toPolyline([[0, 0]])).toBeNull();
    expect(toPolyline([[0, 0], [1, "x"]])).toBeNull();
    expect(toPolyline([[0, 0], [1, Number.NaN]])).toBeNull();
    expect(toPolyline("nope")).toBeNull();
  });

  it("guards the kind vocabulary", () => {
    expect(isLinearElementKind("bench_run")).toBe(true);
    expect(isLinearElementKind("pergola")).toBe(false);
  });

  it("converts to metres through the graph's own mapping", () => {
    const [el] = buildLinearElements(
      [{ id: "e1", kind: "bench_run", polyline: [[0, 0], [0.4, 0]] }],
      times10,
    );
    expect(el!.length_m).toBe(4);
    expect(el!.polyline).toEqual([[0, 0], [4, 0]]);
  });

  it("flags a defaulted cross-section as derived and a measured one as not", () => {
    const [defaulted, measured] = buildLinearElements(
      [
        { id: "e1", kind: "planter_run", polyline: [[0, 0], [1, 0]] },
        {
          id: "e2",
          kind: "planter_run",
          polyline: [[0, 0], [1, 0]],
          height_mm: 500,
          width_mm: 350,
        },
      ],
      asIs,
    );
    // A run nobody measured must never read as a measured quantity.
    expect(defaulted!.derived).toBe(true);
    expect(defaulted!.height_mm).toBe(LINEAR_ELEMENT_META.planter_run.defaultHeightMm);
    expect(measured!.derived).toBe(false);
    expect(measured!.height_mm).toBe(500);
  });

  it("drops unusable rows rather than inventing geometry", () => {
    const out = buildLinearElements(
      [
        { id: "bad", kind: "bench_run", polyline: [[0, 0]] },
        { id: "good", kind: "bench_run", polyline: [[0, 0], [2, 0]] },
      ],
      asIs,
    );
    expect(out.map((e) => e.id)).toEqual(["good"]);
  });

  it("totals linear metres per kind", () => {
    const els = buildLinearElements(
      [
        { id: "a", kind: "bench_run", polyline: [[0, 0], [0.3, 0]] },
        { id: "b", kind: "bench_run", polyline: [[0, 1], [0.2, 1]] },
        { id: "c", kind: "boundary_wall", polyline: [[0, 0], [1, 0]] },
      ],
      times10,
    );
    const totals = lengthByKind(els);
    expect(totals.bench_run).toBe(5);
    expect(totals.boundary_wall).toBe(10);
    expect(totals.counter_run).toBe(0);
  });
});
