import { describe, expect, it } from "vitest";

import { arabellaPlanInput, toSite, toSitePath, PLOT, X } from "@/lib/client-garden/arabella-reference";
import { computeGardenTakeoff } from "@/lib/boq/garden-takeoff";
import { buildPlanGraph } from "@/lib/plan/geometry";
import { consistencyPrompt, judgeConsistency, parseConsistencyReply } from "@/lib/scene-render/consistency";
import { designSpec, specHash } from "@/lib/scene-render/design-spec";
import { getGardenStyle } from "@/lib/garden-styles";
import { dayPrompt } from "@/lib/scene-render/prompts";
import type { CameraManifest } from "@/lib/scene/cameras";

const same = { same: true, note: "" };

describe("cross-view consistency (G5c)", () => {
  it("fails a view whose pergola or paving differs from the anchor, and only on what was seen", () => {
    expect(judgeConsistency({ pergola_design: same, paving_material: same, planting_palette: same, wall_finish: same, summary: "" }).passed).toBe(true);
    const v = judgeConsistency({ pergola_design: { same: false, note: "fabric sails here, louvres in the anchor" }, paving_material: same, planting_palette: { same: null, note: "not visible" }, wall_finish: same, summary: "" });
    expect(v.passed).toBe(false);
    expect(v.failures).toEqual(["inconsistent pergola design with the anchor view (fabric sails here, louvres in the anchor)"]);
    // Not visible in one image is not a difference.
    expect(judgeConsistency({ pergola_design: { same: null, note: "" }, paving_material: same, planting_palette: same, wall_finish: same, summary: "" }).passed).toBe(true);
  });

  it("parses the reply shapes models send, and never passes on an unparseable one", () => {
    const r = parseConsistencyReply('prose before {"pergola_design":{"same":true},"paving_material":{"same":false,"note":"grey slabs"},"planting_palette":{"same":null},"wall_finish":{"same":true},"summary":"x"} after')!;
    expect(r).not.toBeNull();
    expect(judgeConsistency(r).failures).toEqual(["inconsistent paving material with the anchor view (grey slabs)"]);
    expect(parseConsistencyReply("cannot compare")).toBeNull();
  });

  it("tells the model the camera will differ and the design must not", () => {
    const p = consistencyPrompt("Design specification — pergola: louvred.");
    expect(p).toContain("Design specification — pergola: louvred.");
    expect(p).toContain("Camera, framing, light and which part of the garden is shown WILL differ");
  });
});

describe("the shared design specification (G5c)", () => {
  const input = arabellaPlanInput({ gazebo: "replace", path: "replace", "sink-counter": "replace", "planter-rear": "remove", "planter-side": "remove", "lights-corner": "replace", "lights-across": "replace", "tree-1": "keep", "tree-2": "keep", palm: "keep", "tree-3": "keep", "tree-4": "keep", "tree-5": "keep", shed: "keep" });
  // The design the seed applies: a louvred pergola in the gazebo footprint, porcelain
  // paving, planting beds and a BBQ counter.
  const design = [
    { id: "z-pergola", name_en: "Louvred pergola", name_ar: null, room_type: "structure", area_m2: 12.25, polygon: [[0, 0], [0.13, 0], [0.13, 0.13], [0, 0.13]] as [number, number][], unroofed: true, height_mm: 2800, spec: { variant: "louvered", system: "Motorised louvred aluminium pergola" }, dims_derived: true },
    { id: "z-court", name_en: "Pergola court", name_ar: null, room_type: "paving", area_m2: 13.98, polygon: [[0.14, 0], [0.24, 0], [0.24, 0.13], [0.14, 0.13]] as [number, number][], unroofed: true, dims_derived: true },
    { id: "z-bed", name_en: "Rear planting bed", name_ar: null, room_type: "planting_bed", area_m2: 12.36, polygon: [[0.3, 0], [0.9, 0], [0.9, 0.02], [0.3, 0.02]] as [number, number][], unroofed: true, dims_derived: true },
  ];
  const bbq = { id: "r-bbq", kind: "counter_run" as const, polyline: [[0.02, 0.03], [0.12, 0.03]] as [number, number][], height_mm: 900, width_mm: 900, source: "user_drawn", derived: true, spec: { name: "BBQ counter" }, dims_derived: true };
  const graph = buildPlanGraph({ projectId: "a", planId: "p", scale: null, total_area_m2: 0, rooms: [...input.rooms, ...design] as never, elements: [...input.elements, bbq] as never, context: input.context, openings: input.openings, unit_to_m: input.plot.width_m, plot: input.plot, source: "user_drawn" });
  const spec = designSpec(graph, input.fixtures as never, { "r-bbq": "bbq" }, getGardenStyle("desert-modern")!);

  it("states ONE pergola design, the paving size, the planting palette and the kept trees", () => {
    expect(spec).toContain("ONE design everywhere");
    expect(spec).toContain("1200 × 600 mm porcelain");
    expect(spec).toContain("agave");
    expect(spec).toContain("built-in stainless-steel gas grill and an inset stainless sink");
    expect(spec).toContain("existing trees kept exactly as they are (frangipani, palm)");
    expect(spec).toContain("Add no planters, screens, water features, steps or structures that are not in the model");
  });

  it("is the same text for every view and part of the cache key", () => {
    const again = designSpec(graph, input.fixtures as never, { "r-bbq": "bbq" }, getGardenStyle("desert-modern")!);
    expect(again).toBe(spec);
    expect(specHash(again)).toBe(specHash(spec));
    expect(specHash("other")).not.toBe(specHash(spec));
  });

  it("replaces the style's own feature list, which argued with the design", () => {
    const m: CameraManifest = { projectId: "a", cameraId: "c", items: [], counts: {} };
    const style = getGardenStyle("desert-modern")!;
    // Desert Modern's what_changes names corten planters and sandstone paving; with a
    // specification the style sets the mood only (those planters appeared in view
    // after view of the G5 pack, and the design has none).
    const withSpec = dayPrompt(m, style, { spec });
    expect(withSpec).not.toContain("corten");
    expect(withSpec).toContain("Mood — Desert Modern");
    expect(dayPrompt(m, style)).toContain("corten");
    expect(dayPrompt(m, style, { spec, anchor: true })).toContain("IMAGE 2 is a finished photograph of ANOTHER part of this same garden");
  });
});

describe("the mirror that fixed the plan (G5c)", () => {
  it("is one reflection, and every area and length is invariant under it", () => {
    expect(toSite(toSite([3, 4]))).toEqual([3, 4]);
    expect(toSite([0, 1])).toEqual([PLOT.width_m, 1]);
    // The side garden is at the far end of the type plan and at the near end on site.
    expect(toSite([X.plot, 0])[0]).toBe(0);
    const path = [[1, 2], [5, 2], [5, 6]] as [number, number][];
    const mirrored = toSitePath(path);
    const len = (p: [number, number][]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1]), 0);
    expect(len(mirrored)).toBeCloseTo(len(path), 9);
    // Reversed with the reflection, so a run's band side keeps its orientation.
    expect(mirrored[0]).toEqual(toSite(path[2]!));
  });

  it("prices the mirrored garden identically — the same take-off, line for line", () => {
    const capture = (mirror: boolean) => {
      const input = arabellaPlanInput({ gazebo: "replace", path: "replace", "sink-counter": "replace", "planter-rear": "remove", "planter-side": "remove", "lights-corner": "replace", "lights-across": "replace", "tree-1": "keep", "tree-2": "keep", palm: "keep", "tree-3": "keep", "tree-4": "keep", "tree-5": "keep", shed: "keep" });
      const flip = (p: [number, number]): [number, number] => [1 - p[0], p[1]];
      const rooms = mirror ? input.rooms.map((r) => ({ ...r, polygon: r.polygon.map(flip).reverse() })) : input.rooms;
      const elements = mirror ? input.elements.map((e) => ({ ...e, polyline: e.polyline.map(flip).reverse() })) : input.elements;
      const graph = buildPlanGraph({ projectId: "a", planId: "p", scale: null, total_area_m2: 0, rooms, elements, context: input.context, unit_to_m: input.plot.width_m, plot: input.plot, source: "user_drawn" });
      return computeGardenTakeoff({
        zones: graph.rooms.map((r) => ({ id: r.id, name: r.name_en, kind: r.type ?? "", area_m2: r.area_m2, site_reference: r.site_reference, disposition: r.disposition as never, dims_derived: true })),
        runs: graph.elements.map((e) => ({ id: e.id, kind: e.kind, length_m: e.length_m, site_reference: e.site_reference, disposition: e.disposition as never, dims_derived: true })),
      });
    };
    const before = capture(false);
    const after = capture(true);
    const key = (t: ReturnType<typeof capture>) => t.items.map((i) => `${i.item_key}|${i.quantity}|${i.unit}`).sort();
    expect(key(after)).toEqual(key(before));
    expect(after.elements.map((e) => `${e.item_key}|${e.element_id}|${e.qty}`).sort()).toEqual(before.elements.map((e) => `${e.item_key}|${e.element_id}|${e.qty}`).sort());
  });
});
