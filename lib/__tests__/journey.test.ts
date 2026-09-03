import { describe, expect, it } from "vitest";

import {
  journeyLength,
  journeySteps,
  journeyStep,
  nextStep,
  prevStep,
  stepLabel,
  type JourneyFlags,
} from "@/lib/journey";

const ON: JourneyFlags = { drawingsEnabled: true };
const OFF: JourneyFlags = { drawingsEnabled: false };

describe("journey composition", () => {
  it("runs intake → layout → ideation → moodboard → render → costing → scope & timeline → downloads → marketplace", () => {
    expect(journeySteps(ON).map((s) => s.key)).toEqual([
      "intake",
      "layout",
      "ideation",
      "moodboard",
      "render",
      "costing",
      "scope_timeline",
      "downloads",
      "marketplace",
    ]);
  });

  it("includes scope & timeline now that D2 has landed", () => {
    // This step was absent until the phase estimator existed; the drop-out
    // mechanism it used to exercise is still covered by the downloads flag.
    expect(journeySteps(ON).some((s) => s.key === "scope_timeline")).toBe(true);
    expect(journeyStep("scope_timeline", ON)!.href("p")).toBe("/project/p/timeline");
  });

  it("has no separate style step — style folds into ideation", () => {
    expect(journeySteps(ON).some((s) => s.label.toLowerCase().includes("style"))).toBe(
      false,
    );
  });

  it("keeps the 3D viewer off the numbered path", () => {
    expect(journeySteps(ON).some((s) => s.href("p").includes("/viewer"))).toBe(false);
  });
});

describe("flag-aware numbering", () => {
  it("renumbers around a disabled step so the count always matches", () => {
    expect(journeyLength(ON)).toBe(9);
    expect(journeyLength(OFF)).toBe(8);
    expect(journeySteps(OFF).some((s) => s.key === "downloads")).toBe(false);
  });

  it("closes the gap left by a disabled step", () => {
    // With downloads off, marketplace moves up rather than leaving a hole.
    expect(journeyStep("marketplace", ON)!.number).toBe(9);
    expect(journeyStep("marketplace", OFF)!.number).toBe(8);
  });

  it("numbers every available step contiguously from 1", () => {
    for (const flags of [ON, OFF]) {
      const steps = journeySteps(flags);
      expect(steps.map((s) => s.number)).toEqual(
        steps.map((_, i) => i + 1),
      );
    }
  });

  it("formats a zero-padded label matching the existing chrome", () => {
    expect(stepLabel("ideation", ON)).toBe("Step 03 of 09");
    expect(stepLabel("marketplace", OFF)).toBe("Step 08 of 08");
  });

  it("returns an empty label for an unavailable step", () => {
    expect(stepLabel("downloads", OFF)).toBe("");
  });
});

describe("navigation has no dead ends", () => {
  it("walks ideation → moodboard → render, the B1/B2/B3 spine", () => {
    expect(nextStep("ideation", ON)!.key).toBe("moodboard");
    expect(nextStep("moodboard", ON)!.key).toBe("render");
    expect(nextStep("costing", ON)!.key).toBe("scope_timeline");
    expect(prevStep("moodboard", ON)!.key).toBe("ideation");
  });

  it("skips a disabled step when moving forward", () => {
    // scope_timeline → downloads → marketplace becomes … → marketplace.
    expect(nextStep("scope_timeline", ON)!.key).toBe("downloads");
    expect(nextStep("scope_timeline", OFF)!.key).toBe("marketplace");
  });

  it("terminates cleanly at both ends", () => {
    expect(prevStep("intake", ON)).toBeNull();
    expect(nextStep("marketplace", ON)).toBeNull();
  });

  it("every available step has a reachable href and copy for empty states", () => {
    for (const s of journeySteps(ON)) {
      expect(s.href("abc")).toMatch(/^\/project(\/|$)/);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
      expect(s.glyph.length).toBeGreaterThan(0);
    }
  });

  it("chains forward from the first step to the last with no gaps", () => {
    const steps = journeySteps(ON);
    let cur = steps[0]!;
    const walked = [cur.key];
    for (;;) {
      const n = nextStep(cur.key, ON);
      if (!n) break;
      cur = n;
      walked.push(cur.key);
    }
    expect(walked).toEqual(steps.map((s) => s.key));
  });
});
