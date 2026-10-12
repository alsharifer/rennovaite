import { describe, expect, it } from "vitest";

import { overviewNext } from "../overview-view";

// K8 #2 (spec §6.2, Figma 54:145) — the owner Overview's NEXT: the rail's own
// Attention / Blocked reasons, in journey order, max 3, in the owner's words.

const P = "p1";

describe("overviewNext", () => {
  const statuses = {
    plan: { state: "done" as const },
    design: { state: "attention" as const, reason: "Add references", fix: { label: "Pin references", href: `/project/${P}/design?view=references` } },
    cost: { state: "attention" as const, reason: "2 items not priced", fix: { label: "See what is not priced", href: `/project/${P}/boq` } },
    tender: { state: "blocked" as const, reason: "Price 2 items first", fix: { label: "Open cost", href: `/project/${P}/boq` } },
  };

  it("reads the frame's three actions from the rail, in order, with the rail's fixes", () => {
    const next = overviewNext(P, statuses, { direction: "Contemporary Majlis", unpriced: ["outdoor tap", "planting beds"] });
    expect(next.map((n) => n.step)).toEqual(["02 · DESIGN", "04 · COST", "06 · TENDER"]);
    expect(next[0]).toMatchObject({ title: "Add references for your design", blocked: false, action: { label: "Open design", href: `/project/${P}/design?view=references` } });
    expect(next[0]!.sentence).toBe("Your direction is Contemporary Majlis. Pin 3–6 images you like so every render is checked against them.");
    expect(next[1]).toMatchObject({ title: "2 items aren't priced yet", action: { label: "Review cost" } });
    expect(next[1]!.sentence).toBe("Outdoor tap and planting beds have no price, so they are left out of the total. Ask for a price or pick a product.");
    expect(next[2]).toMatchObject({ title: "Tender pack is locked", blocked: true, action: { label: "Why locked?" } });
  });

  it("nothing waiting → no actions; never more than three", () => {
    expect(overviewNext(P, { plan: { state: "done" } }, { direction: null, unpriced: [] })).toEqual([]);
    const many = { ...statuses, plan: { state: "attention" as const, reason: "The plan has 2 overlapping rooms" } };
    expect(overviewNext(P, many, { direction: null, unpriced: [] })).toHaveLength(3);
  });
});
