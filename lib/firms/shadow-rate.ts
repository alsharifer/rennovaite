// =============================================================================
// lib/firms/shadow-rate.ts — the figure a firm entry would SHADOW (H8).
//
// The magnitude check (lib/firms/magnitude.ts) compares a firm rate with what
// the item prices at when the firm has no entry — the same answer the
// resolver gives one tier down:
//   - a garden key → the market reference (rate_book, standard grade), the
//     figure the rate-vocabulary endpoint already shows;
//   - a P4 element key → its WORK_ITEM_DEF constant;
//   - an interior allowance rule → its allowance constant.
// Catalogue (SKU pick) and labour-book keys have no single figure — the price
// depends on the tier and the catalogue — so they are not checked, and say so.
//
// SERVER-ONLY (it reads rate_book).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { WORK_ITEM_DEF } from "@/lib/boq/elements";
import { GARDEN_GRADE } from "@/lib/boq/garden-rates";
import { RATE_RULES } from "@/lib/boq/rules";
import { indexReference, loadReferenceRows, lookupCalibrated, lookupIndicative } from "@/lib/rates/reference";

import { itemVocabulary } from "./vocabulary";

export interface ShadowRate {
  rate_aed: number;
  unit: string | null;
  source: "market" | "element_def" | "allowance";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The built-in figure an interior key prices at, where there is exactly one. Pure. */
export function builtinShadowRate(item_key: string): ShadowRate | null {
  const v = itemVocabulary(item_key);
  if (!v || v.path !== "interior") return null;
  if (v.builtin === "element_def") {
    const def = (WORK_ITEM_DEF as Record<string, { rate_aed: number } | undefined>)[item_key];
    return def ? { rate_aed: def.rate_aed, unit: v.unit, source: "element_def" } : null;
  }
  if (v.builtin === "allowance") {
    const a = RATE_RULES[item_key]?.allowance_aed;
    return a != null ? { rate_aed: a, unit: v.unit, source: "allowance" } : null;
  }
  return null;
}

/** The shadowed figure for every key asked for (garden keys read the market book once). */
export async function loadShadowRates(db: SupabaseClient, itemKeys: readonly string[]): Promise<Map<string, ShadowRate>> {
  const out = new Map<string, ShadowRate>();
  const garden = itemKeys.filter((k) => itemVocabulary(k)?.path === "garden");
  if (garden.length) {
    let idx = indexReference([]);
    try {
      idx = indexReference(await loadReferenceRows(db, { itemKeyPrefix: "garden." }));
    } catch {
      // No reference book: no market figure to check against (never a guess).
    }
    for (const k of garden) {
      const row = lookupCalibrated(idx, k, GARDEN_GRADE) ?? lookupIndicative(idx, k, GARDEN_GRADE);
      if (row) out.set(k, { rate_aed: r2(Number(row.rate_aed)), unit: row.unit, source: "market" });
    }
  }
  for (const k of itemKeys) {
    if (out.has(k)) continue;
    const b = builtinShadowRate(k);
    if (b) out.set(k, b);
  }
  return out;
}
