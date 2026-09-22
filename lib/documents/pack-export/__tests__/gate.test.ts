import { describe, expect, it } from "vitest";

import { buildParity, type ParityInput } from "@/lib/documents/parity";
import { readinessFrom } from "@/lib/documents/pack-readiness";

import { buildChecklist, checklistReady, isWorkingName } from "../checklist";
import { printedChecks, type PrintedInput } from "../checks";

// T5 — the export gate is scope-aware: an interior project is not refused for
// being an interior project, and a garden keeps every refusal it had.

const P = "00000000-0000-4000-8000-000000000001";
const ready = readinessFrom({ untypedCounters: [], undecided: [], boqNeedsSelection: [] });

const interiorParity = (lines: { rule_id: string; element_refs?: string[]; total_aed: number }[]): ParityInput => ({
  lines: [],
  elements: [],
  sheets: [{ sheetNumber: "A-101", ids: [] }],
  views: [],
  interior: {
    rooms: [
      { id: "r-living", name: "Living", kind: "living" },
      { id: "r-master", name: "Master bedroom", kind: "bedroom" },
    ],
    lines,
  },
});

describe("pack export gate — interior projects (T4 finding)", () => {
  it("passes every interior room when the interior take-off prices work", () => {
    const parity = buildParity(interiorParity([
      { rule_id: "FL-01", element_refs: ["r-living"], total_aed: 12_000 },
      { rule_id: "WL-02", total_aed: 8_000 },
    ]));
    expect(parity.elements.every((e) => e.status !== "fail")).toBe(true);
    expect(parity.elements.find((e) => e.id === "r-living")!.status).toBe("ok");
    expect(parity.elements.find((e) => e.id === "r-master")!.status).toBe("exempt");
    const list = buildChecklist({ projectId: P, readiness: ready, parity, documentName: "Mudon Villa — Refit" });
    expect(checklistReady(list)).toBe(true);
  });

  it("blocks only genuinely unpriced interior scope: rooms drawn, no interior work priced", () => {
    const parity = buildParity(interiorParity([{ rule_id: "FL-01", total_aed: 0 }]));
    const list = buildChecklist({ projectId: P, readiness: ready, parity, documentName: "Mudon Villa — Refit" });
    const priced = list.find((c) => c.key === "priced")!;
    expect(priced.ok).toBe(false);
    expect(priced.items).toHaveLength(2);
    expect(priced.items[0]).toMatch(/^Living — interior room drawn, but the BoQ prices no interior work/);
    expect(priced.fix?.href).toBe(`/project/${P}/boq`);
  });
});

describe("pack export gate — garden projects keep their refusals", () => {
  const garden: ParityInput = {
    lines: [{ rule_id: "GL-09", description: "Seating bench", quantity: 4, unit: "lm", total_aed: 5280, element_refs: ["bench"] }],
    elements: [
      { id: "bench", name: "Bench", table: "run", kind: "bench_run", status: "new" },
      { id: "deck", name: "Deck", table: "zone", kind: "deck", status: "new" },
    ],
    sheets: [{ sheetNumber: "L-100", ids: ["bench", "deck"] }],
    views: [{ camera: "zone:a", label: "Court", ids: ["bench", "deck"] }],
  };

  it("an unpriced drawn element blocks, by name, with where to fix it", () => {
    const list = buildChecklist({ projectId: P, readiness: ready, parity: buildParity(garden), documentName: "Arabella Garden — Draft for Review" });
    const priced = list.find((c) => c.key === "priced")!;
    expect(priced.ok).toBe(false);
    expect(priced.items.join(" ")).toMatch(/Deck/);
    expect(checklistReady(list)).toBe(false);
  });

  it("untyped counters and undecided items are listed by name", () => {
    const r = readinessFrom({ untypedCounters: ["Counter run (rear)"], undecided: ["Existing gazebo"], boqNeedsSelection: [] });
    const list = buildChecklist({ projectId: P, readiness: r, parity: null, documentName: "Arabella Garden" });
    expect(list.find((c) => c.key === "counters")).toMatchObject({ ok: false, items: ["Counter run (rear)"], fix: { href: `/project/${P}/plan` } });
    expect(list.find((c) => c.key === "undecided")).toMatchObject({ ok: false, items: ["Existing gazebo"] });
  });

  it("a mixed project gets both treatments", () => {
    const mixed = { ...garden, elements: [garden.elements[0]!], interior: interiorParity([{ rule_id: "FL-01", total_aed: 900 }]).interior };
    const parity = buildParity(mixed);
    expect(parity.elements.filter((e) => e.status === "fail")).toEqual([]);
    expect(parity.elements.map((e) => e.id).sort()).toEqual(["bench", "r-living", "r-master"]);
  });
});

describe("a working name never reaches a client cover", () => {
  it.each([
    ["Villa 94 garden (ground truth)", true],
    ["Demo villa (dev)", true],
    ["Untitled project", true],
    ["", true],
    [null, true],
    ["Arabella Garden — Draft for Review", false],
    ["Contemporary Villa Garden — Completed Renovation", false],
  ])("%s → working=%s", (name, working) => {
    expect(isWorkingName(name)).toBe(working);
  });

  it("blocks with a readable reason", () => {
    const list = buildChecklist({ projectId: P, readiness: ready, parity: null, documentName: "Demo villa (dev)" });
    expect(list.find((c) => c.key === "name")).toMatchObject({ ok: false, detail: expect.stringMatching(/working name/) });
  });
});

describe("printed checks", () => {
  const base: PrintedInput = {
    scope: "interior",
    draftStatement: null,
    boq: { sections: [{ work_section: "Finishes", lines: [{ rule_id: "FL-01", description: "Floor tiling", total_aed: 100, rate_aed: 10 }] }], grand_total_aed: 100 },
    sheets: [{ sheetNumber: "A-101", kind: "as_built", title: "As-built", svg: "<svg/>" }],
    packPages: [],
    packPageKinds: [],
    boqPages: null,
    boqHtml: "",
    planHtml: null,
    parity: null,
    identityTokens: ["Acmeworks"],
    withheldNames: [],
    publicSourceLabel: "market reference",
    renders: null,
    pairsWithAdds: [],
  };

  it("with no BoQ PDF (a reference pack) the BoQ-PDF checks are not run, the rest are", () => {
    const labels = printedChecks(base).map((c) => c.label);
    expect(labels.filter((l) => !/identity/.test(l)).some((l) => /BoQ PDF/.test(l) || /^D5/.test(l))).toBe(false);
    expect(labels).toContain("drawings: the as-built plan is in the set");
  });

  it("an identity on any printed page fails the run", () => {
    const out = printedChecks({ ...base, sheets: [{ ...base.sheets[0]!, svg: "<svg><text>Acmeworks Landscaping</text></svg>" }] });
    expect(out.find((c) => /identity/.test(c.label))!.ok).toBe(false);
  });
});
