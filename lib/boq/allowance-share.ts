// =============================================================================
// lib/boq/allowance-share.ts — how much of a price rests on our own estimates,
// BY VALUE (bathroom pilot B9). Pure and client-safe.
//
// "21 of 42 lines are allowances" is the wrong unit: a 56-dirham floor sheet
// and a 2,200-dirham shower set count the same. The share that matters is the
// AED of the base total (the subtotal, before contingency and VAT) whose rate is
// an allowance — a judgement figure no quote, catalogue or transaction backs —
// and which lines carry most of it.
// =============================================================================

import { money2, sumMoney } from "./money";
import { rateBasisOf } from "./rate-basis";

interface LineLike {
  ref?: string | null;
  rule_id?: string | null;
  item_key?: string | null;
  description?: string | null;
  quantity?: number | null;
  total_aed?: number | null;
  rate_aed?: number | null;
  rate_status?: string | null;
  rate_tier?: string | null;
  rate_basis?: string | null;
}

export interface AllowanceLine {
  ref: string | null;
  item_key: string | null;
  rule_id: string | null;
  description: string;
  total_aed: number;
  /** What would turn this allowance into a rate. */
  needs: string;
}

export interface AllowanceShare {
  /** The base total — the sum of the lines, before contingency and VAT. */
  base_aed: number;
  allowance_aed: number;
  /** Share of the base total, % to 1 dp. */
  pct: number;
  allowance_lines: number;
  /** Lines that price something (a positive quantity, or a line still to be priced). */
  lines: number;
  /** The allowance lines, largest first. */
  top: AllowanceLine[];
}

const basisOf = (l: LineLike) => l.rate_basis ?? rateBasisOf(l);

/**
 * What an allowance needs to become a rate, by the kind of thing it prices:
 * a product → a supplier quote or a catalogue price; work → a labour rate from
 * the reference villa (Mudon) where the trade matches, else the labour book.
 */
export function allowanceNeeds(itemKey: string | null | undefined): string {
  const k = itemKey ?? "";
  if (/^prelim\./.test(k)) return "a labour rate for one room from a real job — the reference villa's site set-up covers a whole floor";
  if (/^(san|joinery|alum)\./.test(k) || /mirror|vanity|cabinet|panel/.test(k)) return "a supplier quote or a catalogue price for the product, plus its fitting";
  if (/^(light)\./.test(k)) return "a catalogue price for the strip";
  return "a labour rate for the trade (the reference villa's where it matches, else the labour book)";
}

/** Pure: the allowance share of a BoQ's base total, by value. */
export function allowanceShare(sections: readonly { lines: readonly LineLike[] }[], top = 5): AllowanceShare {
  const lines = sections.flatMap((s) => s.lines);
  const priced = lines.filter((l) => basisOf(l) === "tbc" || (Number(l.quantity) || 0) > 0);
  const allowances = priced.filter((l) => basisOf(l) === "allowance");
  const base = sumMoney(lines.map((l) => Number(l.total_aed) || 0));
  const allowance = sumMoney(allowances.map((l) => Number(l.total_aed) || 0));
  return {
    base_aed: base,
    allowance_aed: allowance,
    pct: base > 0 ? Math.round((allowance / base) * 1000) / 10 : 0,
    allowance_lines: allowances.length,
    lines: priced.length,
    top: [...allowances]
      .sort((a, b) => (Number(b.total_aed) || 0) - (Number(a.total_aed) || 0))
      .slice(0, top)
      .map((l) => ({ ref: l.ref ?? null, item_key: l.item_key ?? null, rule_id: l.rule_id ?? null, description: l.description ?? "", total_aed: money2(Number(l.total_aed) || 0), needs: allowanceNeeds(l.item_key) })),
  };
}
