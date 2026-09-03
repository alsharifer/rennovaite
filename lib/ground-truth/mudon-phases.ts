// =============================================================================
// lib/ground-truth/mudon-phases.ts — Mudon Villa 94 programme actuals (D2).
//
// Transcribed from the signed Newspace labour contract's PAYMENT SCHEDULE
// (Mudon_Villa94_Ground_Truth_and_Delta_Log.xlsx → "Labour (SOW)" sheet, rows
// 28-36). The raw workbook is gitignored under /data/ with the rest of the
// client documents; this module is the code-shaped source of truth, exactly as
// mudon-actuals.ts is for the priced quotations.
//
// Provenance: actual_transaction. n = 1 — ANCHORS, NOT STATISTICS. Payment
// amounts are deliberately omitted: the estimator needs the dates, not the
// client's commercial terms.
//
// Two facts about this source that the model must not smooth over:
//
//   · These are CONTRACTUAL milestone dates — when each phase was paid against
//     — not a resourced programme. It is the best available proxy for when work
//     finished, and it is described as exactly that.
//   · Phase 5 completes 18 Sep, BEFORE phase 4's 21 Sep. That is not a
//     transcription error: painting and electrical 2nd fix ran concurrently
//     with screed and tiling, both following phase 3. The dependency graph
//     below preserves the overlap, so the total is a critical path rather than
//     a sum of durations.
// =============================================================================

export const MUDON_PHASE_SOURCE =
  "Newspace FZ L.L.C labour contract, payment schedule — Mudon Al Naseem Villa 94, first-floor refit";

export const MUDON_PROGRAMME_START = "2026-07-15";
export const MUDON_PROGRAMME_END = "2026-10-05";
/** 15 Jul → 5 Oct 2026 inclusive of the span, exclusive of double-counting. */
export const MUDON_PROGRAMME_DAYS = 82;

export interface MudonPhaseActual {
  n: number;
  /** Contract milestone wording, verbatim. */
  milestone: string;
  start: string;
  complete: string;
  /** Calendar days from this phase's start to its completion. */
  days: number;
  /** Phase this one follows; null = programme start. */
  predecessor: number | null;
  note?: string;
}

export const MUDON_PHASE_ACTUALS: MudonPhaseActual[] = [
  {
    n: 1,
    milestone: "Demolition & strip-out complete",
    start: "2026-07-15",
    complete: "2026-07-29",
    days: 14,
    predecessor: null,
    note: "Mobilisation / kick-off is the payment trigger AT this phase's start, so the contract gives mobilisation no separate duration of its own.",
  },
  {
    n: 2,
    milestone: "Civil works & MEP first-fix complete",
    start: "2026-07-29",
    complete: "2026-08-21",
    days: 23,
    predecessor: 1,
  },
  {
    n: 3,
    milestone: "Ceilings & plastering complete",
    start: "2026-08-21",
    complete: "2026-09-02",
    days: 12,
    predecessor: 2,
  },
  {
    n: 4,
    milestone: "Screed & tiling complete",
    start: "2026-09-02",
    complete: "2026-09-21",
    days: 19,
    predecessor: 3,
  },
  {
    n: 5,
    milestone: "Painting & electrical 2nd fix complete",
    start: "2026-09-02",
    complete: "2026-09-18",
    days: 16,
    predecessor: 3,
    note: "Concurrent with phase 4 — same predecessor, finishes three days earlier.",
  },
  {
    n: 6,
    milestone: "Staircase & sanitary install complete",
    start: "2026-09-21",
    complete: "2026-09-26",
    days: 5,
    predecessor: 4,
    note: "Starts on the LATER of phases 4 and 5 (21 Sep).",
  },
  {
    n: 7,
    milestone: "Snagging & final handover",
    start: "2026-09-26",
    complete: "2026-10-05",
    days: 9,
    predecessor: 6,
  },
];

/** Duration of one phase, by number. Throws rather than defaulting silently. */
export function mudonPhaseDays(n: number): number {
  const p = MUDON_PHASE_ACTUALS.find((x) => x.n === n);
  if (!p) throw new Error(`No Mudon phase actual for phase ${n}.`);
  return p.days;
}
