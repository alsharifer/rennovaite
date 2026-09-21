import { describe, expect, it } from "vitest";

import { buildGardenSections as buildWithBook } from "@/lib/boq/garden-boq-feed";
import { PLOT, SOURCE_NOTE, X, Y, ZONES, arabellaPlanInput, referenceCoverage } from "@/lib/client-garden/arabella-reference";
import { buildBoqPdfPages } from "@/lib/documents/boq-pdf";
import { boqDerivedInfo, derivedLineNote, derivedTotal } from "@/lib/documents/boq-derived";
import { readinessFrom, readinessMessage } from "@/lib/documents/pack-readiness";
import { assertPackable, buildRenderPack } from "@/lib/documents/render-pack";
import { buildElevationSheets } from "@/lib/drawings/garden-elevations";
import { buildGardenSheets, renderCoverSheet } from "@/lib/drawings/garden-sheets";
import { renderPlanSheet } from "@/lib/drawings/plan-sheet";
import { INTERNAL_REF } from "@/lib/ground-truth/villa94-garden";
import { buildPlanGraph, graphDraftStatus } from "@/lib/plan/geometry";
import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";
import { DRAFT_STATEMENT } from "@/lib/plan/site-reference";
import { buildGardenScene } from "@/lib/scene/garden-scene";
import { transcriptionGardenBook } from "@/lib/boq/garden-rates";

// T1.0: the take-off prices through a rate book. These tests check the rules
// against the transcription, so they use the offline transcription book.
const BOOK = transcriptionGardenBook();
const buildGardenSections = (i: Parameters<typeof buildWithBook>[0]) => buildWithBook(i, BOOK);

type Disp = Parameters<typeof arabellaPlanInput>[0];

const graphOf = (d: Disp = {}) => {
  const p = arabellaPlanInput(d);
  return {
    p,
    graph: buildPlanGraph({
      projectId: "arabella",
      planId: "plan",
      scale: null,
      total_area_m2: 0,
      rooms: p.rooms,
      elements: p.elements,
      context: p.context,
      unit_to_m: p.plot.width_m,
      plot: p.plot,
      plot_dims_derived: true,
      dims_note: SOURCE_NOTE,
      source: "user_drawn",
    }),
  };
};

const meta = { projectNameEn: "Arabella Garden — Draft for Review", community: "Dubai", level: "ground", scale: "1:100", dateISO: "2026-09-14", projectId: "arabella" };
const identity = String(INTERNAL_REF).split(/[^A-Za-z0-9]+/)[0]!;

describe("the client garden on derived reference dimensions", () => {
  it("tiles the plot from the stated dimension set, with the 0.1 m residual stated", () => {
    expect([X.garage + (X.sideGarden - X.garage) + (X.plot - X.sideGarden)]).toEqual([PLOT.width_m]);
    expect(X.sideGarden - X.garage).toBeCloseTo(14.8, 6);
    expect(X.plot - X.sideGarden).toBeCloseTo(5.6, 6);
    expect(Y.houseFront - Y.rearStrip).toBeCloseTo(6.1, 6);
    expect(X.deckEdge - X.sideGarden).toBeCloseTo(2.1, 6);
    expect(X.plot - X.deckEdge).toBeCloseTo(3.5, 6);
    const cov = referenceCoverage();
    // zones + house + garage leave exactly the 0.1 m × house-width street residual
    expect(cov.plot_m2 - cov.zones_m2 - cov.buildings_m2).toBeCloseTo(0.1 * (X.sideGarden - X.garage), 6);
    expect(ZONES.map((z) => z.area_m2)).toEqual([90.73, 22.05, 24.5, 12.25]);
  });

  it("is a DRAFT: the plot, every zone, run and context footprint is derived", () => {
    const { graph } = graphOf();
    const d = graphDraftStatus(graph);
    expect(d.draft).toBe(true);
    expect(d.derived[0]).toBe("plot boundary");
    expect(d.note).toBe(SOURCE_NOTE);
    expect(d.statement).toBe(DRAFT_STATEMENT);
    expect(graph.rooms.every((r) => r.dims_derived) && graph.elements.every((e) => e.dims_derived)).toBe(true);
  });

  it("drops the watermark only when nothing boundary-critical is derived", () => {
    const p = arabellaPlanInput();
    const measured = buildPlanGraph({
      projectId: "arabella", planId: "plan", scale: null, total_area_m2: 0,
      rooms: p.rooms.map((r) => ({ ...r, dims_derived: false })),
      elements: p.elements.map((e) => ({ ...e, dims_derived: false })),
      context: p.context.map((c) => ({ ...c, dims_derived: false })),
      unit_to_m: p.plot.width_m, plot: p.plot, plot_dims_derived: false, source: "user_drawn",
    });
    expect(graphDraftStatus(measured).draft).toBe(false);
    // One derived zone left is enough to keep it a draft.
    const oneLeft = buildPlanGraph({ ...{ projectId: "a", planId: "p", scale: null, total_area_m2: 0, unit_to_m: p.plot.width_m, plot: p.plot, source: "user_drawn" as const }, rooms: p.rooms.map((r, i) => ({ ...r, dims_derived: i === 0 })), elements: [], context: [] });
    expect(graphDraftStatus(oneLeft).derived).toEqual(["zone: Rear garden strip — lawn"]);
  });
});

describe("site reference through the take-off", () => {
  const capture = (d: Disp) => {
    const p = arabellaPlanInput(d);
    return {
      zones: p.rooms.map((r) => ({ id: r.id, name: r.name_en, kind: r.room_type, area_m2: r.area_m2, dims_derived: true, ...(r.site_reference ? { site_reference: true, disposition: r.disposition } : {}) })),
      runs: p.elements.map((e) => ({ id: e.id, kind: e.kind, length_m: 5, name: e.spec.name as string, dims_derived: true, site_reference: true, disposition: e.disposition })),
      units: p.fixtures.map((f) => ({ id: f.id, kind: f.type as "tree" | "shed", site_reference: true, disposition: f.disposition })),
    };
  };

  it("with everything existing KEPT, prices only the design zones and demolishes nothing existing", () => {
    const all = Object.fromEntries(["gazebo", "path", "sink-counter", "planter-rear", "planter-side", "lights-corner", "lights-across", "tree-1", "tree-2", "palm", "tree-3", "tree-4", "tree-5", "shed"].map((k) => [k, "keep" as const]));
    const built = buildGardenSections(capture(all));
    const keys = built.sections.flatMap((s) => s.lines.map((l) => l.rule_id));
    expect(keys).not.toContain("GL-14"); // no new pergola for a kept gazebo
    expect(keys).not.toContain("GL-22"); // no stepping path
    expect(built.removals).toEqual([]);
    expect(built.kept).toHaveLength(14);
    expect(built.undecided).toEqual([]);
    // The deck strip has no reference rate: visible at 0, never silent.
    const deck = built.sections.flatMap((s) => s.lines).find((l) => l.rule_id === "GL-20")!;
    expect([deck.rate_status, deck.total_aed, deck.quantity]).toEqual(["needs_qs", 0, 22.05]);
  });

  it("with the gazebo REPLACED and the path REMOVED, counts each where it belongs", () => {
    const built = buildGardenSections(capture({ gazebo: "replace", path: "remove" }));
    const lines = built.sections.flatMap((s) => s.lines);
    expect(lines.find((l) => l.rule_id === "GL-14")!.quantity).toBe(12.25);
    expect(lines.find((l) => l.rule_id === "GL-14")!.qty_derived).toBe(true);
    expect(lines.find((l) => l.rule_id === "GL-03")!.element_refs).toEqual(["r-path", "z-gazebo"]);
    expect(lines.some((l) => l.rule_id === "GL-22")).toBe(false);
    expect(built.undecided.length).toBeGreaterThan(0);
  });

  it("marks every boundary-dependent quantity derived", () => {
    const lines = buildGardenSections(capture({})).sections.flatMap((s) => s.lines);
    for (const rule of ["GL-07", "GL-08", "GL-20"]) {
      const l = lines.find((x) => x.rule_id === rule)!;
      expect(l.qty_derived, rule).toBe(true);
      expect(derivedLineNote(l as never)).toMatch(/^≈ Derived from the reference layout/);
    }
  });
});

describe("readiness", () => {
  it("refuses while a counter is untyped, an item is undecided, or the BoQ is stale", () => {
    expect(readinessFrom({ untypedCounters: [], undecided: [], boqNeedsSelection: [] }).ready).toBe(true);
    expect(readinessFrom({ untypedCounters: ["Counter"], undecided: [], boqNeedsSelection: ["x"] }).ready).toBe(false);
    expect(readinessFrom({ untypedCounters: [], undecided: ["Gazebo"], boqNeedsSelection: [] }).ready).toBe(false);
    const stale = readinessFrom({ untypedCounters: [], undecided: [], boqNeedsSelection: ["Bar counter"] });
    expect(stale.ready).toBe(false);
    expect(readinessMessage(stale)).toMatch(/regenerate/);
    expect(readinessFrom({ untypedCounters: [], undecided: [], boqNeedsSelection: null }).ready).toBe(false);
  });
});

describe("the draft watermark on every document", () => {
  const draftMeta = { ...meta, draft: DRAFT_STATEMENT };

  it("stamps every garden sheet, and the cover carries the statement and the index", () => {
    const { graph, p } = graphOf({ gazebo: "keep" });
    const sheets = buildGardenSheets(graph, p.fixtures, draftMeta);
    expect(sheets.length).toBeGreaterThan(3);
    for (const s of sheets) expect(s.svg, s.sheetNumber).toContain(`data-draft-statement="${DRAFT_STATEMENT}"`);
    const cover = renderCoverSheet(graph, p.fixtures, draftMeta, sheets.map((s) => ({ sheetNumber: s.sheetNumber, title: s.title })), graphDraftStatus(graph));
    expect(cover).toContain(`data-draft-statement="${DRAFT_STATEMENT}"`);
    for (const s of sheets) expect(cover).toContain(`data-index="${s.sheetNumber}"`);
    expect(new RegExp(identity, "i").test(sheets.map((s) => s.svg).join("") + cover)).toBe(false);
  });

  it("leaves an interior sheet exactly as it was", () => {
    const mudon = buildPlanGraph(MUDON_FIXTURE);
    const svg = renderPlanSheet(mudon, { projectNameEn: "Mudon", community: "Dubai", level: "first floor", scale: "1:100", dateISO: "2026-09-14" }, { sheetNumber: "A-101", title: "As-Built Plan" });
    expect(svg).not.toContain("data-draft");
  });

  it("puts the statement in every BoQ PDF page header and prints the total with the derived convention", () => {
    const built = buildGardenSections({ zones: arabellaPlanInput().rooms.filter((r) => !r.site_reference).map((r) => ({ id: r.id, name: r.name_en, kind: r.room_type, area_m2: r.area_m2, dims_derived: true })) });
    const subtotal = built.total_aed;
    const boq = {
      sections: built.sections as never,
      subtotal_aed: subtotal,
      contingency_pct: 10,
      contingency_aed: Math.round(subtotal * 0.1),
      vat_pct: 5,
      vat_aed: Math.round(subtotal * 1.1 * 0.05),
      grand_total_aed: subtotal + Math.round(subtotal * 0.1) + Math.round(subtotal * 1.1 * 0.05),
      garden: { draft: { draft: true, statement: DRAFT_STATEMENT, note: SOURCE_NOTE }, derived_lines: 3, kept: [], removals: [], undecided: [] },
    };
    // Enough lines to paginate.
    boq.sections = [...boq.sections, ...boq.sections, ...boq.sections, ...boq.sections] as never;
    const pages = buildBoqPdfPages({ projectName: "Arabella Garden — Draft for Review", community: "Dubai", dateISO: "2026-09-14", boq });
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page).toContain(`data-boq-draft="true"`);
      expect(page).toContain(DRAFT_STATEMENT);
    }
    const total = derivedTotal(boq.grand_total_aed, boqDerivedInfo(boq));
    expect(total.text).toMatch(/^≈ AED [\d,]+00\*$/);
    expect(pages[0]).toContain(total.text);
    expect(pages.join("")).not.toContain(`AED ${Math.round(boq.grand_total_aed).toLocaleString("en-US")}<`);
    expect(new RegExp(identity, "i").test(pages.join(""))).toBe(false);
  });

  it("prints a BoQ with nothing derived exactly as a number", () => {
    const t = derivedTotal(148205.01, { derivedLines: 0, draft: false, statement: null });
    expect(t).toEqual({ text: "AED 148,205", derived: false, footnote: null });
  });

  it("puts the statement on the render-pack cover and header", () => {
    const { graph, p } = graphOf({ gazebo: "keep" });
    const { pages } = buildRenderPack({ graph, fixtures: p.fixtures, renders: {}, style: null, projectName: "Arabella Garden — Draft for Review", community: "Dubai", dateISO: "2026-09-14", sitePlanSvg: null, draft: DRAFT_STATEMENT, draftNote: SOURCE_NOTE });
    expect(pages[0]!.svg).toContain(`data-draft-statement="${DRAFT_STATEMENT}"`);
    for (const pg of pages) expect(pg.svg).toContain("DRAFT FOR REVIEW");
  });

  it("never packs a photo restyle that has not passed its check", () => {
    expect(() => assertPackable({ id: "x", image_url: "u", kind: "photo_edit", gate_passed: false })).toThrow(/faithfulness gate/);
    expect(assertPackable({ id: "x", image_url: "u", kind: "photo_edit", gate_passed: true }).id).toBe("x");
  });
});

describe("existing features in the design documents", () => {
  it("details only what gets built: no elevation for a kept gazebo, a path or string lights", () => {
    const { graph, p } = graphOf({ gazebo: "keep", "sink-counter": "keep" });
    const titles = buildElevationSheets(graph, p.fixtures, meta).map((s) => s.title);
    expect(titles.some((t) => /gazebo|string|stepping/i.test(t))).toBe(false);
    const replaced = graphOf({ "sink-counter": "replace" });
    expect(buildElevationSheets(replaced.graph, replaced.p.fixtures, meta).some((s) => /counter/i.test(s.title))).toBe(true);
  });

  it("builds the 3D scene as the design: kept gazebo and trees stand, removed items do not", () => {
    const kept = graphOf({ gazebo: "keep", "tree-1": "keep", "lights-corner": "keep" });
    const scene = buildGardenScene({ graph: kept.graph, fixtures: kept.p.fixtures });
    const nouns = scene.objects.map((o) => o.noun);
    expect(nouns).toContain("gazebo");
    expect(nouns).not.toContain("pergola");
    expect(nouns).toContain("palm tree");
    expect(nouns).toContain("stepping-stone path");
    // Kept festoon lights glow in the evening model.
    expect(scene.lights.filter((l) => l.kind === "strip").length).toBeGreaterThan(5);

    const removed = graphOf({ gazebo: "remove", path: "remove", "lights-corner": "remove", "lights-across": "remove", "tree-1": "remove" });
    const s2 = buildGardenScene({ graph: removed.graph, fixtures: removed.p.fixtures });
    expect(s2.objects.map((o) => o.noun)).not.toContain("gazebo");
    expect(s2.objects.map((o) => o.noun)).not.toContain("stepping-stone path");
    expect(s2.lights.filter((l) => l.kind === "strip")).toHaveLength(0);
    expect(s2.objects.filter((o) => o.noun === "tree")).toHaveLength(4);
  });
});
