import { describe, expect, it } from "vitest";

import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import { buildPlanGraph } from "@/lib/plan/geometry";
import { lightingByZone, planSceneBatch } from "@/lib/render-batch/plan";
import { buildManifest, chooseCameras } from "@/lib/scene/cameras";
import { buildGardenScene } from "@/lib/scene/garden-scene";
import { encodePng } from "@/lib/scene/png";
import { renderScene } from "@/lib/scene/raster";
import { gateChecks, gatePrompt, judge, parseGateReply, type GateReply } from "@/lib/scene-render/gate";
import { dayPrompt, isInfrastructureFailure, isStaleEveningSubstitution, sceneCacheKey, sceneHash } from "@/lib/scene-render/prompts";
import { getGardenStyle } from "@/lib/garden-styles";

const rec = villa94PlanRecords();
const graphFor = (projectId: string) =>
  buildPlanGraph({
    projectId,
    planId: `plan-${projectId}`,
    scale: null,
    total_area_m2: 0,
    rooms: rec.rooms,
    elements: rec.elements,
    context: rec.context,
    unit_to_m: rec.plot.width_m,
    plot: rec.plot,
    source: "user_drawn",
  });
const variants = Object.fromEntries(rec.elements.map((e) => [e.id, e.variant]));
const graph = graphFor("villa-94");
const scene = buildGardenScene({ graph, fixtures: rec.fixtures, variants });
const lit = new Set([...lightingByZone(rec.rooms, rec.fixtures).keys()]);
const cameras = chooseCameras(scene, graph, rec.fixtures, lit);

describe("the 3D garden scene", () => {
  it("contains every structure the plan holds, at the plan's heights", () => {
    const nouns = scene.objects.filter((o) => o.category === "structure").map((o) => o.noun).sort();
    expect(nouns).toEqual(["BBQ counter", "arched wall feature", "bar counter", "built-in bench", "built-in grill", "louvred pergola", "raised planter", "square planter box"].sort());
    const topOf = (key: string) => {
      const id = scene.objects.find((o) => o.key === key)!.id;
      return Math.max(...scene.tris.filter((t) => t.obj === id).flatMap((t) => [t.a[1], t.b[1], t.c[1]]));
    };
    expect(topOf("structure:z-pergola")).toBeCloseTo(2.8, 6);
    expect(topOf("run:r-counter-bbq")).toBeCloseTo(0.9, 6);
    expect(topOf("run:r-counter-bar")).toBeCloseTo(1.0, 6);
    expect(topOf("run:r-bench-l")).toBeCloseTo(0.35, 6);
    expect(topOf("unit:u-wall-feature")).toBeCloseTo(1.8, 6);
    expect(topOf("ctx:c-steps-west-300")).toBeCloseTo(0.3, 6);
    // The courtyard stands at +300.
    expect(topOf("zone:z-paving-courtyard")).toBeCloseTo(0.32, 6);
  });

  it("renders the same bytes every time", () => {
    const cam = cameras[0]!;
    const a = renderScene(scene, cam, 120, 80);
    const b = renderScene(scene, cam, 120, 80);
    expect(Buffer.from(encodePng(a.rgb, 120, 80, 3)).equals(Buffer.from(encodePng(b.rgb, 120, 80, 3)))).toBe(true);
  });
});

describe("cameras and manifests", () => {
  it("gives every zone a camera that sees it, plus whole-garden views", () => {
    const zoneCams = cameras.filter((c) => c.zoneId);
    expect(zoneCams).toHaveLength(12);
    expect(cameras.filter((c) => !c.zoneId).length).toBeGreaterThanOrEqual(2);
    for (const cam of zoneCams) {
      const m = buildManifest("villa-94", cam.id, scene, renderScene(scene, cam, 300, 200, { supersample: 1 }));
      expect(m.items.some((i) => i.key === `zone:${cam.zoneId}`), cam.id).toBe(true);
    }
  });

  it("puts the pergola camera's pergola and both counters on the gate's list", () => {
    const cam = cameras.find((c) => c.id === "zone:z-pergola")!;
    const m = buildManifest("villa-94", cam.id, scene, renderScene(scene, cam, 600, 400, { supersample: 1 }));
    const nouns = gateChecks(m).filter((c) => c.category === "structure").map((c) => c.noun);
    for (const n of ["louvred pergola", "BBQ counter", "bar counter"]) expect(nouns).toContain(n);
    expect(m.projectId).toBe("villa-94");
  });
});

describe("the faithfulness gate's pass rule", () => {
  const cam = cameras.find((c) => c.id === "zone:z-pergola")!;
  const m = buildManifest("villa-94", cam.id, scene, renderScene(scene, cam, 600, 400, { supersample: 1 }));
  const checks = gateChecks(m);
  const allGood = (): GateReply => ({ observations: checks.map((c) => ({ ref: c.ref, present: true, roughly_in_place: true, note: "" })), extra_structures: [], extra_lights: [], same_viewpoint: true, summary: "" });

  it("passes only when everything is present, in place, from the same camera", () => {
    expect(judge(checks, allGood()).passed).toBe(true);
  });

  it("fails a missing pergola", () => {
    const r = allGood();
    const ref = checks.find((c) => c.noun === "louvred pergola")!.ref;
    r.observations = r.observations.map((o) => (o.ref === ref ? { ...o, present: false } : o));
    const v = judge(checks, r);
    expect(v.passed).toBe(false);
    expect(v.failures[0]).toMatch(/pergola: missing/);
  });

  it("tells the gate a louvred pergola is not shade sails (G5), and only when one is in view", () => {
    expect(gatePrompt(checks, {})).toContain("shade sails, fabric canopies, open timber rafters or a pitched roof are a DIFFERENT structure");
    expect(gatePrompt(checks.filter((c) => !c.noun.includes("louvred")), {})).not.toContain("louvre blades");
  });

  it("checks an existing tree the design keeps, once visible, and tells the renderer to keep it (G5)", () => {
    const item = (noun: string, share: number) => ({ key: "plants:" + noun + share, noun, label: noun, category: "planting" as const, zoneId: null, share, box: [10, 20, 30, 60] as [number, number, number, number] });
    const m = { projectId: "p", cameraId: "c", counts: {}, items: [item("existing palm tree (kept)", 0.05), item("tree", 0.2), item("existing tree (kept)", 0.002)] };
    const kept = gateChecks(m);
    expect(kept.map((c) => [c.ref, c.noun])).toEqual([["T1", "existing palm tree (kept)"]]);
    const r = { observations: [{ ref: "T1", present: false, roughly_in_place: false, note: "" }], extra_structures: [], extra_lights: [], same_viewpoint: true, summary: "" };
    expect(judge(kept, r).failures).toEqual(["T1 existing palm tree (kept): missing"]);
    expect(dayPrompt(m, getGardenStyle("desert-modern")!)).toContain("the existing trees the client is keeping — palm tree (10–30% across, 20–60% down)");
  });

  it("fails an invented structure, a changed viewpoint and an unassessed item", () => {
    expect(judge(checks, { ...allGood(), extra_structures: [{ description: "a pool", major: true }] }).passed).toBe(false);
    expect(judge(checks, { ...allGood(), extra_structures: [{ description: "cushions", major: false }] }).passed).toBe(true);
    expect(judge(checks, { ...allGood(), same_viewpoint: false }).passed).toBe(false);
    expect(judge(checks, { ...allGood(), observations: allGood().observations.slice(1) }).passed).toBe(false);
  });

  it("never reads an unparseable reply as a pass", () => {
    expect(parseGateReply("I think it looks fine.")).toBeNull();
  });

  it("fails an evening that lights a place with no designed light", () => {
    const withLights = { ...allGood(), extra_lights: [{ description: "wall lights on the north boundary wall", major: true }] };
    const v = judge(checks, withLights);
    expect(v.passed).toBe(false);
    expect(v.failures).toContain("undesigned light: wall lights on the north boundary wall");
    expect(judge(checks, { ...allGood(), extra_lights: [{ description: "soft spill beside an uplight", major: false }] }).passed).toBe(true);
  });

  it("asks about lights only when it is given the night model", () => {
    expect(gatePrompt(checks, m.counts)).not.toContain("extra_lights");
    expect(gatePrompt(checks, m.counts, { nightModel: true })).toContain("IMAGE 3 is the same design model at night");
    // A day reply without the field still parses, with no lights to judge.
    expect(parseGateReply(JSON.stringify({ observations: [], same_viewpoint: true }))!.extra_lights).toEqual([]);
  });
});

describe("infrastructure faults are not verdicts", () => {
  it("treats attempts that never produced an image as an infrastructure failure", () => {
    expect(isInfrastructureFailure([{ image_url: "" }, { image_url: "" }])).toBe(true);
    expect(isInfrastructureFailure([{ image_url: "" }, { image_url: "https://img/a2.jpg" }])).toBe(false);
    expect(isInfrastructureFailure([])).toBe(false);
  });

  it("re-renders an evening shipped as the night view only while no day had passed", () => {
    expect(isStaleEveningSubstitution("evening", [], true)).toBe(true);
    expect(isStaleEveningSubstitution("evening", [], false)).toBe(false);
    // An evening that was attempted and failed the gate stands.
    expect(isStaleEveningSubstitution("evening", [{ attempt: 1 }], true)).toBe(false);
    expect(isStaleEveningSubstitution("day", [], true)).toBe(false);
  });
});

describe("project isolation — the render cache key", () => {
  it("never collides for a same-named zone in two projects with identical gardens", () => {
    // The client garden seeded from the same records: same zone ids, same names,
    // same geometry, same cameras, same scene — everything but the project.
    const other = graphFor("client-garden");
    const otherScene = buildGardenScene({ graph: other, fixtures: rec.fixtures, variants });
    const otherCams = chooseCameras(otherScene, other, rec.fixtures, lit);
    expect(sceneHash(otherScene)).toBe(sceneHash(scene));
    const camA = cameras.find((c) => c.id === "zone:z-lawn-back")!;
    const camB = otherCams.find((c) => c.id === "zone:z-lawn-back")!;
    expect(camB.pos).toEqual(camA.pos);
    const key = (projectId: string, cam: typeof camA) => sceneCacheKey({ projectId, cameraId: cam.id, view: "day", sceneHash: sceneHash(scene), styleKey: "desert-modern", camera: cam });
    expect(key("villa-94", camA)).not.toBe(key("client-garden", camB));
    expect(key("villa-94", camA)).toBe(key("villa-94", camA));
    expect(() => key("", camA)).toThrow(/projectId is required/);
    // Choosing a second full camera set renders a few hundred probe views.
  }, 30_000);

  it("changes the key when the view, style or scene changes", () => {
    const cam = cameras[0]!;
    const k = (o: Partial<Parameters<typeof sceneCacheKey>[0]>) => sceneCacheKey({ projectId: "p", cameraId: cam.id, view: "day", sceneHash: "h", styleKey: "desert-modern", camera: cam, ...o });
    expect(new Set([k({}), k({ view: "evening" }), k({ styleKey: "courtyard-majlis" }), k({ sceneHash: "h2" })]).size).toBe(4);
  });
});

describe("the garden batch plans by camera", () => {
  it("queues a day per camera, an evening per lit camera once its day exists", () => {
    const cams = cameras.map((c) => ({ id: c.id, label: c.label, zone_id: c.zoneId, lit: c.lit }));
    const first = planSceneBatch(cams, []);
    expect(first.filter((j) => j.view === "day")).toHaveLength(cams.length);
    expect(first.filter((j) => j.view === "evening").every((j) => j.status === "blocked")).toBe(true);
    const rows = cams.map((c, i) => ({ id: `r${i}`, camera: c.id, view: "day", status: "succeeded" }));
    const second = planSceneBatch(cams, rows);
    expect(second.filter((j) => j.view === "evening").every((j) => j.status === "queued")).toBe(true);
    expect(second.every((j) => j.camera_id)).toBe(true);
  });

  it("says which done views shipped as the 3D design view", () => {
    const cams = cameras.slice(0, 2).map((c) => ({ id: c.id, label: c.label, zone_id: c.zoneId, lit: false }));
    const rows = [
      { id: "a", camera: cams[0]!.id, view: "day", status: "succeeded", gate: { outcome: "passed" } },
      { id: "b", camera: cams[1]!.id, view: "day", status: "succeeded", gate: { outcome: "substituted" } },
    ];
    expect(planSceneBatch(cams, rows).map((j) => j.outcome)).toEqual(["passed", "substituted"]);
    expect(planSceneBatch(cams, []).map((j) => j.outcome)).toEqual([null, null]);
  });
});
