// =============================================================================
// lib/whatif/engine.ts — deterministic client-side what-if recalc (Prompt P5).
//
// Pure. Quantities come from the BoQ line (which P4 set = the graph take-off);
// ONLY rates swap per the selected grade. The project total moves by exactly
// Σ (new_rate − baseline_rate) × quantity — no LLM, no re-estimation. The stored
// BoQ is never mutated; this renders a scenario over it.
// =============================================================================

import {
  BASELINE_GRADE,
  GRADE_SPECS,
  GRADEABLE_ITEMS,
  ITEM_LABEL,
  itemKeyFromRuleId,
  type Grade,
  type GradeableItem,
} from "./grades";

export interface RateBookEntry {
  rate_aed: number;
  source: string;
  qs_validated: boolean;
  spec: string;
}
export type RateBook = Record<GradeableItem, Record<Grade, RateBookEntry>>;

export interface ScenarioLine {
  rule_id?: string;
  quantity: number;
  rate_aed: number;
  total_aed: number;
  description: string;
}
export interface ScenarioBoq {
  sections: { work_section: string; lines: ScenarioLine[] }[];
  grand_total_aed: number;
}

export type Selections = Partial<Record<GradeableItem, Grade>>;

export interface PerChange {
  item_key: GradeableItem;
  label: string;
  work_section: string;
  quantity: number;
  unit: string;
  baseline_rate: number;
  grade: Grade;
  new_rate: number;
  /** (new_rate − baseline_rate) × quantity, rounded to the fils. */
  delta: number;
  qs_validated: boolean;
  source: string;
  spec: string;
}

export interface RecalcResult {
  /** baseline grand total + Σ delta (the animated "project total"). */
  total: number;
  delta: number;
  perChange: PerChange[];
  changedItemKeys: GradeableItem[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A BoQ qualifies for what-if only if it was produced by the P4 take-off
 * pipeline (mapped lines carry `P4/quantify/*` rule ids). Legacy LLM-path BoQs
 * lack this provenance and must not enable what-if.
 */
export function hasTakeoffProvenance(boq: ScenarioBoq): boolean {
  return boq.sections.some((s) =>
    s.lines.some((l) => l.rule_id?.startsWith("P4/quantify/")),
  );
}

/** Default rate book from the QS-reviewable grade specs (grades.ts). */
export function defaultRateBook(): RateBook {
  const rb = {} as RateBook;
  for (const item of GRADEABLE_ITEMS) {
    rb[item] = {
      economy: { ...GRADE_SPECS[item].economy },
      standard: { ...GRADE_SPECS[item].standard },
      premium: { ...GRADE_SPECS[item].premium },
    };
  }
  return rb;
}

/** Index a BoQ's gradeable lines by their item key (one line per key in P4). */
export function gradeableLines(
  boq: ScenarioBoq,
): { item_key: GradeableItem; work_section: string; line: ScenarioLine }[] {
  const out: { item_key: GradeableItem; work_section: string; line: ScenarioLine }[] = [];
  for (const s of boq.sections) {
    for (const line of s.lines) {
      const key = itemKeyFromRuleId(line.rule_id);
      if (key) out.push({ item_key: key, work_section: s.work_section, line });
    }
  }
  return out;
}

/**
 * Recalculate the scenario total. For each gradeable line, delta =
 * (rateBook[item][grade] − line.rate_aed) × line.quantity. The line's stored
 * rate IS the standard/baseline, so a "standard" selection is a zero-delta no-op.
 */
export function recalc(
  boq: ScenarioBoq,
  rateBook: RateBook,
  selections: Selections,
): RecalcResult {
  const perChange: PerChange[] = [];
  let delta = 0;
  const changed: GradeableItem[] = [];

  for (const { item_key, work_section, line } of gradeableLines(boq)) {
    const grade: Grade = selections[item_key] ?? BASELINE_GRADE;
    const entry = rateBook[item_key][grade];
    const lineDelta = round2((entry.rate_aed - line.rate_aed) * line.quantity);
    if (grade !== BASELINE_GRADE) changed.push(item_key);
    delta = round2(delta + lineDelta);
    perChange.push({
      item_key,
      label: ITEM_LABEL[item_key],
      work_section,
      quantity: line.quantity,
      unit: "m²",
      baseline_rate: line.rate_aed,
      grade,
      new_rate: entry.rate_aed,
      delta: lineDelta,
      qs_validated: entry.qs_validated,
      source: entry.source,
      spec: entry.spec,
    });
  }

  return {
    total: round2(boq.grand_total_aed + delta),
    delta,
    perChange,
    changedItemKeys: changed,
  };
}

/**
 * Budget dial (v0): greedily suggest the grade set closest UNDER a target total
 * by downgrading the largest-saving lines to economy first. A starting point,
 * not a design decision. Returns only the items it downgraded.
 */
export function suggestForBudget(
  boq: ScenarioBoq,
  rateBook: RateBook,
  targetTotal: number,
): Selections {
  const baseline = boq.grand_total_aed;
  if (targetTotal >= baseline) return {}; // already under target at standard

  // Economy saving per line (positive = money saved by downgrading).
  const savings = gradeableLines(boq)
    .map(({ item_key, line }) => ({
      item_key,
      save: round2((line.rate_aed - rateBook[item_key].economy.rate_aed) * line.quantity),
    }))
    .filter((x) => x.save > 0)
    .sort((a, b) => b.save - a.save);

  const selections: Selections = {};
  let current = baseline;
  for (const { item_key, save } of savings) {
    if (current <= targetTotal) break;
    selections[item_key] = "economy";
    current = round2(current - save);
  }
  return selections;
}
