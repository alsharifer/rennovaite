import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GARDEN_TIMELINE_BASIS, gardenTimeline, isGardenProject } from "../garden";

// K9 (K8 review ruling 3): a garden project's timeline is its BoQ programme —
// never the interior phase model.
const fx = JSON.parse(readFileSync(path.resolve(__dirname, "../../boq/__fixtures__/arabella-g5d-revisions.json"), "utf8")) as { stages: { boq_id: string }[]; boqs: Record<string, Record<string, unknown>> };
const arabella = fx.boqs[fx.stages[7]!.boq_id]!;

describe("garden timeline", () => {
  it("a plan of outdoor zones is a garden; any interior room (balcony and terrace included) is not", () => {
    expect(isGardenProject(["artificial_grass", "paving", "structure"])).toBe(true);
    expect(isGardenProject(["artificial_grass", "bedroom"])).toBe(false);
    expect(isGardenProject(["terrace"])).toBe(false);
    expect(isGardenProject([])).toBe(false);
  });

  it("is the BoQ's stored programme, with the ruling's basis", () => {
    const t = gardenTimeline(arabella)!;
    const prog = arabella.programme as { total_days: number; phases: unknown[] };
    expect(t.totalDays).toBe(prog.total_days);
    expect(t.phases).toEqual(prog.phases);
    expect(t.basis).toBe(GARDEN_TIMELINE_BASIS);
    expect(t.basis).toContain("Scaled from one real Dubai garden project (~90 days)");
  });

  it("an older revision without a stored programme gets it re-derived from its sections", () => {
    const { programme, ...older } = arabella;
    void programme;
    const t = gardenTimeline(older)!;
    expect(t.totalDays).toBe((arabella.programme as { total_days: number }).total_days);
  });

  it("nothing to programme → null", () => {
    expect(gardenTimeline({ sections: [], subtotal_aed: 0 })).toBeNull();
  });
});
