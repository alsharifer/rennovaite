import { describe, expect, it } from "vitest";

import { renderDemoSheet } from "@/lib/drawings/demo-sheet";
import { renderFinishSchedule, type FinishRow } from "@/lib/drawings/finish-schedule";
import { renderPlanSheet } from "@/lib/drawings/plan-sheet";
import type { SheetMeta } from "@/lib/drawings/sheet";
import { buildPlanGraph } from "@/lib/plan/geometry";

import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";

const META: SheetMeta = {
  projectNameEn: "Mudon pilot villa",
  projectNameAr: "الفاخر البسيط",
  community: "Mudon Al Naseem",
  level: "first floor",
  scale: "1:100",
  dateISO: "2026-07-28",
};

describe("drawing sheets render deterministic, valid SVG", () => {
  const graph = buildPlanGraph(MUDON_FIXTURE);

  it("as-built plan sheet is a true-size A3 SVG with rooms + dims", () => {
    const svg = renderPlanSheet(graph, META, { sheetNumber: "A-101", title: "As-Built Plan" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="420mm"');
    expect(svg).toContain('height="297mm"');
    expect(svg).toContain("Master Bedroom");
    expect(svg).toContain("A-101");
    expect(svg).toContain("RennovAIte");
    // a dimension value (envelope width in mm) should appear
    expect(/>\d{3,5}</.test(svg)).toBe(true);
  });

  it("demo sheet renders and reports no changes when proposed === as-built", () => {
    const svg = renderDemoSheet(graph, graph, META, { sheetNumber: "A-102", title: "Proposed / Demolition Plan" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("DEMOLITION PLAN");
    expect(svg).toContain("proposed matches as-built");
  });

  it("finish schedule renders one group per room", () => {
    const rows: FinishRow[] = graph.rooms.flatMap((r) => [
      { room: r.name_en, surface: "Floor" as const, material: "Oak", area_m2: r.area_m2, notes: "x", groupStart: true },
      { room: r.name_en, surface: "Wall" as const, material: "Paint", area_m2: 10, notes: "" },
      { room: r.name_en, surface: "Ceiling" as const, material: "Plaster", area_m2: r.area_m2, notes: "" },
    ]);
    const svg = renderFinishSchedule(rows, META, { sheetNumber: "A-201", title: "Finish Schedule" });
    expect(svg).toContain("Finish Schedule");
    expect(svg).toContain("Master Bedroom");
    expect(svg).toContain("MATERIAL SPEC");
  });

  it("is deterministic (same input → identical output)", () => {
    const a = renderPlanSheet(graph, META, { sheetNumber: "A-101", title: "As-Built Plan" });
    const b = renderPlanSheet(graph, META, { sheetNumber: "A-101", title: "As-Built Plan" });
    expect(a).toBe(b);
  });
});
