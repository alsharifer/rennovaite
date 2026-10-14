import { describe, expect, it } from "vitest";

import { buildPlanGraph } from "@/lib/plan/geometry";

import { applyElementMapping } from "../element-map";
import { quantifyPlan } from "../quantify";
import { mudonEngineBoq, mudonTakeoff } from "./p4.fixture";

// K12 follow-up (ruled 14 Oct): on a plan with an element take-off, Floor
// Finishes is rebuilt from the take-off — which dropped Q-11, the staircase
// renovation (fixing labour + LED nosing). It is restored; the tile SUPPLY stays
// Q-11b's alone, and the take-off's floor finish excludes the stair footprint.

const lines = (b: ReturnType<typeof applyElementMapping>) => b.sections.flatMap((s) => s.lines as { rule_id?: string; item_key?: string; description: string; total_aed: number }[]);

describe("staircase lines on a take-off plan", () => {
  it("the renovation labour (Q-11) is kept beside the tile supply (Q-11b) — once each, no other stair line", () => {
    const engine = mudonEngineBoq();
    const hasStairs = lines(engine as never).some((l) => (l.rule_id ?? "").startsWith("Q-11b"));
    const mapped = applyElementMapping(engine, mudonTakeoff());
    const stair = lines(mapped).filter((l) => /^Q-11(b|\/)/.test(l.rule_id ?? ""));
    expect(stair.filter((l) => (l.rule_id ?? "").startsWith("Q-11/"))).toHaveLength(1);
    expect(stair.filter((l) => (l.rule_id ?? "").startsWith("Q-11b"))).toHaveLength(hasStairs ? 1 : 0);
    // The renovation line is labour: it never prices tile material.
    const q11 = stair.find((l) => (l.rule_id ?? "").startsWith("Q-11/"))!;
    expect(q11.description).toMatch(/labour/i);
    expect(q11.description).toMatch(/tile supply on its own line/);
    expect(q11.total_aed).toBe(6000);
  });

  it("no double count: the take-off's floor finish skips a stairs room, so its surface is priced only by Q-11b", () => {
    const sq = (x0: number, x1: number) => [[x0, 0], [x1, 0], [x1, 0.5], [x0, 0.5]];
    const graph = buildPlanGraph({
      projectId: "p",
      planId: "pl",
      scale: null,
      total_area_m2: 40,
      rooms: [
        { id: "hall", name_en: "Hall", name_ar: null, room_type: "living", area_m2: 30, polygon: sq(0, 0.75) },
        { id: "stairs", name_en: "Stairs", name_ar: null, room_type: "stairs", area_m2: 10, polygon: sq(0.75, 1) },
      ],
    });
    const items = quantifyPlan(graph);
    expect(items.some((i) => i.work_item_key === "floor_finish" && i.room_id === "stairs")).toBe(false);
    expect(items.some((i) => i.work_item_key === "floor_finish" && i.room_id === "hall")).toBe(true);
  });

  it("idempotent: mapping an already-mapped BoQ keeps one of each", () => {
    const once = applyElementMapping(mudonEngineBoq(), mudonTakeoff());
    const twice = applyElementMapping(once, mudonTakeoff());
    expect(lines(twice).filter((l) => (l.rule_id ?? "").startsWith("Q-11/"))).toHaveLength(1);
    expect(twice.grand_total_aed).toBe(once.grand_total_aed);
  });
});
