import { beforeAll, describe, expect, it } from "vitest";

import { arabellaSessionPlanInput } from "@/lib/client-garden/arabella-session";
import type { GardenFixture } from "@/lib/drawings/garden-sheets";
import { buildPlanGraph } from "@/lib/plan/geometry";
import { lightingByZone } from "@/lib/render-batch/plan";
import { buildManifest, chooseCameras, type CameraManifest, type GardenCamera } from "@/lib/scene/cameras";
import { buildGardenScene } from "@/lib/scene/garden-scene";
import type { Scene } from "@/lib/scene/mesh";
import { renderScene } from "@/lib/scene/raster";
import { gateChecks, imageSize, judge, judgePlacement, normalisePlacements, placementLandmarks, type GateCheck, type GateReply } from "@/lib/scene-render/gate";
import { arrangementLine } from "@/lib/scene-render/prompts";

// G5d — the gap the design session found: pp4/8/10 of the client pack each PASSED
// the faithfulness gate while showing three different arrangements of the same
// pergola, counter and bench. Every render is now held to the one scene on
// built-feature placement, so no two passed renders can disagree.

let scene: Scene;
let cameras: GardenCamera[];
const manifests = new Map<string, CameraManifest>();

beforeAll(async () => {
  const input = await arabellaSessionPlanInput();
  const graph = buildPlanGraph({ projectId: "arabella-session", planId: "plan-a", scale: null, total_area_m2: 0, rooms: input.rooms, elements: input.elements, context: input.context, openings: input.openings, unit_to_m: input.plot.width_m, plot: { ...input.plot, dims_derived: true }, source: "user_drawn" } as Parameters<typeof buildPlanGraph>[0]);
  const fixtures = input.fixtures as unknown as GardenFixture[];
  scene = buildGardenScene({ graph, fixtures, variants: input.variants });
  const lit = new Set([...lightingByZone(input.rooms.map((r) => ({ id: r.id, name_en: r.name_en, room_type: r.room_type, polygon: r.polygon })), fixtures).keys()]);
  cameras = chooseCameras(scene, graph, fixtures, lit);
  for (const cam of cameras) manifests.set(cam.id, buildManifest("arabella-session", cam.id, scene, renderScene(scene, cam, 600, 400, { supersample: 1 })));
});

/** A reply that reports every item exactly where the scene has it (a faithful render). */
function faithful(checks: GateCheck[], landmarks: GateCheck[], jitter = 0): GateReply {
  return {
    observations: checks.map((c) => ({ ref: c.ref, present: true, roughly_in_place: true, note: "" })),
    placements: [...checks.filter((c) => c.category === "structure"), ...landmarks].map((c) => ({ ref: c.ref, box: c.box.map((v, i) => v + (i % 2 === 0 ? jitter : 0)) as [number, number, number, number], instances: 1 })),
    extra_structures: [],
    extra_lights: [],
    same_viewpoint: true,
    summary: "",
  };
}

const withBoth = () =>
  [...manifests.entries()].filter(([, m]) => {
    const nouns = gateChecks(m).filter((c) => c.category === "structure").map((c) => c.noun);
    return nouns.some((n) => n.startsWith("BBQ counter")) && nouns.includes("built-in bench");
  });

describe("the scene holds the session's layout of record (G5d)", () => {
  it("puts the BBQ counter inside the pergola's footprint and the bench in the court", () => {
    const counter = scene.objects.find((o) => o.noun.startsWith("BBQ counter"))!;
    const bench = scene.objects.find((o) => o.noun === "built-in bench")!;
    expect(counter.zoneId).toBe("z-pergola");
    expect(bench.zoneId).toBe("z-court");
  });

  it("stands no neighbouring villa over the entrance side or the streets — only behind the rear wall", () => {
    const neighbours = scene.objects.filter((o) => o.key.startsWith("neighbour:"));
    expect(neighbours).toHaveLength(1);
    const tris = scene.tris.filter((t) => t.obj === neighbours[0]!.id);
    // Behind the rear boundary: every vertex is beyond the plot's rear edge (z < 0).
    expect(Math.max(...tris.flatMap((t) => [t.a[2], t.b[2], t.c[2]]))).toBeLessThan(0);
  });

  it("has at least one camera that sees the counter and the bench together", () => {
    expect(withBoth().length).toBeGreaterThan(0);
  });
});

describe("built-feature placement — every passed render agrees with the scene (G5d)", () => {
  it("passes a render that shows every built feature where the scene has it, once", () => {
    for (const [id, m] of manifests) {
      const checks = gateChecks(m);
      const landmarks = placementLandmarks(m);
      const v = judge(checks, faithful(checks, landmarks, 3), { placement: true, landmarks });
      expect(v.passed, `${id}: ${v.failures.join("; ")}`).toBe(true);
    }
  });

  it("fails the p8 defect: a bench on the other side of the wall", () => {
    let caught = 0;
    for (const [id, m] of manifests) {
      const checks = gateChecks(m);
      const landmarks = placementLandmarks(m);
      const bench = checks.find((c) => c.noun === "built-in bench");
      const wall = landmarks[0];
      if (!bench || !wall) continue;
      // Scene has the bench clear of the wall, left or right; the render puts it across.
      const benchLeft = bench.box[2] + 4 <= wall.box[0];
      const benchRight = wall.box[2] + 4 <= bench.box[0];
      if (!benchLeft && !benchRight) continue;
      const r = faithful(checks, landmarks);
      const w = bench.box[2] - bench.box[0];
      const across = benchLeft ? Math.min(100 - w, wall.box[2] + 2) : Math.max(0, wall.box[0] - 2 - w);
      r.placements = r.placements.map((p) => (p.ref === bench.ref ? { ...p, box: [across, bench.box[1], across + w, bench.box[3]] } : p));
      const res = judgePlacement(checks, r, landmarks).find((p) => p.ref === bench.ref)!;
      expect(res.ok, id).toBe(false);
      expect(res.reason).toMatch(/swapped|moved/);
      caught++;
    }
    expect(caught).toBeGreaterThan(0);
  });

  it("fails a second copy of the counter and a counter the render left out (the p4 'seating only' defect)", () => {
    const [id, m] = withBoth()[0]!;
    const checks = gateChecks(m);
    const counter = checks.find((c) => c.noun.startsWith("BBQ counter"))!;
    const dup = faithful(checks, []);
    dup.placements = dup.placements.map((p) => (p.ref === counter.ref ? { ...p, instances: 2 } : p));
    expect(judge(checks, dup, { placement: true }).failures.join("; "), id).toMatch(/duplicated — 2 shown, 1 designed/);
    const missing = faithful(checks, []);
    missing.placements = missing.placements.map((p) => (p.ref === counter.ref ? { ...p, box: null } : p));
    expect(judge(checks, missing, { placement: true }).failures.join("; ")).toMatch(/not located in the render/);
  });

  it("cannot pass two renders that show two different arrangements of the same structures", () => {
    // Any two passed renders of any two cameras order the counter and the bench as
    // the scene does; a render that swaps them cannot pass.
    for (const [id, m] of withBoth()) {
      const checks = gateChecks(m);
      const counter = checks.find((c) => c.noun.startsWith("BBQ counter"))!;
      const bench = checks.find((c) => c.noun === "built-in bench")!;
      const apart = counter.box[2] + 4 <= bench.box[0] || bench.box[2] + 4 <= counter.box[0];
      if (!apart) continue;
      const swapped = faithful(checks, []);
      swapped.placements = swapped.placements.map((p) => (p.ref === counter.ref ? { ...p, box: bench.box } : p.ref === bench.ref ? { ...p, box: counter.box } : p));
      expect(judge(checks, swapped, { placement: true }).passed, id).toBe(false);
    }
  });

  it("tells the restyle the arrangement, left to right, each once", () => {
    const [, m] = withBoth()[0]!;
    const line = arrangementLine(m);
    expect(line).toMatch(/from left to right in the frame/);
    expect(line).toMatch(/exactly one BBQ counter/);
    expect(line).toMatch(/one built-in bench/);
  });
});

describe("placement boxes are read in percent, whatever the model wrote (G5d)", () => {
  const reply = (boxes: ([number, number, number, number] | null)[]): GateReply => ({ observations: [], placements: boxes.map((box, i) => ({ ref: `S${i + 1}`, box, instances: 1 })), extra_structures: [], extra_lights: [], same_viewpoint: true, summary: "" });
  it("converts a pixel reply with the image's size — the replies that failed correct renders as 'moved'", () => {
    // A 1264 × 848 image: a counter at x 0–442, y 339–720 px is 0–35%, 40–85%.
    const r = normalisePlacements(reply([[0, 339, 442, 720], null]), { width: 1264, height: 848 });
    expect(r.placements[0]!.box).toEqual([0, 40, 35, 84.9]);
    expect(r.placements[1]!.box).toBeNull();
  });
  it("scales fractions, orders corners and leaves percent alone", () => {
    expect(normalisePlacements(reply([[0.1, 0.4, 0.35, 0.7]]), null).placements[0]!.box).toEqual([10, 40, 35, 70]);
    expect(normalisePlacements(reply([[35, 70, 10, 40]]), null).placements[0]!.box).toEqual([10, 40, 35, 70]);
    expect(normalisePlacements(reply([[10, 40, 35, 70]]), null).placements[0]!.box).toEqual([10, 40, 35, 70]);
  });
  it("reads a PNG's and a JPEG's size from its header", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    png.set([0, 0, 4, 0xb0, 0, 0, 3, 0x20], 16);
    expect(imageSize(png)).toEqual({ width: 1200, height: 800 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x03, 0x50, 0x04, 0xf0, 3, 0, 0, 0]);
    expect(imageSize(jpg)).toEqual({ width: 1264, height: 848 });
  });
});
