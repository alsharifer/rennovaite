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

  it("gives most zones a clean view, and every unclean one a stated reason", () => {
    const unclean = cameras.filter((c) => !c.clean);
    // A 4–6 m strip between a house and a wall cannot always be framed cleanly;
    // what matters is that the verdict is honest and the reason is printable.
    expect(unclean.length).toBeLessThanOrEqual(Math.ceil(cameras.length / 2));
    for (const c of unclean) expect(c.cleanReasons.length, c.label).toBeGreaterThan(0);
    const elevated = cameras.filter((c) => c.mode === "elevated");
    expect(elevated.length).toBeGreaterThanOrEqual(3);
    for (const c of elevated) {
      expect(c.pos[1]).toBeGreaterThanOrEqual(4.2);
      expect(c.fovDeg).toBeGreaterThanOrEqual(70);
    }
  });

  it("stands every camera inside the plot (G5c: never over the wall into the neighbour's land)", () => {
    const plot = graph.meta.plot!;
    for (const c of cameras.filter((x) => x.mode !== "aerial")) {
      expect(c.pos[0], c.label).toBeGreaterThanOrEqual(plot.origin_m[0]);
      expect(c.pos[0], c.label).toBeLessThanOrEqual(plot.origin_m[0] + plot.width_m);
      expect(c.pos[2], c.label).toBeGreaterThanOrEqual(plot.origin_m[1]);
      expect(c.pos[2], c.label).toBeLessThanOrEqual(plot.origin_m[1] + plot.depth_m);
    }
  });

  it("adds ONE aerial view of the whole garden, looking down at the garden's centre (G5c)", () => {
    const aerial = cameras.filter((c) => c.mode === "aerial");
    expect(aerial).toHaveLength(1);
    const a = aerial[0]!;
    expect(a.id).toBe("garden:aerial");
    expect(a.clean).toBe(true);
    // Well above the two-storey villa, and looking down.
    expect(a.pos[1]).toBeGreaterThan(8);
    expect(a.target[1]).toBeLessThan(a.pos[1]);
  });

  it("looks down different corridors for the whole-garden views", () => {
    const views = cameras.filter((c) => !c.zoneId && c.mode !== "aerial");
    expect(views.length).toBeGreaterThanOrEqual(2);
    const dir = (c: (typeof views)[number]) => Math.atan2(c.target[2] - c.pos[2], c.target[0] - c.pos[0]);
    expect(Math.abs(Math.cos(dir(views[0]!) - dir(views[1]!)))).toBeLessThanOrEqual(0.7);
  });
});

describe("what spends a render attempt", () => {
  it("G5c: every day view is attempted (clean or not); an evening only over a passed day", () => {
    // G5 skipped unclean cameras and shipped the flat design view. A pack whose
    // zone pages are design views is not client-viable, so the attempt is made and
    // the gate — not the camera score — decides what ships.
    expect(shouldAttemptRender({ clean: false }, "day", false)).toBe(true);
    expect(shouldAttemptRender({ clean: true }, "day", false)).toBe(true);
    expect(shouldAttemptRender({ clean: false }, "evening", true)).toBe(true);
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

  it("puts the before/after pairs right after the plan, captions a design view neutrally, and insets the design view on a passed render", () => {
    const { pages } = buildRenderPack({ graph, fixtures: p.fixtures, renders, style: null, projectName: "Arabella", community: "Dubai", dateISO: "2026-09-15", sitePlanSvg: null, photoPairs: [pair], gardenViews: [] });
    expect(pages.map((x) => x.kind).slice(0, 3)).toEqual(["cover", "plan_overview", "photo_pair"]);
    const all = pages.map((x) => x.svg).join("");
    // G5d: the client reads one neutral line; why a design view was chosen is in the run report.
    expect(all).toContain("Visualisation pending — layout as drawn, see L-100");
    expect(all).not.toContain("no camera position on this plot");
    expect(all).toContain("INSET: 3D DESIGN VIEW");
    expect(pages.flatMap((x) => x.images).some((s) => s.renderId === "design:r1")).toBe(true);
    expect(pages[0]!.svg).toContain("1 before/after");
  });
});
