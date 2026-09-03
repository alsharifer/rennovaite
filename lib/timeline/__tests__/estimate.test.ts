import { describe, expect, it } from "vitest";

import {
  MUDON_DRIVERS,
  MUDON_TOTAL_DAYS,
  PHASE_ANCHORS,
  type DriverKey,
} from "@/lib/timeline/anchors";
import {
  MIN_RANGE_DAYS,
  allSectionsPresent,
  bandFor,
  estimatePhase,
  estimateTimeline,
  mudonDrivers,
  phaseApplies,
  scaleFactor,
} from "@/lib/timeline/estimate";

const ALL = allSectionsPresent();

describe("the anchor model itself", () => {
  it("sums to the contract's own 82 days along the critical path", () => {
    // 15 Jul → 5 Oct 2026. Not the sum of durations — phases 4 and 5 overlap.
    const e = estimateTimeline({ drivers: mudonDrivers(), sectionTotals: ALL });
    expect(e.total_days).toBe(MUDON_TOTAL_DAYS);
    expect(e.total_days).toBe(82);
  });

  it("preserves the real phase-4 / phase-5 concurrency", () => {
    const e = estimateTimeline({ drivers: mudonDrivers(), sectionTotals: ALL });
    const p4 = e.phases.find((p) => p.n === 4)!;
    const p5 = e.phases.find((p) => p.n === 5)!;
    // Same predecessor, same start, and phase 5 finishes FIRST — as it did.
    expect(p4.predecessor).toBe(3);
    expect(p5.predecessor).toBe(3);
    expect(p5.start_day).toBe(p4.start_day);
    expect(p5.end_day).toBeLessThan(p4.end_day);
    // Phase 6 waits for the later of the two.
    expect(e.phases.find((p) => p.n === 6)!.start_day).toBe(p4.end_day);
  });

  it("gives every phase a driver, a rationale and a floor", () => {
    for (const a of PHASE_ANCHORS) {
      expect(a.anchor_days).toBeGreaterThan(0);
      expect(a.anchor_driver_value).toBeGreaterThan(0);
      expect(a.floor_days).toBeGreaterThan(0);
      expect(a.driver_rationale.length).toBeGreaterThan(40);
      expect(MUDON_DRIVERS[a.driver]).toBeGreaterThan(0);
    }
  });
});

describe("identity case — Mudon in, Mudon out", () => {
  const e = estimateTimeline({ drivers: mudonDrivers(), sectionTotals: ALL });

  it("returns every phase at exactly its anchor duration", () => {
    expect(e.phases).toHaveLength(PHASE_ANCHORS.length);
    for (const p of e.phases) {
      expect(p.scale_factor).toBe(1);
      expect(p.days).toBe(p.anchor_days);
      expect(p.floored).toBe(false);
    }
  });

  it("brackets the 12-week actual inside the reported range", () => {
    expect(e.total_low_days).toBeLessThanOrEqual(82);
    expect(e.total_high_days).toBeGreaterThanOrEqual(82);
    // ~12 weeks: the headline band must contain it.
    expect(e.total_weeks_low).toBeLessThanOrEqual(12);
    expect(e.total_weeks_high).toBeGreaterThanOrEqual(12);
  });

  it("is deterministic — same input, identical output", () => {
    const again = estimateTimeline({ drivers: mudonDrivers(), sectionTotals: ALL });
    expect(again).toEqual(e);
  });
});

describe("scaling drivers", () => {
  it("damps rather than scaling linearly", () => {
    // Twice the work is not twice the calendar: crews parallelise.
    expect(scaleFactor(2, 1)).toBeGreaterThan(1);
    expect(scaleFactor(2, 1)).toBeLessThan(2);
    expect(scaleFactor(1, 1)).toBe(1);
    expect(scaleFactor(0.5, 1)).toBeLessThan(1);
    expect(scaleFactor(0.5, 1)).toBeGreaterThan(0.5);
  });

  it("is safe on zero and missing values", () => {
    expect(scaleFactor(0, 100)).toBe(0);
    expect(scaleFactor(100, 0)).toBe(0);
  });

  it("every driver actually moves its own phase", () => {
    // A driver nothing responds to would be decoration.
    for (const anchor of PHASE_ANCHORS) {
      const base = estimatePhase(anchor, mudonDrivers());
      const doubled = mudonDrivers();
      doubled[anchor.driver] = doubled[anchor.driver] * 2;
      const bigger = estimatePhase(anchor, doubled);
      expect(bigger.days, `${anchor.key} did not respond to ${anchor.driver}`).toBeGreaterThan(
        base.days,
      );
    }
  });

  it("each phase responds ONLY to its own driver", () => {
    for (const anchor of PHASE_ANCHORS) {
      const base = estimatePhase(anchor, mudonDrivers());
      for (const key of Object.keys(MUDON_DRIVERS) as DriverKey[]) {
        if (key === anchor.driver) continue;
        const changed = mudonDrivers();
        changed[key] = changed[key] * 3;
        expect(
          estimatePhase(anchor, changed).days,
          `${anchor.key} moved when ${key} changed`,
        ).toBe(base.days);
      }
    }
  });
});

describe("halving the tiled area", () => {
  const base = estimateTimeline({ drivers: mudonDrivers(), sectionTotals: ALL });
  const halved = mudonDrivers();
  halved.tiled_m2 = halved.tiled_m2 / 2;
  const after = estimateTimeline({ drivers: halved, sectionTotals: ALL });

  it("shortens the tiling phase", () => {
    const before = base.phases.find((p) => p.key === "screed_tiling")!;
    const now = after.phases.find((p) => p.key === "screed_tiling")!;
    expect(now.days).toBeLessThan(before.days);
  });

  it("leaves every other phase's duration untouched", () => {
    for (const p of after.phases) {
      if (p.key === "screed_tiling") continue;
      const before = base.phases.find((b) => b.key === p.key)!;
      expect(p.days, `${p.key} moved`).toBe(before.days);
      expect(p.low_days).toBe(before.low_days);
      expect(p.high_days).toBe(before.high_days);
    }
  });

  it("shortens the overall plan", () => {
    expect(after.total_days).toBeLessThan(base.total_days);
  });
});

describe("ranges are never false precision", () => {
  it("never collapses a phase to a single day", () => {
    // Across a wide sweep of project sizes, every band stays open.
    for (const factor of [0.01, 0.1, 0.5, 1, 2, 10, 100]) {
      const drivers = mudonDrivers();
      for (const k of Object.keys(drivers) as DriverKey[]) drivers[k] = drivers[k] * factor;
      const e = estimateTimeline({ drivers, sectionTotals: ALL });
      for (const p of e.phases) {
        expect(p.high_days - p.low_days, `${p.key} at ×${factor}`).toBeGreaterThanOrEqual(
          MIN_RANGE_DAYS,
        );
        expect(p.low_days).toBeLessThan(p.high_days);
      }
      expect(e.total_high_days).toBeGreaterThan(e.total_low_days);
    }
  });

  it("widens the band the further a project sits from the anchor", () => {
    expect(bandFor(1, false)).toBeLessThan(bandFor(4, false));
    expect(bandFor(1, false)).toBeLessThan(bandFor(0.25, false));
  });

  it("gives the value-proxy phase a wider band than a measured one", () => {
    expect(bandFor(1, true)).toBeGreaterThan(bandFor(1, false));
  });

  it("flags every duration as derived", () => {
    const e = estimateTimeline({ drivers: mudonDrivers(), sectionTotals: ALL });
    expect(e.derived).toBe(true);
    for (const p of e.phases) expect(p.derived).toBe(true);
    expect(e.basis).toMatch(/one calibrated project/i);
  });
});

describe("floors", () => {
  it("keeps mobilisation at a week however tiny the job", () => {
    const drivers = mudonDrivers();
    for (const k of Object.keys(drivers) as DriverKey[]) drivers[k] = drivers[k] * 0.001;
    const e = estimateTimeline({ drivers, sectionTotals: ALL });
    const p1 = e.phases.find((p) => p.key === "demolition")!;
    expect(p1.days).toBe(7);
    expect(p1.floored).toBe(true);
  });

  it("holds every phase at or above its own floor", () => {
    const drivers = mudonDrivers();
    for (const k of Object.keys(drivers) as DriverKey[]) drivers[k] = 0;
    const e = estimateTimeline({ drivers, sectionTotals: ALL });
    for (const p of e.phases) {
      const anchor = PHASE_ANCHORS.find((a) => a.key === p.key)!;
      expect(p.days).toBeGreaterThanOrEqual(anchor.floor_days);
      expect(p.low_days).toBeGreaterThanOrEqual(anchor.floor_days);
    }
  });
});

describe("scope decides which phases appear", () => {
  it("drops a phase whose sections carry no BoQ value", () => {
    const noTiling = { ...ALL };
    delete noTiling["Floor Finishes"];
    delete noTiling["Wall Finishes"];
    const e = estimateTimeline({ drivers: mudonDrivers(), sectionTotals: noTiling });
    expect(e.phases.some((p) => p.key === "screed_tiling")).toBe(false);
    expect(e.excluded.some((x) => x.key === "screed_tiling")).toBe(true);
    expect(e.total_days).toBeLessThan(82);
  });

  it("re-links the chain around a dropped phase rather than leaving a hole", () => {
    const noTiling = { ...ALL };
    delete noTiling["Floor Finishes"];
    delete noTiling["Wall Finishes"];
    const e = estimateTimeline({ drivers: mudonDrivers(), sectionTotals: noTiling });
    const p3 = e.phases.find((p) => p.n === 3)!;
    const p6 = e.phases.find((p) => p.n === 6)!;
    // Phase 6 followed phase 4; with 4 gone it starts from 3's finish.
    expect(p6.start_day).toBe(p3.end_day);
    expect(p6.start_day).toBeGreaterThan(0);
  });

  it("always keeps snagging — you always hand over", () => {
    const e = estimateTimeline({ drivers: mudonDrivers(), sectionTotals: {} });
    expect(e.phases.some((p) => p.key === "snagging")).toBe(true);
  });

  it("treats a zero-value section as absent", () => {
    const zeroed = { ...ALL, "Floor Finishes": 0, "Wall Finishes": 0 };
    expect(
      phaseApplies(PHASE_ANCHORS.find((a) => a.key === "screed_tiling")!, zeroed),
    ).toBe(false);
  });
});
