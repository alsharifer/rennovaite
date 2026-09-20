import { describe, expect, it } from "vitest";

import { buildElevationSheets, fmtLevel } from "@/lib/drawings/garden-elevations";
import { buildGardenSheets } from "@/lib/drawings/garden-sheets";
import { CONTEXT, RUNS, UNITS, villa94PlanRecords, villa94Zones } from "@/lib/ground-truth/villa94-garden-geometry";
import { buildPlanGraph } from "@/lib/plan/geometry";

const rec = villa94PlanRecords();
const graph = buildPlanGraph({
  projectId: "p",
  planId: "pl",
  scale: null,
  total_area_m2: rec.rooms.reduce((s, r) => s + r.area_m2, 0),
  rooms: rec.rooms,
  elements: rec.elements,
  context: rec.context,
  unit_to_m: rec.plot.width_m,
  plot: rec.plot,
  source: "user_drawn",
});
const META = { projectNameEn: "Villa 94 garden", projectNameAr: null, community: "Dubai", level: "ground", scale: "1:100", dateISO: "2026-09-13" };
const variants = Object.fromEntries(rec.elements.map((e) => [e.id, e.variant]));
const sheets = buildElevationSheets(graph, rec.fixtures, META, variants);

// --- An independent resolver, reading the SOURCE RECORDS (metres from the
// drawing), not the graph the renderer used. If a sheet prints a number the
// traced plan does not hold, this disagrees with it.
const zones = new Map(villa94Zones().map((z) => [z.id, z]));
const runs = new Map(RUNS.map((r) => [r.id, r]));
const units = new Map(UNITS.map((u) => [u.id, u]));
const ctx = new Map(CONTEXT.map((c) => [c.id, c]));

function path(o: unknown, dotted: string): number {
  const v = dotted.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], o);
  if (typeof v !== "number") throw new Error(`no number at ${dotted}`);
  return v;
}

function ref(r: string): number {
  const [kind, id, field] = r.split(":") as [string, string, string];
  if (kind === "k") return Number(id);
  if (kind === "plot") return Math.round(rec.plot.width_m * 1000);
  if (kind === "room") {
    const z = zones.get(id)!;
    const xs = z.polygon.map((p) => p[0]);
    const ys = z.polygon.map((p) => p[1]);
    if (field === "bboxw") return Math.round((Math.max(...xs) - Math.min(...xs)) * 1000);
    if (field === "bboxh") return Math.round((Math.max(...ys) - Math.min(...ys)) * 1000);
    return path(z, field);
  }
  if (kind === "el") {
    const r = runs.get(id)!;
    const seg = /^seg(\d+)$/.exec(field);
    if (seg) {
      const i = Number(seg[1]);
      const [a, b] = [r.polyline[i]!, r.polyline[i + 1]!];
      return Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 1000);
    }
    return path(r, field);
  }
  if (kind === "unit") return path(units.get(id)!, field);
  if (kind === "ctx") return path(ctx.get(id)!, field);
  throw new Error(`unknown ref ${r}`);
}

function evaluate(expr: string): number {
  // Space-delimited operators; ids contain hyphens.
  const tokens = expr.split(" ");
  let total = 0;
  let sign = 1;
  for (const t of tokens) {
    if (t === "+") sign = 1;
    else if (t === "-") sign = -1;
    else {
      const m = /^(\d+(?:\.\d+)?)\*(.+)$/.exec(t);
      total += sign * (m ? Number(m[1]) * ref(m[2]!) : ref(t));
    }
  }
  return Math.round(total);
}

const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function figures(svg: string) {
  const dims = [...svg.matchAll(/data-dim="([^"]+)" data-axis="([hv])" data-mm="(-?\d+)" data-src="([^"]+)"[^>]*>(-?\d+)</g)].map((m) => ({
    kind: m[1]!,
    axis: m[2]!,
    mm: Number(m[3]),
    src: unescape(m[4]!),
    printed: Number(m[5]),
  }));
  const levels = [...svg.matchAll(/data-level="(-?\d+)" data-src="([^"]+)"[^>]*>([^<]+)</g)].map((m) => ({
    mm: Number(m[1]),
    src: unescape(m[2]!),
    printed: m[3]!,
  }));
  return { dims, levels };
}

describe("garden elevations — Villa 94", () => {
  it("draws a sectional elevation for all seven structures, plus the boundary strips", () => {
    const structures = sheets.filter((s) => s.kind === "structure_elevation");
    expect(structures.map((s) => s.subject).sort()).toEqual(
      ["z-pergola", "r-counter-bbq", "r-counter-bar", "r-bench-l", "r-planter-l", "u-wall-feature", "u-planter-olive"].sort(),
    );
    expect(sheets.some((s) => s.kind === "garden_elevation")).toBe(true);
    expect(new Set(sheets.map((s) => s.sheetNumber)).size).toBe(sheets.length);
  });

  it("prints every dimension and level equal to the traced records, to the millimetre", () => {
    let vertical = 0;
    let total = 0;
    for (const s of sheets) {
      const { dims, levels } = figures(s.svg);
      expect(dims.length + levels.length, s.sheetNumber).toBeGreaterThan(0);
      for (const d of dims) {
        expect(d.printed, `${s.sheetNumber} ${d.kind}`).toBe(d.mm);
        expect(d.mm, `${s.sheetNumber} ${d.kind} ← ${d.src}`).toBe(evaluate(d.src));
        if (d.axis === "v") vertical++;
        total++;
      }
      for (const l of levels) {
        expect(l.mm, `${s.sheetNumber} level ← ${l.src}`).toBe(evaluate(l.src));
        expect(l.printed.startsWith(fmtLevel(l.mm)), `${s.sheetNumber} ${l.printed}`).toBe(true);
        total++;
      }
    }
    expect(vertical).toBeGreaterThanOrEqual(20);
    expect(total).toBeGreaterThanOrEqual(60);
  });

  it("carries the drawing pack's own heights", () => {
    const text = (id: string) => sheets.find((s) => s.subject === id)!.svg;
    expect(text("z-pergola")).toContain("+2800 TRL");
    expect(figures(text("z-pergola")).dims.find((d) => d.kind === "pergola-clear")!.mm).toBe(2650);
    expect(text("r-counter-bbq")).toContain("+900 CTL");
    expect(text("r-counter-bar")).toContain("+1000 CTL");
    expect(text("r-bench-l")).toContain("+350 TOS");
    expect(text("r-bench-l")).toContain("+600 TOC");
    expect(text("u-wall-feature")).toContain("+1800 TOC");
    const wf = figures(text("u-wall-feature")).dims;
    expect(wf.filter((d) => d.kind === "wall-feature-pier").map((d) => d.mm)).toEqual([375, 375]);
    expect(wf.find((d) => d.kind === "wall-feature-crown")!.mm).toBe(1650);
    expect(text("u-planter-olive")).toContain("+450 TOC");
    expect(figures(text("u-planter-olive")).dims.find((d) => d.kind === "planter-box-inner")!.mm).toBe(1400);
  });

  it("marks the scaled boundary-wall height as assumed, never as a measurement", () => {
    const strip = sheets.find((s) => s.kind === "garden_elevation")!.svg;
    expect(strip).toMatch(/data-dim="boundary-wall-height"[^>]*data-derived="true"/);
    expect(strip).toContain("is assumed or scaled, not dimensioned");
    // The villa stands behind the viewer of a north-facing elevation.
    expect(strip).not.toContain("Existing G+1 villa continues");
  });

  it("prints structure views at a KAME scale, not shrunk to fit", () => {
    const scaleOf = (svg: string) => [...svg.matchAll(/Scale 1:(\d+) @ A3/g)].map((m) => Number(m[1]));
    for (const s of sheets.filter((x) => x.kind === "structure_elevation")) {
      expect(Math.min(...scaleOf(s.svg)), s.title).toBeLessThanOrEqual(20);
    }
  });
});

describe("levels on the plan sheets", () => {
  const plan = buildGardenSheets(graph, rec.fixtures, META);
  const site = plan.find((s) => s.kind === "site_plan")!.svg;

  it("tags the zones whose levels differ, from the graph", () => {
    const tags = [...site.matchAll(/data-level="(-?\d+)" data-src="([^"]+)"/g)].map((m) => ({ mm: Number(m[1]), src: unescape(m[2]!) }));
    for (const t of tags) expect(t.mm, t.src).toBe(evaluate(t.src));
    const mm = new Set(tags.map((t) => t.mm));
    expect(mm.has(300)).toBe(true); // side courtyard
    expect(mm.has(150)).toBe(true); // front approach upper, steps
    expect(mm.has(0)).toBe(true);
    expect(site).not.toContain("No levels are carried by this plan");
  });

  it("puts the structure tops on the site plan", () => {
    for (const t of ["+2800 TRL", "+900 CTL", "+1000 CTL", "+1800 TOC", "+450 TOC"]) expect(site).toContain(t);
  });

  it("carries the zone's level onto its own sheet", () => {
    const courtyard = plan.find((s) => s.zoneId === "z-paving-courtyard")!.svg;
    expect(courtyard).toContain("+300 FFL");
  });

  it("draws the existing villa and garage as context, not as zones", () => {
    expect(site).toContain("EXISTING G+1 VILLA");
    expect(site).toContain("EXISTING GARAGE");
    expect(site).toContain("data-context=\"c-villa\"");
    expect(site).not.toContain("data-zone=\"c-villa\"");
  });
});
