import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildElevationSheets } from "@/lib/drawings/garden-elevations";
import { buildGardenSheets } from "@/lib/drawings/garden-sheets";
import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import { buildPlanGraph } from "@/lib/plan/geometry";

// K9 (K8 review ruling 5): drawings — and the render pack, a client document
// built on the same chrome — are INK ONLY. No brass, no terracotta, no hue:
// every colour a sheet module writes is an ink, a paper tint or a neutral grey.
const ROOT = path.resolve(__dirname, "../../..");
const DRAWINGS = path.join(ROOT, "lib", "drawings");
const files = [
  ...readdirSync(DRAWINGS)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(DRAWINGS, f)),
  path.join(ROOT, "lib", "documents", "render-pack.ts"),
];

const META = { projectNameEn: "Reference garden", projectNameAr: null, community: "Dubai", level: "ground", scale: "1:100", dateISO: "2026-10-13" };

/** Ink (Blueprint ink-900/700/600), paper tints (paper-50/100/200/300) and neutral greys. */
const ALLOWED = new Set(["#1A1D1F", "#4A5054", "#62676B", "#D6D1C5", "#F5F2EA", "#ECE8DE", "#FBFAF6", "#FFFFFF", "#E4E4E4", "#D9DCDF", "#E6E6E6"]);

describe("drawings are ink only", () => {
  it("no brass or terracotta anywhere in a sheet module", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, path.relative(ROOT, f)).not.toMatch(/\b(BRASS|TERRACOTTA)\b/);
      expect(src, path.relative(ROOT, f)).not.toMatch(/#A4793A|#9d3e1d|#FDF3EE/i);
    }
  });

  it("every colour literal is an ink, a paper tint or a neutral grey", () => {
    for (const f of files) {
      const hexes = readFileSync(f, "utf8").match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
      for (const h of hexes) expect(ALLOWED.has(h.toUpperCase()), `${path.relative(ROOT, f)}: ${h}`).toBe(true);
    }
  });

  // A source scan cannot see a colour a sheet borrows from elsewhere (the
  // editor's run hues in LINEAR_ELEMENT_META did exactly that), so the printed
  // sheets are checked too — measured, and as a draft with every outline
  // estimated (hatch + ring on every zone, the inverse draft band).
  it("every colour a printed garden sheet carries is ink, paper or grey", () => {
    for (const draft of [false, true]) {
      const rec = villa94PlanRecords();
      const rooms = draft ? rec.rooms.map((r) => ({ ...r, dims_derived: true })) : rec.rooms;
      const graph = buildPlanGraph({ projectId: "p", planId: "pl", scale: null, total_area_m2: rooms.reduce((s, r) => s + r.area_m2, 0), rooms, elements: rec.elements, context: rec.context, unit_to_m: rec.plot.width_m, plot: rec.plot, source: "user_drawn" });
      const sheets = [
        ...buildGardenSheets(graph, rec.fixtures, { ...META, ...(draft ? { draft: "DRAFT FOR REVIEW — derived" } : {}) }),
        ...buildElevationSheets(graph, rec.fixtures, META, Object.fromEntries(rec.elements.map((e) => [e.id, e.variant]))),
      ];
      expect(sheets.length).toBeGreaterThan(5);
      for (const s of sheets) {
        for (const h of s.svg.match(/#[0-9A-Fa-f]{6}\b/g) ?? []) expect(ALLOWED.has(h.toUpperCase()), `${s.sheetNumber}: ${h}`).toBe(true);
      }
      if (draft) {
        const site = sheets.find((s) => s.sheetNumber === "L-100")!.svg;
        expect(site).toContain('data-estimated="true"');
        expect(site).toContain('data-derived-mark="true"');
      }
    }
  });
});
