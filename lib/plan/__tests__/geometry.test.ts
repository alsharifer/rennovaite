import { describe, expect, it } from "vitest";

import { buildPlanGraph } from "@/lib/plan/geometry";

import { MUDON_FIXTURE } from "./mudon.fixture";

describe("buildPlanGraph — Mudon pilot villa", () => {
  const graph = buildPlanGraph(MUDON_FIXTURE);

  it("carries all rooms with authoritative DB areas (verification gate a)", () => {
    expect(graph.rooms).toHaveLength(13);
    const area = (name: string) =>
      graph.rooms.find((r) => r.name_en === name)?.area_m2;
    // Three cross-check rooms against known Mudon values.
    expect(area("Master Bedroom")).toBe(19.9);
    expect(area("Family Area")).toBe(24);
    expect(area("Bedroom 3")).toBe(16.8);
  });

  it("preserves total floor area", () => {
    expect(graph.meta.total_area_m2).toBe(178.5);
  });

  it("invents no openings — empty array, flagged derived", () => {
    expect(graph.openings).toEqual([]);
    expect(graph.derived.openings_empty).toBe(true);
  });

  it("derives walls from shared/boundary edges, all flagged derived", () => {
    expect(graph.walls.length).toBeGreaterThan(0);
    expect(graph.walls.every((w) => w.derived === true)).toBe(true);
    expect(graph.walls.every((w) => w.thickness_mm === 200)).toBe(true);
    expect(graph.walls.every((w) => w.is_structural === null)).toBe(true);
    // At least one party wall (shared between two rooms) exists.
    expect(graph.walls.some((w) => w.room_ids.length >= 2)).toBe(true);
  });

  it("produces a plausible metric envelope", () => {
    // Villa footprint should be on the order of 10–20 m per side.
    expect(graph.meta.envelope_m.width).toBeGreaterThan(5);
    expect(graph.meta.envelope_m.width).toBeLessThan(40);
    expect(graph.meta.envelope_m.depth).toBeGreaterThan(5);
    expect(graph.meta.envelope_m.depth).toBeLessThan(40);
  });

  it("flags every derived scalar", () => {
    const d = graph.derived;
    expect(d.walls && d.wall_thickness && d.is_structural).toBe(true);
    expect(d.ceiling_h && d.north && d.level && d.metric_scale).toBe(true);
    expect(graph.rooms.every((r) => r.derived_fields.includes("ceiling_h_m"))).toBe(true);
  });
});
