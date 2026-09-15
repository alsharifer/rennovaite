import { describe, expect, it } from "vitest";

import { buildRenderPack, containFit, wrap } from "@/lib/documents/render-pack";
import { buildGardenSheets, LIGHTING_SOURCE_STATEMENT } from "@/lib/drawings/garden-sheets";
import { getGardenStyle } from "@/lib/garden-styles";
import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import { buildPlanGraph } from "@/lib/plan/geometry";

const rec = villa94PlanRecords();
const graph = buildPlanGraph({
  projectId: "p",
  planId: "pl",
  scale: null,
  total_area_m2: rec.rooms.reduce((s, r) => s + r.area_m2, 0),
  rooms: rec.rooms,
  elements: rec.elements,
  unit_to_m: rec.plot.width_m,
  plot: rec.plot,
  source: "user_drawn",
});
const site = buildGardenSheets(graph, rec.fixtures, {
  projectNameEn: "Villa 94 garden",
  projectNameAr: null,
  community: "Mudon Al Naseem",
  level: "ground",
  scale: "1:100",
  dateISO: "2026-09-13",
}).find((s) => s.kind === "site_plan")!.svg;

const base = {
  graph,
  fixtures: rec.fixtures,
  elementVariants: Object.fromEntries(rec.elements.map((e) => [e.id, e.variant])),
  style: getGardenStyle("desert-modern"),
  projectName: "Villa 94 garden",
  community: "Mudon Al Naseem",
  dateISO: "2026-09-13",
  sitePlanSvg: site,
};

// Every zone rendered by day; evening views for every zone that expects one.
function fullRenders() {
  const empty = buildRenderPack({ ...base, renders: {} });
  return Object.fromEntries(
    empty.zones.map((z) => [
      z.room.id,
      {
        day: { id: `d-${z.room.id}`, image_url: `https://img/d-${z.room.id}.png`, kind: "render" as const, gate_passed: true },
        evening: z.eveningExpected ? { id: `e-${z.room.id}`, image_url: `https://img/e-${z.room.id}.png`, kind: "render" as const, gate_passed: true } : null,
      },
    ]),
  );
}

describe("render pack — Villa 94", () => {
  const { pages, zones } = buildRenderPack({ ...base, renders: fullRenders() });

  it("is a cover, a plan overview, one page per zone and a materials summary", () => {
    expect(pages.map((p) => p.kind)).toEqual(["cover", "plan_overview", ...zones.map(() => "zone"), "materials"]);
    expect(zones).toHaveLength(12);
  });

  it("uses the drawing set's own zone references and site plan", () => {
    // Z-refs come from gardenZones, the same order the site plan prints.
    for (const z of zones) expect(site).toContain(`>${z.ref}<`);
    expect(pages[1]!.svg).toContain("data-dim=\"plot-width\"");
  });

  it("places day and evening renders where lighting exists, day only elsewhere", () => {
    for (const [i, z] of zones.entries()) {
      const p = pages[2 + i]!;
      expect(p.images.map((s) => s.renderId)).toEqual(z.eveningExpected ? [`d-${z.room.id}`, `e-${z.room.id}`] : [`d-${z.room.id}`]);
    }
    const pergola = zones.find((z) => z.room.id === "z-pergola")!;
    expect(pergola.eveningExpected).toBe(true); // integral downlights
    expect(zones.find((z) => z.room.id === "z-lawn-back")!.eveningExpected).toBe(true);
  });

  it("carries the lawn's derived area flag and note", () => {
    const i = zones.findIndex((z) => z.room.id === "z-lawn-back");
    const svg = pages[2 + i]!.svg;
    expect(svg).toContain(`${zones[i]!.room.area_m2.toFixed(2)} m² *`);
    expect(svg).toContain("* Derived area: 1.8 m²");
    expect(pages.at(-1)!.svg).toContain(`${zones[i]!.room.area_m2.toFixed(2)}*`);
  });

  it("states lighting as designed and never names a contractor, a rate or a price", () => {
    const materials = pages.at(-1)!.svg;
    expect(materials).toContain(LIGHTING_SOURCE_STATEMENT.slice(0, 30));
    expect(pages.map((p) => p.svg).join("")).not.toMatch(/KAME|AED|market reference|as surveyed/i);
  });

  it("labels counter runs by their selected variant", () => {
    const materials = pages.at(-1)!.svg;
    expect(materials).toContain("Counter run — BBQ counter");
    expect(materials).toContain("Counter run — bar counter");
  });

  it("says what is missing instead of leaving a blank frame", () => {
    const partial = buildRenderPack({ ...base, renders: {} });
    expect(partial.pages.every((p) => p.images.length === 0)).toBe(true);
    expect(partial.pages[0]!.svg).toContain("0 of 12 zones rendered");
    expect(partial.pages[2]!.svg).toContain("Not yet rendered");
    const lit = partial.zones.findIndex((z) => z.eveningExpected);
    expect(partial.pages[2 + lit]!.svg).toContain("Evening view not rendered");
  });
});

describe("render pack — the faithfulness gate", () => {
  const renders = fullRenders();
  const lawn = "z-lawn-back";

  it("refuses a render that has not passed the gate", () => {
    const bad = { ...renders, [lawn]: { day: { id: "x", image_url: "https://img/x.png", kind: "render" as const, gate_passed: false }, evening: null } };
    expect(() => buildRenderPack({ ...base, renders: bad })).toThrow(/has not passed the faithfulness gate/);
  });

  it("labels a substituted design view as what it is", () => {
    const sub = {
      ...renders,
      [lawn]: { day: { id: "dv", image_url: "https://img/dv.png", kind: "design_view" as const, gate_passed: false, note: "F1 lawn: missing" }, evening: null },
    };
    const { pages, zones } = buildRenderPack({ ...base, renders: sub });
    const svg = pages[2 + zones.findIndex((z) => z.room.id === lawn)]!.svg;
    expect(svg).toContain("DAY — 3D DESIGN VIEW");
    expect(svg).toContain("No render passed the faithfulness check");
    const passed = pages[2 + zones.findIndex((z) => z.room.id === "z-pergola")]!.svg;
    expect(passed).toContain("DAY — RENDER · FAITHFULNESS CHECK PASSED");
  });

  it("adds a page per whole-garden view, after the plan overview", () => {
    const view = { id: "garden:garden-1", label: "Whole garden — view 1", lit: true, day: { id: "g1", image_url: "https://img/g1.png", kind: "render" as const, gate_passed: true }, evening: null };
    const { pages } = buildRenderPack({ ...base, renders, gardenViews: [view] });
    expect(pages[2]!.kind).toBe("garden_view");
    expect(pages[2]!.images.map((i) => i.renderId)).toEqual(["g1"]);
    // The cover leads with the passed whole-garden render.
    expect(pages[0]!.images[0]!.renderId).toBe("g1");
  });

  it("leads the cover with the client's own photo, redesigned, when a pair passed (G5)", () => {
    const view = { id: "garden:garden-1", label: "Whole garden — view 1", lit: false, day: { id: "g1", image_url: "https://img/g1.png", kind: "render" as const, gate_passed: true }, evening: null };
    const pair = { id: "pr1", zoneName: "Side garden — lawn", beforeId: "photo-1", after: { id: "pair-after", image_url: "https://img/pa.png", kind: "photo_edit" as const, gate_passed: true }, caption: "" };
    const { pages } = buildRenderPack({ ...base, renders, gardenViews: [view], photoPairs: [pair] });
    expect(pages[0]!.images[0]!.renderId).toBe("pair-after");
  });
});

describe("render pack — design assumptions", () => {
  it("lists the proposals right after the plan overview, and only when there are any", () => {
    const assumptions = {
      decisions: [{ item: "Existing hardtop gazebo", kind: "structure", decision: "REPLACE" as const, becomes: "Louvred pergola", note: null }],
      layout: ["Front garden: footprint assumed"],
    };
    const { pages } = buildRenderPack({ ...base, renders: {}, assumptions });
    expect(pages[2]!.kind).toBe("assumptions");
    expect(pages[2]!.svg).toContain("Existing hardtop gazebo");
    expect(pages[2]!.svg).toContain("REPLACE");
    expect(pages[2]!.svg).toContain("Front garden: footprint assumed");
    const none = buildRenderPack({ ...base, renders: {}, assumptions: { decisions: [], layout: [] } });
    expect(none.pages.some((pg) => pg.kind === "assumptions")).toBe(false);
  });
});

describe("render pack — existing items the design takes out", () => {
  it("never lists a run that is removed or replaced elsewhere as a built feature", () => {
    const counter = graph.elements.find((e) => e.kind === "counter_run")!;
    const replaced = { ...graph, elements: graph.elements.map((e) => (e.id === counter.id ? { ...e, site_reference: true, disposition: "replace", spec: { replaced_by: "a BBQ counter elsewhere" } } : e)) };
    const count = (g: typeof graph) => buildRenderPack({ ...base, graph: g, renders: {} }).zones.flatMap((z) => z.features).length;
    expect(count(replaced as typeof graph)).toBe(count(graph) - 1);
  });
});

describe("pack primitives", () => {
  it("contain-fits a photo inside its slot without distortion", () => {
    const fit = containFit(1024, 768, { x: 10, y: 10, w: 200, h: 100 });
    expect(fit.h).toBe(100);
    expect(fit.w).toBeCloseTo(133.33, 1);
    expect(fit.x).toBeCloseTo(10 + (200 - 133.33) / 2, 1);
  });

  it("wraps words without splitting them", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });
});
