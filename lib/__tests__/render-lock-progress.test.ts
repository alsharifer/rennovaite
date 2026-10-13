import { describe, expect, it } from "vitest";

import { ownerStepStatuses, type JourneyFacts } from "@/lib/journey-state";
import { homeNext } from "@/lib/projects/home";
import { renderLockProgress } from "@/lib/render-lock-progress";

// K10 #5 — 03 Renders is Done only when every renderable view is locked;
// otherwise Available with "N / M locked", and Projects home's Next says so.

const rooms = [
  { id: "living", room_type: "living" },
  { id: "master", room_type: "master_bedroom" },
  { id: "bath", room_type: "bathroom" },
  { id: "stairs", room_type: "stairs" }, // nothing to photograph — not a view
  { id: "lawn", room_type: "artificial_grass" }, // an exterior zone is a view (G1b)
];

const facts = (renderViews: { locked: number; total: number }, over: Partial<JourneyFacts["owner"]> = {}): JourneyFacts =>
  ({
    projectId: "p1",
    planBlock: null,
    boq: null,
    firm: null,
    owner: { brief: true, moodboardItems: 3, renders: 9, renderViews, unpricedLines: 0, ...over },
  }) as unknown as JourneyFacts;

describe("render lock progress", () => {
  it("counts one view per renderable room or zone, and the locked ones", () => {
    expect(renderLockProgress(rooms, [])).toEqual({ locked: 0, total: 4 });
    expect(renderLockProgress(rooms, ["living", "stairs", "gone"])).toEqual({ locked: 1, total: 4 });
    expect(renderLockProgress(rooms, ["living", "master", "bath", "lawn"])).toEqual({ locked: 4, total: 4 });
  });

  it("Renders is Done only when every view is locked — rendering is not locking", () => {
    expect(ownerStepStatuses(facts({ locked: 4, total: 4 })).renders).toEqual({ state: "done" });
    expect(ownerStepStatuses(facts({ locked: 3, total: 4 })).renders).toEqual({ state: "available", reason: "3 / 4 locked", fix: { label: "Open renders", href: "/project/p1/render" } });
    // Nine renders, none locked: available, never done.
    expect(ownerStepStatuses(facts({ locked: 0, total: 4 }, { renders: 9 })).renders).toMatchObject({ state: "available", reason: "0 / 4 locked" });
    expect(ownerStepStatuses(facts({ locked: 0, total: 0 })).renders).toEqual({ state: "available" });
  });

  it("Projects home's Next carries the same reason — after an earlier step that needs attention", () => {
    const href = (k: string) => `/project/p1/${k}`;
    const s = ownerStepStatuses(facts({ locked: 7, total: 10 }));
    expect(homeNext("p1", "owner", s, href)).toEqual({ state: "available", step: "03 · RENDERS", reason: "7 / 10 locked", href: "/project/p1/render" });
    const design = ownerStepStatuses(facts({ locked: 7, total: 10 }, { moodboardItems: 1 }));
    expect(homeNext("p1", "owner", design, href)).toMatchObject({ state: "attention", step: "02 · DESIGN" });
    expect(homeNext("p1", "owner", ownerStepStatuses(facts({ locked: 10, total: 10 })), href)).toBeNull();
  });
});
