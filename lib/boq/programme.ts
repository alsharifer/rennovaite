// =============================================================================
// lib/boq/programme.ts — an INDICATIVE delivery programme for a garden BoQ
// (garden pilot G5d; Newspace session ask #5).
//
// One comparable exists: the reference garden took 90 days mobilisation →
// handover for AED 152,059 of work (contractor + client-supplied; the quote had
// said 120 working days). Its phase split was never recorded. So:
//   - the TOTAL is the anchor scaled by value (this BoQ's subtotal / the
//     reference project total), clamped to 0.5–1.5× and rounded to 5 days —
//     one project cannot support anything finer;
//   - the PHASES are derived, not observed: a fixed week each for mobilisation
//     and handover, the rest split by the value of the work in each phase.
// Every figure is labelled indicative with provenance "derived". It is a
// conversation starter for the contractor's own programme, never a commitment.
// =============================================================================

import { TIMELINE, TOTALS } from "@/lib/ground-truth/villa94-garden";

export interface ProgrammePhase {
  name: string;
  start_day: number;
  days: number;
  /** BoQ sections whose value sized this phase (empty for the fixed phases). */
  sections: string[];
}

export interface IndicativeProgramme {
  indicative: true;
  provenance: "derived";
  total_days: number;
  phases: ProgrammePhase[];
  basis: string;
}

const PHASES: { name: string; sections: string[] | null; fixed?: number }[] = [
  { name: "Mobilisation & setting out", sections: null, fixed: 5 },
  { name: "Demolition & site clearance", sections: ["Demolition"] },
  { name: "Hardscape & structures", sections: ["Hardscape & Structures"] },
  { name: "Soft landscaping, irrigation & MEP", sections: ["Soft Landscaping", "Irrigation", "Electrical & Lighting", "Plumbing"] },
  { name: "Snagging & handover", sections: null, fixed: 5 },
];

const MIN_WORK_PHASE_DAYS = 3;

export function indicativeProgramme(sections: readonly { work_section: string; section_total_aed: number }[], subtotalAed: number): IndicativeProgramme | null {
  if (subtotalAed <= 0) return null;
  const ratio = Math.min(1.5, Math.max(0.5, subtotalAed / TOTALS.project_total));
  const total = Math.max(20, Math.round((TIMELINE.actual_days * ratio) / 5) * 5);
  const fixed = PHASES.reduce((s, p) => s + (p.fixed ?? 0), 0);
  const work = PHASES.filter((p) => p.sections);
  const value = (names: string[]) => sections.filter((s) => names.includes(s.work_section)).reduce((s, x) => s + x.section_total_aed, 0);
  const values = work.map((p) => value(p.sections!));
  const sum = values.reduce((a, b) => a + b, 0) || 1;
  const pool = total - fixed;
  // Largest-remainder rounding with a floor, so the phases add up to the total exactly.
  const raw = values.map((v) => Math.max(MIN_WORK_PHASE_DAYS, (v / sum) * pool));
  const scale = pool / raw.reduce((a, b) => a + b, 0);
  const exact = raw.map((d) => d * scale);
  const days = exact.map(Math.floor);
  let left = pool - days.reduce((a, b) => a + b, 0);
  for (const i of exact.map((d, i) => [d - Math.floor(d), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) {
    if (left <= 0) break;
    days[i]!++;
    left--;
  }
  let day = 1;
  let w = 0;
  const phases: ProgrammePhase[] = PHASES.map((p) => {
    const d = p.fixed ?? days[w++]!;
    const ph = { name: p.name, start_day: day, days: d, sections: p.sections ?? [] };
    day += d;
    return ph;
  });
  return {
    indicative: true,
    provenance: "derived",
    total_days: total,
    phases,
    basis: `Indicative only. Scaled from one comparable Dubai garden (${TIMELINE.actual_days} days from mobilisation to handover for AED ${Math.round(TOTALS.project_total).toLocaleString("en-US")} of work) by this BoQ's value (x ${ratio.toFixed(2)}), rounded to 5 days. Phase lengths are derived from the value of the work in each phase; the reference project did not record its phase split. To be replaced by the contractor's programme.`,
  };
}
