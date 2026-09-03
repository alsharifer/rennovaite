// =============================================================================
// lib/timeline/estimate.ts — the deterministic phase-plan estimator (D2).
//
// Same input → identical output. No LLM in this path: durations are arithmetic
// over the Mudon anchors, and every number carries where it came from.
//
// The shape of the estimate:
//   1. A phase applies only if the project has non-zero BoQ value in at least
//      one of its sections (snagging always applies — you always hand over).
//   2. Its duration scales from the Mudon anchor by ONE documented driver:
//        days = anchor_days × (project driver ÷ Mudon driver)
//      floored, and damped (see SCALE_DAMPING) because a villa with twice the
//      tile does not take twice as long — crews overlap and parallelise.
//   3. The result is a RANGE, never a single day. With n = 1 there is no
//      statistical spread to quote, so the band is an explicit uncertainty
//      statement that widens the further a project sits from the anchor.
//   4. Phases keep the anchor's dependency graph, including the real phase-4 /
//      phase-5 concurrency, so the total is a critical path and not a sum.
// =============================================================================

import {
  DRIVER_LABEL,
  DRIVER_UNIT,
  MUDON_DRIVERS,
  MUDON_TOTAL_DAYS,
  PHASE_ANCHORS,
  type DriverKey,
  type PhaseAnchor,
} from "./anchors";

/** Project driver values, computed from the take-off + BoQ (never guessed). */
export type DriverValues = Record<DriverKey, number>;

export interface EstimateInput {
  drivers: DriverValues;
  /** POMI work section → its BoQ total. Decides which phases apply. */
  sectionTotals: Record<string, number>;
}

/**
 * Doubling the tiled area does not double the tiling phase: a bigger job takes
 * more crew, not proportionally more calendar. An exponent below 1 damps the
 * scale factor — 0.75 is a standard construction rule-of-thumb and is stated
 * as the assumption it is, not calibrated (n = 1 cannot calibrate a curve).
 */
export const SCALE_DAMPING = 0.75;

/** Band at the anchor itself: ±15%, because one project is not a distribution. */
export const BASE_BAND = 0.15;
/** How much the band widens per unit of log-distance from the anchor. */
export const BAND_WIDENING = 0.35;
/** A range never collapses: at least this many days between low and high. */
export const MIN_RANGE_DAYS = 2;
/** The fit-out proxy driver deserves a wider band than a measured one. */
export const PROXY_EXTRA_BAND = 0.1;

export interface PhaseEstimate {
  n: number;
  key: string;
  label: string;
  milestone: string;
  /** Point estimate in days — shown only inside the range, never alone. */
  days: number;
  low_days: number;
  high_days: number;
  /** Day offsets from project start, on the critical path. */
  start_day: number;
  end_day: number;
  predecessor: number | null;
  driver: DriverKey;
  driver_label: string;
  driver_unit: string;
  driver_rationale: string;
  /** The project's driver value and Mudon's, so the ratio is auditable. */
  project_driver_value: number;
  anchor_driver_value: number;
  anchor_days: number;
  scale_factor: number;
  /** true when the floor, not the driver, decided the duration. */
  floored: boolean;
  /** Always true: every duration here is derived from a single project. */
  derived: true;
}

export interface TimelineEstimate {
  phases: PhaseEstimate[];
  /** Critical-path totals, in days. */
  total_days: number;
  total_low_days: number;
  total_high_days: number;
  total_weeks_low: number;
  total_weeks_high: number;
  /** Phases dropped because the project has no value in their sections. */
  excluded: { key: string; label: string; reason: string }[];
  derived: true;
  basis: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Scale factor for one phase: damped project ÷ anchor, never negative. */
export function scaleFactor(projectValue: number, anchorValue: number): number {
  if (!(anchorValue > 0) || !(projectValue > 0)) return 0;
  return Math.pow(projectValue / anchorValue, SCALE_DAMPING);
}

/**
 * Uncertainty band for a phase. Widest where the project is least like Mudon:
 * a job at the anchor gets ±15%, one an order of magnitude away gets much more.
 * This is an honesty device, not a confidence interval — there is no
 * distribution behind it, and the UI says so.
 */
export function bandFor(scale: number, isProxy: boolean): number {
  const distance = scale > 0 ? Math.abs(Math.log(scale)) : 1;
  return BASE_BAND + BAND_WIDENING * distance + (isProxy ? PROXY_EXTRA_BAND : 0);
}

/** Does this project have any BoQ value in the sections a phase covers? */
export function phaseApplies(
  anchor: PhaseAnchor,
  sectionTotals: Record<string, number>,
): boolean {
  // A phase with no sections listed (snagging) always applies.
  if (anchor.sections.length === 0) return true;
  return anchor.sections.some((s) => (sectionTotals[s] ?? 0) > 0);
}

export function estimatePhase(
  anchor: PhaseAnchor,
  drivers: DriverValues,
): PhaseEstimate {
  const projectValue = drivers[anchor.driver] ?? 0;
  const scale = scaleFactor(projectValue, anchor.anchor_driver_value);
  const raw = anchor.anchor_days * scale;
  const floored = raw < anchor.floor_days;
  const days = Math.max(anchor.floor_days, raw);

  const isProxy = anchor.driver === "fitout_value_aed";
  const band = bandFor(scale || 1, isProxy);
  let low = Math.max(anchor.floor_days, days * (1 - band));
  let high = days * (1 + band);
  // A range must never read as a single day.
  if (high - low < MIN_RANGE_DAYS) {
    const mid = (high + low) / 2;
    low = Math.max(anchor.floor_days, mid - MIN_RANGE_DAYS / 2);
    high = low + MIN_RANGE_DAYS;
  }

  return {
    n: anchor.n,
    key: anchor.key,
    label: anchor.label,
    milestone: anchor.milestone,
    days: round1(days),
    low_days: Math.floor(low),
    high_days: Math.ceil(high),
    start_day: 0,
    end_day: 0,
    predecessor: anchor.predecessor,
    driver: anchor.driver,
    driver_label: DRIVER_LABEL[anchor.driver],
    driver_unit: DRIVER_UNIT[anchor.driver],
    driver_rationale: anchor.driver_rationale,
    project_driver_value: round1(projectValue),
    anchor_driver_value: anchor.anchor_driver_value,
    anchor_days: anchor.anchor_days,
    scale_factor: Math.round(scale * 1000) / 1000,
    floored,
    derived: true,
  };
}

/**
 * Walk the dependency graph to get each phase's start/end offset and the
 * critical-path total. Phases sharing a predecessor run CONCURRENTLY — which is
 * what phases 4 and 5 actually did on Mudon — so the total is the latest end,
 * not the sum of durations.
 */
function schedule(phases: PhaseEstimate[], pick: (p: PhaseEstimate) => number): number {
  const byN = new Map(phases.map((p) => [p.n, p]));
  const endOf = new Map<number, number>();

  const resolve = (p: PhaseEstimate, seen: Set<number>): number => {
    if (endOf.has(p.n)) return endOf.get(p.n)!;
    // Guard against a malformed graph rather than looping forever.
    if (seen.has(p.n)) return 0;
    seen.add(p.n);
    let start = 0;
    if (p.predecessor != null) {
      const pred = byN.get(p.predecessor);
      if (pred) {
        start = resolve(pred, seen);
      } else {
        // The predecessor was excluded from this project's scope — inherit its
        // own predecessor's finish by walking up the original anchor chain.
        let up = PHASE_ANCHORS.find((a) => a.n === p.predecessor)?.predecessor ?? null;
        while (up != null && !byN.has(up)) {
          up = PHASE_ANCHORS.find((a) => a.n === up)?.predecessor ?? null;
        }
        const upPhase = up != null ? byN.get(up) : undefined;
        start = upPhase ? resolve(upPhase, seen) : 0;
      }
    }
    const end = start + pick(p);
    p.start_day = Math.round(start);
    p.end_day = Math.round(end);
    endOf.set(p.n, end);
    return end;
  };

  let latest = 0;
  for (const p of phases) latest = Math.max(latest, resolve(p, new Set()));
  return latest;
}

export function estimateTimeline(input: EstimateInput): TimelineEstimate {
  const applied: PhaseEstimate[] = [];
  const excluded: TimelineEstimate["excluded"] = [];

  for (const anchor of PHASE_ANCHORS) {
    if (!phaseApplies(anchor, input.sectionTotals)) {
      excluded.push({
        key: anchor.key,
        label: anchor.label,
        reason: `No BoQ value in ${anchor.sections.join(", ")}`,
      });
      continue;
    }
    applied.push(estimatePhase(anchor, input.drivers));
  }

  applied.sort((a, b) => a.n - b.n);

  // Critical path at the point estimate sets the bars; the low/high totals are
  // the same walk at each end of the band.
  const total = schedule(applied, (p) => p.days);
  const low = schedule(
    applied.map((p) => ({ ...p })),
    (p) => p.low_days,
  );
  const high = schedule(
    applied.map((p) => ({ ...p })),
    (p) => p.high_days,
  );

  return {
    phases: applied,
    total_days: Math.round(total),
    total_low_days: Math.floor(low),
    total_high_days: Math.ceil(high),
    total_weeks_low: Math.floor(low / 7),
    total_weeks_high: Math.ceil(high / 7),
    excluded,
    derived: true,
    basis: `Scaled from one calibrated project — Mudon Villa 94, ${MUDON_TOTAL_DAYS} days over ${PHASE_ANCHORS.length} phases (15 Jul – 5 Oct 2026, signed contract). Estimated, not measured: refined as more projects complete.`,
  };
}

/** Mudon's own drivers — used to assert the identity case reproduces itself. */
export function mudonDrivers(): DriverValues {
  return { ...MUDON_DRIVERS };
}

/** Section totals that switch every phase on, for the identity case. */
export function allSectionsPresent(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of PHASE_ANCHORS) for (const s of a.sections) out[s] = 1;
  return out;
}
