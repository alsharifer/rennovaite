import { describe, expect, it } from "vitest";

import { buildParity, manifestIds, parityTableText, sheetIds, type ParityElement, type ParityInput } from "@/lib/documents/parity";

const zone = (id: string, kind: string, status: ParityElement["status"] = "new"): ParityElement => ({ id, name: `zone ${id}`, table: "zone", kind, status });
const run = (id: string, kind: string, status: ParityElement["status"] = "new"): ParityElement => ({ id, name: `run ${id}`, table: "run", kind, status });
const fixture = (id: string, kind: string, status: ParityElement["status"] = "new"): ParityElement => ({ id, name: `fixture ${id}`, table: "fixture", kind, status });

const base = (over: Partial<ParityInput> = {}): ParityInput => ({
  lines: [
    { rule_id: "GL-01", description: "Preliminaries", quantity: 1, unit: "lump", total_aed: 3520 },
    { rule_id: "GL-09", description: "Seating bench", quantity: 4, unit: "lm", total_aed: 5280, element_refs: ["bench"] },
    { rule_id: "GL-18", description: "Boundary wall lights", quantity: 2, unit: "point", total_aed: 630 },
  ],
  elements: [run("bench", "bench_run"), fixture("bl1", "boundary_light"), fixture("bl2", "boundary_light")],
  sheets: [
    { sheetNumber: "L-100", ids: ["bench", "bl1", "bl2"] },
    { sheetNumber: "L-401", ids: ["bl1", "bl2"] },
  ],
  views: [{ camera: "zone:a", label: "Pergola court", ids: ["bench", "bl1"] }],
  ...over,
});

describe("parity — BoQ ↔ drawings ↔ views (G5c)", () => {
  it("passes a line drawn on a sheet and visible in a view, and says which", () => {
    const p = buildParity(base());
    const bench = p.lines.find((l) => l.rule_id === "GL-09")!;
    expect(bench.status).toBe("ok");
    expect(bench.sheets).toEqual(["L-100"]);
    expect(bench.views).toEqual(["Pergola court"]);
    expect(p.clean).toBe(true);
  });

  it("fails the line the review found: priced, drawn, but in no view", () => {
    // The L-bench was in the BoQ and on the plan and no render or scene view showed it.
    const p = buildParity(base({ views: [{ camera: "zone:a", label: "Pergola court", ids: ["bl1"] }] }));
    const bench = p.lines.find((l) => l.rule_id === "GL-09")!;
    expect(bench.status).toBe("fail");
    expect(bench.reason).toBe("not visible in any render or scene view");
    expect(p.clean).toBe(false);
    expect(parityTableText(p)).toContain("PARITY NOT CLEAN");
  });

  it("fails a line no element stands for, and a drawn element no line prices", () => {
    const p = buildParity(
      base({
        lines: [{ rule_id: "GL-07", description: "Artificial grass", quantity: 20, unit: "m2", total_aed: 528, element_refs: [] }],
        elements: [zone("lawn", "artificial_grass")],
        sheets: [{ sheetNumber: "L-100", ids: ["lawn"] }],
        views: [{ camera: "c", label: "v", ids: ["lawn"] }],
      }),
    );
    expect(p.lines[0]!.status).toBe("fail");
    expect(p.lines[0]!.reason).toBe("no element on the plan stands for this line");
    expect(p.elements[0]!.status).toBe("fail");
    expect(p.elements[0]!.reason).toContain("no BoQ line prices it");
  });

  it("exempts a project-level lump and an element the rate book absorbs, with the reason", () => {
    const p = buildParity(base({ elements: [...base().elements, fixture("dr1", "drainage_point")] }));
    expect(p.lines.find((l) => l.rule_id === "GL-01")!.status).toBe("exempt");
    const drain = p.elements.find((e) => e.id === "dr1")!;
    expect(drain.status).toBe("exempt");
    expect(drain.reason).toContain("absorbed into the contract rate");
    expect(p.clean).toBe(true);
  });

  it("maps a lump to what it stands for: irrigation to the planting it waters, lights to their fittings", () => {
    const p = buildParity(
      base({
        lines: [
          { rule_id: "GL-15", description: "Irrigation", quantity: 1, unit: "lump", total_aed: 17600 },
          { rule_id: "GL-16", description: "Lighting cabling", quantity: 2, unit: "point", total_aed: 528 },
        ],
        elements: [zone("bed", "planting_bed"), run("pl", "planter_run"), fixture("gl1", "garden_light")],
        sheets: [{ sheetNumber: "L-402", ids: ["bed", "pl"] }, { sheetNumber: "L-401", ids: ["gl1"] }],
        views: [{ camera: "c", label: "v", ids: ["bed", "gl1"] }],
      }),
    );
    expect(p.lines.find((l) => l.rule_id === "GL-15")!.elements).toBe(2);
    expect(p.lines.find((l) => l.rule_id === "GL-16")!.status).toBe("ok");
    expect(p.clean).toBe(true);
  });

  it("lets the demolition line point at the BEFORE photos — a removed item is in no design view", () => {
    const input = base({
      lines: [{ rule_id: "GL-03", description: "Demolition", quantity: 1, unit: "lump", total_aed: 4400 }],
      elements: [run("old", "planter_run", "removed")],
      sheets: [{ sheetNumber: "L-100", ids: ["old"] }],
      views: [{ camera: "c", label: "v", ids: [] }],
    });
    expect(buildParity(input).lines[0]!.status).toBe("fail");
    const withPair = buildParity({ ...input, pairBeforeIds: ["old"] });
    expect(withPair.lines[0]!.status).toBe("ok");
    expect(withPair.lines[0]!.views).toEqual(["before photos (photo pairs)"]);
  });

  it("reads ids off a sheet's data attributes and a camera manifest's keys", () => {
    expect(sheetIds('<polygon data-zone="z1"/><polyline data-run="r1"/><circle data-fixture="f1"/><line data-opening="o1"/><polygon data-context="c1"/><text>none</text>').sort()).toEqual(["c1", "f1", "o1", "r1", "z1"]);
    expect(manifestIds(["zone:z1", "run:r1", "plants:z1", "plants:r1:0", "point:p1", "ground"]).sort()).toEqual(["p1", "r1", "z1"]);
  });
});
