import { describe, expect, it } from "vitest";

import fixture from "../__fixtures__/j0-bad-parse.json";
import { planCheck, planCheckSentence } from "../plan-check";

// K5 — the Plan check panel on the J0 06-bad-parse fixture (the worst pre-repair
// production parse): it reports what the J0 measurement reported, through the
// same detector the BoQ 409 uses.

const rooms = fixture.rooms.map((r) => ({ id: r.id, name: r.name_en, polygon: r.polygon }));

describe("planCheck — J0 06-bad-parse", () => {
  const c = planCheck(rooms);

  it("finds the 12 overlapping pairs J0 measured, largest first", () => {
    expect(c.rooms).toBe(13);
    expect(c.pairs).toHaveLength(fixture.measured.overlapping_pairs);
    const measured = new Set(fixture.measured.pairs.map(([a, b]) => [a, b].sort().join("|")));
    expect(new Set(c.pairs.map((p) => [p.aId, p.bId].sort().join("|")))).toEqual(measured);
    for (let i = 1; i < c.pairs.length; i++) expect(c.pairs[i - 1]!.shared).toBeGreaterThanOrEqual(c.pairs[i]!.shared);
  });

  it("23.6% of the room area is counted twice", () => {
    expect(Math.round(c.share * 1000) / 1000).toBe(fixture.measured.overlap_share_of_room_area);
    expect(planCheckSentence(c, fixture.total_area_m2)).toBe(
      "12 pairs of rooms overlap — 23.6% of the room area is counted twice (parser total 166.1 m²). Pricing from this would overstate every area-based line.",
    );
  });

  it("a clean plan has no pairs", () => {
    const clean = planCheck([
      { id: "a", name: "A", polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      { id: "b", name: "B", polygon: [[1, 0], [2, 0], [2, 1], [1, 1]] },
    ]);
    expect(clean.pairs).toEqual([]);
    expect(clean.share).toBe(0);
  });
});
