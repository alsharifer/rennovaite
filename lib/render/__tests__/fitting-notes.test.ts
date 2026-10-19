import { describe, expect, it } from "vitest";

import { fittingNotes } from "@/lib/render/fitting-notes";
import { carryLocated, checkItemsFor, detectionPrompt, judgePhotoPlacement, type PlanLite } from "@/lib/render/photo-check";
import { restylePrompt } from "@/lib/render/photo-restyle";

// The pilot bathroom in normalised space (2.66 m across): WC on the west wall at
// 1.21 m from the north, the cabinet where the bidet was (2.12 m), the shattaf
// between them on the west wall — right of the WC when seated (it faces east).
const n = (xCm: number, yCm: number): [number, number] => [xCm / 266, yCm / 266];
const PLAN: PlanLite = {
  openings: [{ id: "door", kind: "door", position: n(161.5, 263), width_mm: 870 }],
  fixtures: [
    { id: "wc", type: "wc_point", position: n(33, 121), spec: { width_mm: 420, depth_mm: 660 } },
    { id: "cabinet", type: "storage_cabinet", position: n(28, 212), spec: { width_mm: 400, depth_mm: 450, replaces: "bidet_point" } },
    { id: "shattaf", type: "shattaf_point", position: n(2, 152), spec: null },
  ],
};

describe("a fixture that replaces another in the same spot", () => {
  const items = checkItemsFor(PLAN);
  const cab = items.find((i) => i.plan_id === "cabinet")!;

  it("is read as the old item in the photo and the new one in the render", () => {
    expect(cab.replaces?.short).toBe("bidet");
    expect(detectionPrompt(items, "before")).toContain(`${cab.ref}: the bidet`);
    expect(detectionPrompt(items, "after")).toContain(`${cab.ref}: a white floor-standing storage cabinet`);
  });

  it("must stand in the same place, but its size is its own", () => {
    const before = { items: [{ ref: cab.ref, present: true, box: [60, 70, 80, 85] as [number, number, number, number], instances: 1 }] };
    const taller = { items: [{ ref: cab.ref, present: true, box: [60, 55, 80, 86] as [number, number, number, number], instances: 1 }] };
    expect(judgePhotoPlacement([cab], before, taller).passed).toBe(true);
    const moved = { items: [{ ref: cab.ref, present: true, box: [5, 55, 25, 86] as [number, number, number, number], instances: 1 }] };
    expect(judgePhotoPlacement([cab], before, moved).failures[0]?.reason).toBe("moved");
  });

  it("the restyle prompt swaps it in place", () => {
    const p = restylePrompt("edit_pro", { text: "warm stone.", source: "references", line: "", elements: [] } as never, [{ item: cab, box: [60, 70, 80, 85] }]);
    expect(p).toContain("Replace the bidet (bottom right of the frame) with a white floor-standing storage cabinet standing in the same spot; no bidet anywhere.");
  });
});

describe("where the shattaf goes in one view", () => {
  it("facing the WC (looking west) it is on the left of the WC — south, the right hand when seated", () => {
    expect(fittingNotes({ position: n(200, 140), heading_deg: 270 }, PLAN, true)[0]).toContain("to the left of the WC as seen in this photo");
  });
  it("looking north up the room it is on the left too; looking south, on the right", () => {
    expect(fittingNotes({ position: n(150, 250), heading_deg: 0 }, PLAN, true)[0]).toContain("to the left of the WC");
    expect(fittingNotes({ position: n(150, 40), heading_deg: 180 }, PLAN, true)[0]).toContain("to the right of the WC");
  });
  it("a view without the WC is told to drop the hand spray by the door; no shattaf, no line", () => {
    expect(fittingNotes({ position: n(60, 200), heading_deg: 90 }, PLAN, false)[0]).toContain("remove any hand spray");
    expect(fittingNotes(null, { ...PLAN, fixtures: PLAN.fixtures.filter((f) => f.type !== "shattaf_point") }, true)).toEqual([]);
  });
});

describe("a change checked against the plan's current items", () => {
  it("carries the parent's bidet reading onto the cabinet that replaces it, and the WC by its plan row", () => {
    const prevPlan: PlanLite = { openings: PLAN.openings, fixtures: [PLAN.fixtures[0]!, { id: "bidet", type: "bidet_point", position: n(28, 212), spec: null }] };
    const prev = checkItemsFor(prevPlan);
    const prevLocated = prev.map((it, i) => ({ ref: it.ref, present: true, box: [10 * i, 50, 10 * i + 8, 60] as [number, number, number, number], instances: 1 }));
    const next = checkItemsFor(PLAN);
    const carried = carryLocated(prev, prevLocated, next);
    const wcPrev = prevLocated.find((l) => l.ref === prev.find((p) => p.plan_id === "wc")!.ref)!;
    const bidetPrev = prevLocated.find((l) => l.ref === prev.find((p) => p.plan_id === "bidet")!.ref)!;
    expect(carried.find((l) => l.ref === next.find((x) => x.plan_id === "wc")!.ref)!.box).toEqual(wcPrev.box);
    expect(carried.find((l) => l.ref === next.find((x) => x.plan_id === "cabinet")!.ref)!.box).toEqual(bidetPrev.box);
  });
});

describe("a replacement that leaves the old item in place fails", () => {
  // Live, 19 Oct: an edit "replace the bidet with a cabinet" added a cabinet beside
  // the door and kept the bidet — and passed, because nothing asked about the bidet.
  const items = checkItemsFor(PLAN);
  const cab = items.find((i) => i.plan_id === "cabinet")!;
  const gone = items.find((i) => i.gone)!;
  const before = { items: [{ ref: cab.ref, present: true, box: [83, 70, 100, 85] as [number, number, number, number], instances: 1 }, { ref: gone.ref, present: true, box: [83, 70, 100, 85] as [number, number, number, number], instances: 1 }] };

  it("the replaced bidet is its own item, read as the bidet in both images", () => {
    expect(gone).toMatchObject({ short: "bidet", gone: true, plan_id: "cabinet:replaced" });
    expect(detectionPrompt(items, "after")).toContain(`${gone.ref}: the bidet`);
  });
  it("cabinet in its spot and the bidet still there → fails, the bidet named", () => {
    const after = { items: [{ ref: cab.ref, present: true, box: [73, 57, 93, 75] as [number, number, number, number], instances: 1 }, { ref: gone.ref, present: true, box: [84, 72, 100, 86] as [number, number, number, number], instances: 1 }] };
    const v = judgePhotoPlacement(items.filter((i) => i === cab || i === gone), before, after);
    expect(v.passed).toBe(false);
    expect(v.failures.map((f) => f.reason)).toContain("kept");
  });
  it("cabinet in its spot and no bidet → passes", () => {
    const after = { items: [{ ref: cab.ref, present: true, box: [82, 60, 100, 86] as [number, number, number, number], instances: 1 }, { ref: gone.ref, present: false, box: null, instances: 0 }] };
    expect(judgePhotoPlacement(items.filter((i) => i === cab || i === gone), before, after).passed).toBe(true);
  });
  it("the restyle prompt never asks to keep the replaced bidet", () => {
    const p = restylePrompt("edit_pro", { text: "warm stone.", source: "references", line: "", elements: [] } as never, [{ item: cab, box: [83, 70, 100, 85] }, { item: gone, box: [83, 70, 100, 85] }]);
    expect(p).not.toMatch(/stays exactly where it is[^.]*bidet/);
    expect(p).toContain("Replace the bidet");
  });
});
