import { describe, expect, it } from "vitest";

import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import { buildPlanGraph } from "@/lib/plan/geometry";
import { buildManifest, chooseCameras } from "@/lib/scene/cameras";
import { buildGardenScene } from "@/lib/scene/garden-scene";
import { renderScene } from "@/lib/scene/raster";
import { manifestEquals, reuseVerdict, viewFingerprint, SHADOW_CLEAR_M } from "@/lib/scene/view-hash";

// G5d: a change at one end of a plot invalidated every render of it. A render is
// stale only when its own camera shows something different — or when something
// that changed is close enough to light or shadow the frame it is not in.

const rec = villa94PlanRecords();
const graphOf = (rooms: typeof rec.rooms) =>
  buildPlanGraph({ projectId: "villa-94", planId: "plan-1", scale: null, total_area_m2: 0, rooms, elements: rec.elements, context: rec.context, unit_to_m: rec.plot.width_m, plot: rec.plot, source: "user_drawn" });
const sceneOf = (rooms: typeof rec.rooms) => buildGardenScene({ graph: graphOf(rooms), fixtures: rec.fixtures, variants: Object.fromEntries(rec.elements.map((e) => [e.id, e.variant])) });

const scene = sceneOf(rec.rooms);
const cameras = chooseCameras(scene, graphOf(rec.rooms), rec.fixtures, new Set());
const manifestFor = (s: typeof scene, cam: (typeof cameras)[number]) => buildManifest("villa-94", cam.id, s, renderScene(s, cam, 600, 400, { supersample: 1 }));

/** Move one zone's polygon by 2 m — a real change, somewhere on the plot. */
function moved(zoneId: string) {
  return rec.rooms.map((r) => (r.id === zoneId ? { ...r, polygon: (r.polygon as [number, number][]).map(([x, y]) => [x + 2 / rec.plot.width_m, y] as [number, number]) } : r));
}

describe("view staleness — what a camera sees decides (G5d)", () => {
  it("reuses a render when its camera's manifest is identical and every change is far away", () => {
    const cam = cameras.find((c) => c.id === "zone:z-pergola")!;
    const before = manifestFor(scene, cam);
    const fp = viewFingerprint(scene);
    // A zone far from the pergola camera moves.
    const farZone = [...rec.rooms].sort((a, b) => {
      const d = (r: (typeof rec.rooms)[number]) => Math.hypot((r.polygon as [number, number][])[0]![0] * rec.plot.width_m - cam.pos[0], (r.polygon as [number, number][])[0]![1] * rec.plot.width_m - cam.pos[2]);
      return d(b) - d(a);
    })[0]!;
    const after = sceneOf(moved(farZone.id));
    const v = reuseVerdict({ storedManifest: before, currentManifest: manifestFor(after, cam), stored: fp, current: viewFingerprint(after), cameraPos: cam.pos });
    // Either the camera sees it (then it must NOT be reusable) or it does not and it is far.
    const sees = before.items.some((i) => i.key === `zone:${farZone.id}`);
    expect(v.reusable).toBe(!sees);
  });

  it("never reuses when the camera's own view changed", () => {
    const cam = cameras.find((c) => c.zoneId)!;
    const zoneId = cam.zoneId!;
    const after = sceneOf(moved(zoneId));
    const v = reuseVerdict({ storedManifest: manifestFor(scene, cam), currentManifest: manifestFor(after, cam), stored: viewFingerprint(scene), current: viewFingerprint(after), cameraPos: cam.pos });
    expect(v.reusable).toBe(false);
    expect(v.reasons[0]).toMatch(/shows something different|in view and changed/);
  });

  it("never reuses when something changed close enough to shadow the frame", () => {
    const cam = cameras[0]!;
    const fp = viewFingerprint(scene);
    // Same picture, but an object 2 m from the lens changed: a shadow could fall in.
    const nearKey = Object.entries(fp.centres).sort((a, b) => Math.hypot(a[1][0] - cam.pos[0], a[1][2] - cam.pos[2]) - Math.hypot(b[1][0] - cam.pos[0], b[1][2] - cam.pos[2]))[0]![0];
    const current = { objects: { ...fp.objects, [nearKey]: "changed" }, centres: fp.centres };
    const m = manifestFor(scene, cam);
    const v = reuseVerdict({ storedManifest: m, currentManifest: m, stored: fp, current, cameraPos: cam.pos });
    expect(v.reusable).toBe(false);
    const dist = Math.hypot(fp.centres[nearKey]![0] - cam.pos[0], fp.centres[nearKey]![1] - cam.pos[1], fp.centres[nearKey]![2] - cam.pos[2]);
    if (dist < SHADOW_CLEAR_M) expect(v.reasons.join(" ")).toMatch(/light or shadow|in view and changed/);
  });

  it("fails closed without a fingerprint, and compares manifests strictly", () => {
    const cam = cameras[0]!;
    const m = manifestFor(scene, cam);
    expect(reuseVerdict({ storedManifest: m, currentManifest: m, stored: null, current: viewFingerprint(scene), cameraPos: cam.pos }).reusable).toBe(false);
    expect(manifestEquals(m, m)).toBe(true);
    expect(manifestEquals(m, { ...m, items: m.items.slice(1) })).toBe(false);
    expect(manifestEquals(m, { ...m, cameraId: "other" })).toBe(false);
    expect(manifestEquals(m, { ...m, items: m.items.map((i, n) => (n === 0 ? { ...i, box: [0, 0, 1, 1] as [number, number, number, number] } : i)) })).toBe(false);
  });
});
