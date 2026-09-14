import { describe, expect, it } from "vitest";

import { arabellaPlanInput } from "@/lib/client-garden/arabella-reference";
import { buildRenderPack, packMix, type PackRender } from "@/lib/documents/render-pack";
import { buildPlanGraph } from "@/lib/plan/geometry";
import { lightingByZone } from "@/lib/render-batch/plan";
import { chooseCameras, clearWidth, NARROW_M } from "@/lib/scene/cameras";
import { buildGardenScene } from "@/lib/scene/garden-scene";
import { shouldAttemptRender } from "@/lib/scene-render/prompts";

// The client garden with a plausible design pass: strips 4.2–5.5 m wide between
// the house and the boundary walls — the case that invented a house at eye level.
const p = arabellaPlanInput({ gazebo: "keep", path: "replace", "sink-counter": "replace", "planter-rear": "keep", "planter-side": "remove", "lights-corner": "keep", "lights-across": "remove", "tree-5": "remove" });
const graph = buildPlanGraph({ projectId: "arabella", planId: "p", scale: null, total_area_m2: 0, rooms: p.rooms, elements: p.elements, context: p.context, unit_to_m: p.plot.width_m, plot: p.plot, source: "user_drawn" });
const scene = buildGardenScene({ graph, fixtures: p.fixtures });
const cameras = chooseCameras(scene, graph, p.fixtures, new Set([...lightingByZone(p.rooms, p.fixtures).keys()]));

describe("cameras on a narrow plot", () => {
  it("reads the strips as narrow", () => {
    expect(clearWidth(graph, [10, 2]).min).toBeLessThan(NARROW_M); // rear strip
    expect(clearWidth(graph, [24.5, 7]).min).toBeLessThan(NARROW_M); // side garden
  });

  it("never stands an eye-level camera where there is no room to stand back", () => {
    for (const c of cameras.filter((x) => x.mode === "eye" && x.clean)) {
      expect(clearWidth(graph, [c.pos[0], c.pos[2]]).min, c.label).toBeGreaterThanOrEqual(NARROW_M);
    }
  });

  it("finds a clean up-and-back view for every zone and both whole-garden views", () => {
    for (const c of cameras) {
      expect(c.clean, `${c.label}: ${c.cleanReasons.join("; ")}`).toBe(true);
    }
    const elevated = cameras.filter((c) => c.mode === "elevated");
    expect(elevated.length).toBeGreaterThanOrEqual(5);
    for (const c of elevated) {
      expect(c.pos[1]).toBeGreaterThanOrEqual(4.2);
      expect(c.fovDeg).toBeGreaterThanOrEqual(70);
    }
  });

  it("looks down two different corridors for the whole-garden views", () => {
    const views = cameras.filter((c) => !c.zoneId);
    expect(views).toHaveLength(2);
    const dir = (c: (typeof views)[number]) => Math.atan2(c.target[2] - c.pos[2], c.target[0] - c.pos[0]);
    expect(Math.abs(Math.cos(dir(views[0]!) - dir(views[1]!)))).toBeLessThanOrEqual(0.7);
  });
});

describe("a camera with no clean view spends no render", () => {
  it("attempts only from a clean camera, and an evening only over a passed day", () => {
    expect(shouldAttemptRender({ clean: false }, "day", false)).toBe(false);
    expect(shouldAttemptRender({ clean: false }, "evening", true)).toBe(false);
    expect(shouldAttemptRender({ clean: true }, "day", false)).toBe(true);
    expect(shouldAttemptRender({ clean: true }, "evening", false)).toBe(false);
    expect(shouldAttemptRender({}, "day", false)).toBe(true);
  });
});

describe("the pack's backbone", () => {
  const byChoice: PackRender = { id: "d1", image_url: "u", kind: "design_view", gate_passed: false, by_choice: true };
  const afterGate: PackRender = { id: "d2", image_url: "u", kind: "design_view", gate_passed: false, note: "viewpoint changed" };
  const passed: PackRender = { id: "r1", image_url: "u", kind: "render", gate_passed: true, design: { id: "design:r1" } };
  const zones = graph.rooms.filter((r) => r.unroofed);
  const renders = Object.fromEntries(zones.map((z, i) => [z.id, { day: i === 0 ? passed : i === 1 ? afterGate : byChoice, evening: null }]));
  const pair = { id: "pp", zoneName: "Side garden — lawn", beforeId: "before:pp", after: { id: "pp", image_url: "u", kind: "photo_edit" as const, gate_passed: true }, caption: "restyle" };

  it("counts the mix: pairs and design views as the backbone, styled renders where the gate passed", () => {
    expect(packMix({ renders, gardenViews: [], photoPairs: [pair] })).toEqual({ photo_pairs: 1, design_views_by_choice: zones.length - 2, design_views_after_gate: 1, styled_renders: 1, missing: 0 });
  });

  it("puts the before/after pairs right after the plan, says why a design view was chosen, and insets the design view on a passed render", () => {
    const { pages } = buildRenderPack({ graph, fixtures: p.fixtures, renders, style: null, projectName: "Arabella", community: "Dubai", dateISO: "2026-09-15", sitePlanSvg: null, photoPairs: [pair], gardenViews: [] });
    expect(pages.map((x) => x.kind).slice(0, 3)).toEqual(["cover", "plan_overview", "photo_pair"]);
    const all = pages.map((x) => x.svg).join("");
    expect(all).toContain("shown by choice: no camera position on this plot gives a styled render a clean view");
    expect(all).toContain("INSET: 3D DESIGN VIEW");
    expect(pages.flatMap((x) => x.images).some((s) => s.renderId === "design:r1")).toBe(true);
    expect(pages[0]!.svg).toContain("1 before/after");
  });
});
