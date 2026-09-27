// =============================================================================
// lib/quotes/match.ts — suggest an item_key for a quotation line (U3).
//
// A supplier writes "Porcelain floor tile 600x600 supply" and the take-off
// wants `floor.porcelain_material`. This scores every vocabulary item against
// the line's description by shared tokens, weighted so that a rare token
// ("porcelain") counts more than a common one ("supply"), and returns the best
// with its score. It is a SUGGESTION: the review screen shows it, a member
// confirms it, and nothing is written to a book on the strength of a score.
// An explicit item_key in the template that names a real key scores 1 — still
// a suggestion, still confirmed by a person. Pure.
// =============================================================================

import type { VocabularyItem } from "@/lib/firms/vocabulary-client";

export interface Suggestion {
  item_key: string;
  score: number;
  via: "key" | "description";
}

/** Below this the suggestion is not offered (the line is simply unmatched). */
export const SUGGEST_THRESHOLD = 0.45;

const STOP = new Set(["and", "the", "for", "with", "per", "of", "to", "in", "on", "at", "by", "or", "any", "all", "sqm", "sq", "m2", "lm", "nos", "no", "each", "rate", "unit", "supply", "install", "installation", "including", "incl", "complete", "works", "work"]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[_./\-×x]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t))
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t));
}

type Indexed = { item: VocabularyItem; toks: Set<string> };

export function indexVocabulary(vocab: readonly VocabularyItem[]): { items: Indexed[]; idf: Map<string, number>; df: Map<string, number> } {
  const items = vocab.map((item) => ({ item, toks: new Set([...tokens(item.label), ...tokens(item.item_key)]) }));
  const df = new Map<string, number>();
  for (const it of items) for (const t of it.toks) df.set(t, (df.get(t) ?? 0) + 1);
  const n = items.length || 1;
  const idf = new Map([...df].map(([t, d]) => [t, Math.log(1 + n / d)]));
  return { items, idf, df };
}

/**
 * A word the vocabulary has never seen ("louvred", "sign") still counts against
 * the line: it is meaning the item does not explain. It weighs this much.
 */
const UNKNOWN_IDF = 2.5;
/** A shared token that occurs in exactly ONE item is an identifier ("pergola"), worth this much on its own. */
const UNIQUE_BONUS = 0.15;

/**
 * Best vocabulary match for a line. `given` is the template's item_key column,
 * honoured when it names a real key.
 */
export function suggestItemKey(
  description: string,
  given: string | null | undefined,
  index: ReturnType<typeof indexVocabulary>,
): Suggestion | null {
  if (given && given.trim()) {
    const key = given.trim();
    if (index.items.some((i) => i.item.item_key === key)) return { item_key: key, score: 1, via: "key" };
  }
  const q = [...new Set(tokens(description))];
  if (q.length === 0) return null;
  const w = (t: string) => index.idf.get(t) ?? UNKNOWN_IDF;
  const qWeight = q.reduce((s, t) => s + w(t), 0);
  let best: Suggestion | null = null;
  for (const { item, toks } of index.items) {
    let shared = 0;
    let unique = false;
    let iWeight = 0;
    for (const t of toks) iWeight += w(t);
    for (const t of q) {
      if (!toks.has(t)) continue;
      shared += w(t);
      if (index.df.get(t) === 1) unique = true;
    }
    if (shared === 0) continue;
    // Two views, both in idf mass: how much of the LINE the item explains
    // (coverage — unknown words count against it), and how much the two overlap
    // overall (Dice). A token that exists in exactly one item identifies it.
    const coverage = shared / qWeight;
    const dice = (2 * shared) / (qWeight + iWeight);
    const score = 0.6 * coverage + 0.4 * dice + (unique ? UNIQUE_BONUS : 0);
    if (!best || score > best.score) best = { item_key: item.item_key, score: Math.round(Math.min(1, score) * 1000) / 1000, via: "description" };
  }
  return best && best.score >= SUGGEST_THRESHOLD ? best : null;
}
