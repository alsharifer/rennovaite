import { describe, expect, it } from "vitest";

import { nextFromRail } from "../hub-view";

// K5a — the hub's Next column is the rail's own state (R7 §3.1): attention /
// blocked steps in journey order, max 3, each with the rail's reason and fix —
// and, when nothing needs attention, the first step not yet done.

const P = "00000000-0000-4000-8000-000000000001";
const flags = { drawingsEnabled: true };

describe("nextFromRail", () => {
  it("firm: the rail's attention and blocked steps, in order, with its reasons", () => {
    const next = nextFromRail(
      P,
      {
        persona: "firm",
        statuses: {
          hub: { state: "available" },
          rates_basis: { state: "attention", reason: "23 of 56 lines on market reference", fix: { label: "Review rates", href: `/project/${P}/rates` } },
          boq_review: { state: "done" },
          revisions: { state: "attention", reason: "rev 3 awaiting client approval", fix: { label: "Record approval", href: `/project/${P}/boq/revisions` } },
          proposal: { state: "blocked", reason: "Review rates or accept market basis", fix: { label: "Review rates", href: `/project/${P}/rates` } },
          documents: { state: "available" },
        },
      },
      flags,
    );
    expect(next.map((n) => n.step)).toEqual(["04 · RATES & BASIS", "07 · REVISIONS & APPROVAL", "08 · PROPOSAL"]);
    expect(next[0]).toMatchObject({ title: "Review rates before client use", sentence: "23 of 56 lines on market reference", primary: { label: "Review rates" }, secondary: { label: "Accept market basis" } });
    expect(next[1]!.title).toBe("Client approval outstanding");
  });

  it("owner: nothing needs attention → the first step not yet done", () => {
    const next = nextFromRail(P, { persona: "owner", statuses: { layout: { state: "done" }, ideation: { state: "available" }, moodboard: { state: "available" } } }, flags);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ step: "03 · IDEATION", title: "Next: Ideation", primary: { label: "Open Ideation" } });
  });
});
