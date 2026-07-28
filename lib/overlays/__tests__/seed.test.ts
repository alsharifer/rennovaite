import { describe, expect, it } from "vitest";

import { buildOverlaySections, needsQsLines } from "@/lib/overlays/boq";
import { countByType, seedOverlays } from "@/lib/overlays/seed";
import { buildPlanGraph } from "@/lib/plan/geometry";

import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";

// Expected counts, hand-derived from lib/overlays/rules.ts applied to the 13
// Mudon rooms (verification gate: seed → counts match the rules table).
const EXPECTED: Record<string, number> = {
  socket_13a: 22, // bed3 4 + bed4 4 + dressing 1 + family 6 + balcony 1 + master 4 + terrace 1 + terrace2 1
  switch_1g: 9, // bath 1 + dressing 1 + family 2 + balcony 1 + mbath 1 + terrace 1 + terrace2 1 + toilet 1
  switch_2way: 10, // bed3 2 + bed4 2 + master 2 + passage 2 + stairs 2
  light_point: 17,
  ac_point: 4, // bed3 + bed4 + family + master
  dp_isolator: 2, // bath + mbath
  data_point: 1, // family
  wc_point: 3, // bath + mbath + toilet
  basin_point: 3, // bath + mbath + toilet
  shower_mixer: 2, // bath + mbath
  water_heater: 2, // bath + mbath
  floor_drain: 2, // bath + mbath
};

describe("seedOverlays — Mudon counts match the rules table", () => {
  const graph = buildPlanGraph(MUDON_FIXTURE);
  const fixtures = seedOverlays(graph);
  const counts = countByType(fixtures);

  it("matches the hand-derived per-type counts", () => {
    for (const [type, n] of Object.entries(EXPECTED)) {
      expect(counts[type] ?? 0, `count for ${type}`).toBe(n);
    }
  });

  it("produces no kitchen-only fixtures (Mudon has no kitchen)", () => {
    expect(counts.socket_kitchen ?? 0).toBe(0);
    expect(counts.sink_point ?? 0).toBe(0);
    expect(counts.washing_machine_point ?? 0).toBe(0);
  });

  it("totals 77 fixtures, every one source:'rule' with a room + position", () => {
    expect(fixtures).toHaveLength(77);
    expect(fixtures.every((f) => f.source === "rule")).toBe(true);
    expect(fixtures.every((f) => f.room_id !== null)).toBe(true);
    expect(fixtures.every((f) => f.position.length === 2)).toBe(true);
  });

  it("is deterministic (same graph → identical fixtures)", () => {
    expect(seedOverlays(graph)).toEqual(fixtures);
  });
});

describe("buildOverlaySections — counts → BoQ quantities", () => {
  const graph = buildPlanGraph(MUDON_FIXTURE);
  const fixtures = seedOverlays(graph).map((f, i) => ({ id: `fx-${i}`, type: f.type }));
  const sections = buildOverlaySections(fixtures);

  it("emits two POMI sections with computed quantities + element_refs", () => {
    const elec = sections.find((s) => s.work_section === "Electrical Installations")!;
    const plumb = sections.find((s) => s.work_section === "Plumbing & Sanitary")!;
    expect(elec).toBeDefined();
    expect(plumb).toBeDefined();
    const socket = elec.lines.find((l) => l.description.startsWith("13A twin"))!;
    expect(socket.quantity).toBe(22);
    expect(socket.element_refs).toHaveLength(22);
    expect(socket.unit).toBe("no");
    // every line's total = qty × rate
    for (const s of sections)
      for (const l of s.lines)
        expect(l.total_aed).toBe(Math.round(l.quantity * l.rate_aed));
  });

  it("flags data_point + water_heater as needs_qs (no default rate)", () => {
    const nq = needsQsLines(sections);
    const descs = nq.map((l) => l.description);
    expect(descs.some((d) => d.includes("data/TV"))).toBe(true);
    expect(descs.some((d) => d.includes("water heater"))).toBe(true);
    // needs_qs lines carry a zero rate
    for (const s of sections)
      for (const l of s.lines)
        if (l.rate_status === "needs_qs") expect(l.rate_aed).toBe(0);
  });
});
