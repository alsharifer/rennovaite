import { describe, expect, it } from "vitest";

import type { PlanFixture } from "@/lib/overlays/types";
import { buildPlanGraph, type Opening, type Room, type Wall } from "@/lib/plan/geometry";

import { resolveCommunity } from "@/lib/compliance/authorities";
import { computePlanDiff, type PlanDiff } from "@/lib/compliance/diff";
import { evaluatePermits, RULES, weakSourceRules } from "@/lib/compliance/dubai-triggers";

import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";

const graph = buildPlanGraph(MUDON_FIXTURE);
const MUDON = resolveCommunity({ name: "Mudon pilot villa", city: "Dubai" });

function wall(is_structural: boolean | null): Wall {
  return { id: "w1", polyline: [[0, 0], [3, 0]], thickness_mm: 200, is_structural, room_ids: ["r1"], derived: true };
}
function room(type: string, id = "r1"): Room {
  return { id, name_en: type, name_ar: null, type, polygon: [[0, 0], [3, 0], [3, 3], [0, 3]], area_m2: 9, ceiling_h_m: 2.9, derived_fields: [] };
}
function opening(type: "door" | "window"): Opening {
  return { id: "o1", wall_id: "w1", type, width_mm: 900, height_mm: 1200, sill_mm: 0, derived: true };
}
const EMPTY: PlanDiff = { hasProposed: true, removedWalls: [], addedWalls: [], removedRooms: [], addedRooms: [], addedOpenings: [], areaDeltaM2: 0 };
const diff = (p: Partial<PlanDiff>): PlanDiff => ({ ...EMPTY, ...p });
const fire = (d: PlanDiff, fixtures: PlanFixture[] = []) =>
  new Set(evaluatePermits(d, graph, fixtures, MUDON).map((r) => r.id));

describe("Dubai permit triggers — per rule", () => {
  it("VERIFICATION GATE: Mudon wall removal (derived) fires NOC + structural-uncertainty", () => {
    const fired = evaluatePermits(diff({ removedWalls: [wall(null)] }), graph, [], MUDON);
    const ids = fired.map((f) => f.id);
    expect(ids).toContain("wall_removal_noc");
    expect(ids).toContain("structural_uncertain");
    const noc = fired.find((f) => f.id === "wall_removal_noc")!;
    expect(noc.consequence).toBe("noc_required");
    expect(noc.authority).toBe("community_developer");
    const unc = fired.find((f) => f.id === "structural_uncertain")!;
    expect(unc.consequence).toBe("approval_likely");
    expect(unc.explanation_en).toContain("can't confirm");
    // Mudon is a DM community → municipal placeholder resolves to DM.
    expect(unc.authority).toBe("DM");
    // a KNOWN structural wall would instead require a permit
    expect(fire(diff({ removedWalls: [wall(true)] }))).toContain("structural_permit");
  });

  it("VERIFICATION GATE: a finishes-only scenario fires nothing", () => {
    expect(fire(EMPTY).size).toBe(0);
    // and the no_permit rule matches (calm state), but is never a fired trigger
    const finishes = RULES.find((r) => r.id === "finishes_no_permit")!;
    expect(finishes.predicate(EMPTY, graph, [])).toBe(true);
    expect(finishes.consequence).toBe("no_permit");
  });

  it("room addition → permit; footprint change → permit", () => {
    expect(fire(diff({ addedRooms: [room("bedroom")] }))).toContain("room_addition_permit");
    expect(fire(diff({ areaDeltaM2: 12 }))).toContain("footprint_permit");
  });

  it("wet-area relocation → drainage; kitchen move → gas+drainage", () => {
    expect(fire(diff({ removedRooms: [room("bathroom")] }))).toContain("wet_area_drainage");
    expect(fire(diff({ addedRooms: [room("kitchen")] }))).toContain("kitchen_relocation");
  });

  it("AC relocation fires only when a relocated room has an AC point", () => {
    const ac: PlanFixture = { id: "f1", project_id: "p", layer: "electrical", type: "ac_point", room_id: "r1", position: [0, 0], wall_id: null, spec: null, source: "rule" };
    expect(fire(diff({ removedRooms: [room("bedroom", "r1")] }), [ac])).toContain("mep_ac");
    // no AC in the relocated room → no MEP rule
    expect(fire(diff({ removedRooms: [room("bedroom", "r2")] }), [ac])).not.toContain("mep_ac");
  });

  it("external / façade: new window fires a permit", () => {
    expect(fire(diff({ addedOpenings: [opening("window")] }))).toContain("facade_external");
  });

  it("authority routing swaps municipal band by community", () => {
    const dda = resolveCommunity({ name: "Business Bay residence", city: "Dubai" });
    expect(dda.municipal).toBe("DDA");
    const fired = evaluatePermits(diff({ addedRooms: [room("bedroom")] }), graph, [], dda);
    expect(fired.find((f) => f.id === "room_addition_permit")!.authority).toBe("DDA");
  });

  it("every fired rule carries a source note", () => {
    const fired = evaluatePermits(diff({ removedWalls: [wall(null)], addedRooms: [room("kitchen")] }), graph, [], MUDON);
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.every((f) => f.source_note.length > 20)).toBe(true);
  });

  it("computePlanDiff: no proposed → empty; wall removal detected", () => {
    expect(computePlanDiff(graph, null).hasProposed).toBe(false);
    const proposed = { ...graph, walls: graph.walls.slice(1) };
    const d = computePlanDiff(graph, proposed);
    expect(d.removedWalls).toHaveLength(1);
    expect(d.removedWalls[0]!.id).toBe(graph.walls[0]!.id);
  });

  it("flags weak source notes for the consultant checklist", () => {
    const weak = weakSourceRules().map((r) => r.id);
    expect(weak).toContain("structural_uncertain");
    expect(weak).toContain("wall_removal_noc");
    expect(weak.length).toBeGreaterThanOrEqual(4);
  });
});
