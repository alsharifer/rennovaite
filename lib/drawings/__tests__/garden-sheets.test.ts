import { describe, expect, it } from "vitest";

import {
  LIGHTING_SOURCE_STATEMENT,
  buildGardenSheets,
  edgeDimensions,
  fitScale,
  gardenZones,
  hasCurve,
  minimumSpanningTree,
} from "@/lib/drawings/garden-sheets";
import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import { buildPlanGraph, type PlanGraph } from "@/lib/plan/geometry";

const META = {
  projectNameEn: "Villa 94 garden",
  projectNameAr: null,
  community: "Mudon Al Naseem",
  level: "ground",
  scale: "1:100",
  dateISO: "2026-09-13",
};

function villa94(): { graph: PlanGraph; fixtures: ReturnType<typeof villa94PlanRecords>["fixtures"] } {
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
  return { graph, fixtures: rec.fixtures };
}

const { graph, fixtures } = villa94();
const sheets = buildGardenSheets(graph, fixtures, META);

/** Every dimension text on a sheet, with the endpoints it claims to measure. */
function dims(svg: string) {
  return [...svg.matchAll(/<text[^>]*data-dim="([^"]+)" data-mm="(\d+)"(?: data-ax="([^"]+)" data-ay="([^"]+)" data-bx="([^"]+)" data-by="([^"]+)")?[^>]*>(\d+)<\/text>/g)].map(
    (m) => ({
      kind: m[1]!,
      mm: Number(m[2]),
      a: m[3] ? ([Number(m[3]), Number(m[4])] as [number, number]) : null,
      b: m[5] ? ([Number(m[5]), Number(m[6])] as [number, number]) : null,
      printed: Number(m[7]),
    }),
  );
}

describe("garden drawing set — Villa 94", () => {
  it("builds a site plan, one sheet per zone, both overlays", () => {
    const zones = gardenZones(graph);
    expect(zones).toHaveLength(12);
    expect(sheets.filter((s) => s.kind === "site_plan")).toHaveLength(1);
    expect(sheets.filter((s) => s.kind === "zone_plan")).toHaveLength(12);
    expect(sheets.some((s) => s.kind === "lighting_overlay")).toBe(true);
    expect(sheets.some((s) => s.kind === "irrigation_overlay")).toBe(true);
    // Sheet numbers are unique — zone sheets share a kind and are addressed by number.
    expect(new Set(sheets.map((s) => s.sheetNumber)).size).toBe(sheets.length);
  });

  it("chooses a scale the garden fits at, and prints it", () => {
    // 26.64 m does not fit A3 at 1:100; the site plan must say what it did use.
    const site = sheets.find((s) => s.kind === "site_plan")!.svg;
    expect(site).toContain("1:125");
    expect(site).not.toContain(">1:100<");
    expect(fitScale(12.06, 26.64, 244, 235)).toBe(125);
  });

  it("prints every zone-sheet dimension equal to the graph, to the millimetre", () => {
    let checked = 0;
    for (const zone of gardenZones(graph)) {
      const sheet = sheets.find((s) => s.zoneId === zone.id)!;
      const printed = dims(sheet.svg);

      // Straight edges: the printed figure equals the edge the graph holds.
      const edges = printed.filter((d) => d.kind === "edge");
      const expected = edgeDimensions(zone.polygon);
      expect(edges.length, zone.name_en).toBe(expected.length);
      for (const d of edges) {
        const len = Math.round(Math.hypot(d.b![0] - d.a![0], d.b![1] - d.a![1]) * 1000);
        expect(d.printed, `${zone.name_en} edge`).toBe(len);
        expect(d.mm).toBe(d.printed);
        // …and the endpoints are real vertices of the zone, not rounded copies.
        const isVertex = (p: [number, number]) =>
          zone.polygon.some((v) => Math.abs(v[0] - p[0]) < 1e-9 && Math.abs(v[1] - p[1]) < 1e-9);
        expect(isVertex(d.a!) && isVertex(d.b!), `${zone.name_en} endpoints`).toBe(true);
        checked++;
      }

      // Overall extents equal the zone's bounding box.
      const xs = zone.polygon.map((p) => p[0]);
      const ys = zone.polygon.map((p) => p[1]);
      const w = printed.find((d) => d.kind === "overall-width")!;
      const h = printed.find((d) => d.kind === "overall-depth")!;
      expect(w.printed).toBe(Math.round((Math.max(...xs) - Math.min(...xs)) * 1000));
      expect(h.printed).toBe(Math.round((Math.max(...ys) - Math.min(...ys)) * 1000));
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("reproduces the drawing's own printed dimensions where the drawing gives them", () => {
    // The setting-out plan dimensions the pergola 3500 × 3500 and the counters
    // 3000 and 3400. The traced graph has to print those exact figures.
    const pergola = sheets.find((s) => s.zoneId === "z-pergola")!;
    const edges = dims(pergola.svg).filter((d) => d.kind === "edge").map((d) => d.printed);
    expect(edges.filter((mm) => mm === 3500)).toHaveLength(4);
    const site = sheets.find((s) => s.kind === "site_plan")!.svg;
    const runs = [...site.matchAll(/data-dim="run" data-mm="(\d+)">[A-Z]+ (\d+)</g)]
      .map((m) => {
        expect(Number(m[2])).toBe(Number(m[1])); // printed figure = recorded figure
        return Number(m[1]);
      })
      .sort((a, b) => a - b);
    expect(runs).toEqual([3000, 3400, 7500, 7800]);
    // Plot extents.
    const plot = dims(site).filter((d) => d.kind.startsWith("plot")).map((d) => d.printed).sort((a, b) => a - b);
    expect(plot).toEqual([12060, 26640]);
  });

  it("marks the curved edge instead of dimensioning its chords", () => {
    const lawn = gardenZones(graph).find((z) => z.id === "z-lawn-back")!;
    expect(hasCurve(lawn.polygon)).toBe(true);
    const sheet = sheets.find((s) => s.zoneId === "z-lawn-back")!.svg;
    expect(sheet).toContain("Curved edge: traced chords");
    // No printed dimension shorter than a chord threshold on an oblique edge.
    for (const d of dims(sheet).filter((x) => x.kind === "edge")) {
      const oblique = Math.abs(d.b![0] - d.a![0]) > 1e-6 && Math.abs(d.b![1] - d.a![1]) > 1e-6;
      if (oblique) expect(d.printed).toBeGreaterThanOrEqual(800);
    }
  });

  it("carries the lawn's derived-area flag onto the site plan and its zone sheet", () => {
    const lawn = graph.rooms.find((r) => r.id === "z-lawn-back")!;
    expect(lawn.area_derived_m2).toBeGreaterThan(1.7);
    expect(lawn.area_derived_m2).toBeLessThan(1.9);
    expect(lawn.derived_fields).toContain("area_m2");
    const site = sheets.find((s) => s.kind === "site_plan")!.svg;
    expect(site).toContain(`${lawn.area_m2.toFixed(2)}*`);
    expect(site).toContain("elliptical quarter");
    const zoneSvg = sheets.find((s) => s.zoneId === "z-lawn-back")!.svg;
    expect(zoneSvg).toContain("DERIVED AREA");
    expect(zoneSvg).toContain(`${lawn.area_m2.toFixed(2)} m² *`);
  });

  it("states that lighting is as designed, never as surveyed", () => {
    const sheet = sheets.find((s) => s.kind === "lighting_overlay")!.svg;
    expect(sheet).toContain(LIGHTING_SOURCE_STATEMENT.slice(0, 40));
    expect(sheet).not.toMatch(/as surveyed/i);
    const counts = [...sheet.matchAll(/data-count="(\w+)"[^>]*>(\d+)</g)].map((m) => [m[1], Number(m[2])]);
    expect(Object.fromEntries(counts)).toEqual({ BL: 9, IG: 7, LS: 8, S4: 7, S8: 6 });
    expect(sheet).toContain("derived, not designed");
  });

  it("shows irrigation and drainage and no HVAC", () => {
    const sheet = sheets.find((s) => s.kind === "irrigation_overlay")!.svg;
    expect(sheet).toContain("Planting beds (drip zones)");
    expect(sheet).toContain("No drainage points are placed on this plan");
    expect(sheet).toContain("No HVAC");
    expect(sheet).not.toMatch(/\bAC\b|air.?condition|FCU/i);
  });

  it("keeps the drawing clear of the title block", () => {
    for (const s of sheets) {
      // Every dimension and label sits left of the title block or above it.
      for (const m of s.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*data-dim/g)) {
        const x = Number(m[1]);
        const y = Number(m[2]);
        const inTitle = x > 276 && y > 231;
        expect(inTitle, `${s.sheetNumber} dimension at ${x},${y}`).toBe(false);
      }
    }
  });
});

describe("drawing primitives", () => {
  it("finds the shortest network through a set of points", () => {
    const t = minimumSpanningTree([[0, 0], [3, 0], [3, 4], [10, 0]]);
    expect(t.edges).toHaveLength(3);
    expect(t.length_m).toBe(14); // 3 + 4 + 7
  });

  it("dimensions an L-shape's six straight edges", () => {
    const L: [number, number][] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];
    expect(edgeDimensions(L).map((d) => d.mm)).toEqual([4000, 1000, 3000, 2000, 1000, 3000]);
  });
});
