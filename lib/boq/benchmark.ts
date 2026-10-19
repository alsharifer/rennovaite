// =============================================================================
// lib/boq/benchmark.ts — a contractor's single total, compared like for like
// (bathroom pilot B9). Pure.
//
// A total with no lines is a BENCHMARK: it can say "the engine is higher or
// lower", never which line is wrong, and no rate is ever calibrated from it.
// Before the two totals are compared they must cover the same things. The
// engine's grand total is the subtotal + contingency + VAT and EXCLUDES the
// community NOC fee (a TBC line). So the engine side is rebuilt to the
// contractor's scope: with or without contingency, with or without VAT. A
// labour-only quote is not comparable at all — the engine prices supply too.
// Where the contractor's scope is unknown, the comparison is the RANGE over
// every reading of it, never a guess.
// =============================================================================

import { money2 } from "./money";

/** What the contractor's figure includes — null = not stated. */
export interface BenchmarkScope {
  vat: boolean | null;
  contingency: boolean | null;
  noc: boolean | null;
  /** "full" = supply and install; "labour" = labour only (fixtures and tiles by the client). */
  supply: "full" | "labour" | null;
}

export interface EngineChain {
  subtotal_aed: number;
  contingency_pct: number;
  vat_pct: number;
  grand_total_aed: number;
}

export interface BenchmarkComparison {
  comparable: boolean;
  /** The engine's figure on the contractor's scope — a range when a part of the scope is unknown. */
  engine_low_aed: number | null;
  engine_high_aed: number | null;
  /** (contractor − engine) / engine, %, at each end of the range. */
  delta_low_pct: number | null;
  delta_high_pct: number | null;
  notes: string[];
}

/** The engine's figure for one reading of the scope: contingency on the subtotal, then VAT on both. */
function engineOn(chain: EngineChain, contingency: boolean, vat: boolean): number {
  const c = contingency ? money2((chain.subtotal_aed * chain.contingency_pct) / 100) : 0;
  const v = vat ? money2(((chain.subtotal_aed + c) * chain.vat_pct) / 100) : 0;
  return money2(chain.subtotal_aed + c + v);
}

export function compareBenchmark(contractorAed: number | null, scope: BenchmarkScope, chain: EngineChain): BenchmarkComparison {
  const notes: string[] = [];
  if (scope.supply === "labour") {
    return { comparable: false, engine_low_aed: null, engine_high_aed: null, delta_low_pct: null, delta_high_pct: null, notes: ["Labour only — the engine prices supply and install; the two totals are not comparable."] };
  }
  if (scope.supply == null) notes.push("Not stated whether the figure includes supply (fixtures, tiles) — compared as supply and install.");
  const cont = scope.contingency == null ? [false, true] : [scope.contingency];
  const vat = scope.vat == null ? [false, true] : [scope.vat];
  if (scope.contingency == null) notes.push("Not stated whether it carries a contingency — compared with and without the engine's.");
  if (scope.vat == null) notes.push("Not stated whether it includes VAT — compared with and without.");
  if (scope.noc === true) notes.push("It includes the community NOC fee; the engine does not price it (TBC) — the contractor's figure is higher by that fee.");
  if (scope.noc == null) notes.push("Not stated whether it includes the community NOC fee (the engine's is TBC, not in its total).");
  const figures = cont.flatMap((c) => vat.map((v) => engineOn(chain, c, v)));
  const low = Math.min(...figures), high = Math.max(...figures);
  const pct = (e: number) => (contractorAed == null ? null : Math.round(((contractorAed - e) / e) * 1000) / 10);
  // The delta at the LOW engine figure is the larger one (and vice versa).
  return { comparable: true, engine_low_aed: low, engine_high_aed: high, delta_low_pct: pct(high), delta_high_pct: pct(low), notes };
}
