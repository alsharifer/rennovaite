// =============================================================================
// lib/timeline/anchors.ts — the Mudon Villa 94 phase anchors (D2).
//
// Durations and the dependency graph come from lib/ground-truth/mudon-phases.ts,
// the transcription of the signed Newspace labour contract's payment schedule
// (Labour (SOW) sheet, rows 28-36). Provenance: actual_transaction.
//
// n = 1. THESE ARE ANCHORS, NOT STATISTICS. One project gives a calibrated
// point, not a distribution — so nothing here is ever presented as a mean, a
// median or a confidence interval, and every derived duration is flagged
// `derived: true`. The honesty posture is the boq_outcomes pattern applied to
// time: state what one real project did, scale it transparently, and say so.
//
// Two facts about the source worth keeping in view:
//   · The dates are CONTRACTUAL milestone dates — when each phase was paid
//     against — not a resourced programme. That is the best available proxy for
//     when work finished, and it is what we say it is.
//   · Phase 5 completes BEFORE phase 4. That is real concurrency (painting and
//     2nd fix alongside screed and tiling, both following phase 3), not a typo,
//     and the model preserves it.
//
// Pure data + pure arithmetic. No LLM anywhere in this path.
// =============================================================================

import {
  MUDON_PROGRAMME_DAYS,
  MUDON_PROGRAMME_END,
  MUDON_PROGRAMME_START,
  mudonPhaseDays,
} from "@/lib/ground-truth/mudon-phases";

/** What a phase's duration scales with. One per phase, and each is argued. */
export type DriverKey =
  | "debris_m3"
  | "mep_points"
  | "ceiling_m2"
  | "tiled_m2"
  | "painted_m2"
  | "wet_rooms"
  | "fitout_value_aed"
  | "floor_m2";

export interface PhaseAnchor {
  n: number;
  key: string;
  /** Contract milestone wording, kept verbatim. */
  milestone: string;
  /** Shorter label for the timeline bars. */
  label: string;
  /** Mudon's actual duration in calendar days. */
  anchor_days: number;
  /** Phase this one follows; null = project start. */
  predecessor: number | null;
  /** The quantity this phase's duration scales with. */
  driver: DriverKey;
  /** Why that driver — shown on hover, so the reasoning travels with the bar. */
  driver_rationale: string;
  /** Mudon's value for that driver: the denominator of every scale factor. */
  anchor_driver_value: number;
  /** No phase shrinks below this many days, however small the project. */
  floor_days: number;
  /**
   * POMI work sections whose presence makes this phase apply. A project with no
   * value in ANY of them does not get the phase at all.
   */
  sections: string[];
}

// Re-exported from the ground-truth transcription so there is exactly one place
// the contract's dates live.
export const MUDON_PHASE_START = MUDON_PROGRAMME_START;
export const MUDON_PHASE_END = MUDON_PROGRAMME_END;
export const MUDON_TOTAL_DAYS = MUDON_PROGRAMME_DAYS;

// Mudon's driver values, from the same take-off the BoQ prices (178.5 m² first
// floor, 3 wet rooms). Each is recorded here so a scale factor is always
// project ÷ Mudon, with both sides visible.
export const MUDON_DRIVERS: Record<DriverKey, number> = {
  // total area × DEBRIS_M3_PER_M2 (0.20) — the F-11 demolition volume.
  debris_m3: 35.7,
  // Electrical + plumbing points: 40 downlights + 58 sockets/switches + 3 water
  // heaters + 3 floor drains + 3 bath re-pipes.
  mep_points: 107,
  // Interior area × CEILING_COVERAGE_FACTOR.
  ceiling_m2: 152.8,
  // Floor tiling + full-height wet-wall tiling.
  tiled_m2: 249.3,
  // F-02 paint area: dry rooms (net wall + ceiling) + bath ceilings.
  painted_m2: 396.7,
  wet_rooms: 3,
  // Joinery + sanitary + staircase value — the fit-out this phase installs.
  fitout_value_aed: 143_101,
  floor_m2: 178.5,
};

export const PHASE_ANCHORS: PhaseAnchor[] = [
  {
    n: 1,
    key: "demolition",
    milestone: "Demolition & strip-out complete",
    label: "Mobilisation & strip-out",
    anchor_days: mudonPhaseDays(1),
    predecessor: null,
    driver: "debris_m3",
    driver_rationale:
      "Strip-out is bounded by how much material leaves the villa, and skips are the constraint — so debris volume, not floor area, is what moves it. The contract triggers mobilisation payment at this phase's start, so mobilisation has no separate duration of its own and sits inside this bar.",
    anchor_driver_value: MUDON_DRIVERS.debris_m3,
    // Mobilisation alone takes about a week whatever the villa's size.
    floor_days: 7,
    sections: ["Demolition"],
  },
  {
    n: 2,
    key: "civil_mep_first_fix",
    milestone: "Civil works & MEP first-fix complete",
    label: "Civil & MEP first fix",
    anchor_days: mudonPhaseDays(2),
    predecessor: 1,
    driver: "mep_points",
    driver_rationale:
      "First fix is chased conduit and pipe runs, so it scales with the number of points served rather than with area — a large open room with few points is quicker than a small dense one.",
    anchor_driver_value: MUDON_DRIVERS.mep_points,
    floor_days: 7,
    sections: ["Blockwork", "Electrical", "Plumbing", "MEP / HVAC", "Electrical Installations", "Plumbing & Sanitary"],
  },
  {
    n: 3,
    key: "ceilings_plaster",
    milestone: "Ceilings & plastering complete",
    label: "Ceilings & plastering",
    anchor_days: mudonPhaseDays(3),
    predecessor: 2,
    driver: "ceiling_m2",
    driver_rationale:
      "Gypsum ceilings and plaster make-good are measured by the surface covered, so ceiling area is the direct driver.",
    anchor_driver_value: MUDON_DRIVERS.ceiling_m2,
    floor_days: 5,
    sections: ["Ceilings", "Plaster"],
  },
  {
    n: 4,
    key: "screed_tiling",
    milestone: "Screed & tiling complete",
    label: "Screed & tiling",
    anchor_days: mudonPhaseDays(4),
    predecessor: 3,
    driver: "tiled_m2",
    driver_rationale:
      "Tiling is the classic area-driven trade: setting-out, laying and grouting all scale with tiled area, floors and wet walls together.",
    anchor_driver_value: MUDON_DRIVERS.tiled_m2,
    floor_days: 5,
    sections: ["Floor Finishes", "Wall Finishes"],
  },
  {
    n: 5,
    key: "paint_second_fix",
    milestone: "Painting & electrical 2nd fix complete",
    label: "Painting & 2nd fix",
    anchor_days: mudonPhaseDays(5),
    // Same predecessor as phase 4 — this is the real concurrency in the source.
    predecessor: 3,
    driver: "painted_m2",
    driver_rationale:
      "Painting dominates this phase and is measured by painted area; the electrical 2nd fix runs inside the same window. On Mudon it ran concurrently with screed and tiling, finishing three days earlier.",
    anchor_driver_value: MUDON_DRIVERS.painted_m2,
    floor_days: 5,
    sections: ["Decoration & Painting", "Electrical", "Electrical Installations"],
  },
  {
    n: 6,
    key: "fitout_sanitary",
    milestone: "Staircase & sanitary install complete",
    label: "Fit-out & sanitary",
    anchor_days: mudonPhaseDays(6),
    predecessor: 4,
    driver: "fitout_value_aed",
    driver_rationale:
      "Installing joinery, sanitaryware and the staircase is a fit-out effort we have no unit-count for, so the section value stands in as a proxy for how much there is to install. It is a PROXY, not a measure — a dearer tap does not take longer to fit — which is why this phase's range is the widest in the plan.",
    anchor_driver_value: MUDON_DRIVERS.fitout_value_aed,
    floor_days: 3,
    sections: ["Joinery & Carpentry", "Sanitaryware", "Lighting"],
  },
  {
    n: 7,
    key: "snagging",
    milestone: "Snagging & final handover",
    label: "Snagging & handover",
    anchor_days: mudonPhaseDays(7),
    predecessor: 6,
    driver: "floor_m2",
    driver_rationale:
      "Snagging is a walk of the whole villa, so it tracks total floor area more closely than any single trade.",
    anchor_driver_value: MUDON_DRIVERS.floor_m2,
    floor_days: 5,
    sections: [],
  },
];

/** Every section any phase depends on — used to test the map is exhaustive. */
export const PHASE_SECTIONS = Array.from(
  new Set(PHASE_ANCHORS.flatMap((p) => p.sections)),
).sort();

export const DRIVER_LABEL: Record<DriverKey, string> = {
  debris_m3: "Demolition volume",
  mep_points: "MEP points",
  ceiling_m2: "Ceiling area",
  tiled_m2: "Tiled area",
  painted_m2: "Painted area",
  wet_rooms: "Wet rooms",
  fitout_value_aed: "Fit-out value",
  floor_m2: "Floor area",
};

export const DRIVER_UNIT: Record<DriverKey, string> = {
  debris_m3: "m³",
  mep_points: "points",
  ceiling_m2: "m²",
  tiled_m2: "m²",
  painted_m2: "m²",
  wet_rooms: "rooms",
  fitout_value_aed: "AED",
  floor_m2: "m²",
};
