// =============================================================================
// lib/firms/vocabulary-client.ts — the vocabulary's SHAPE and the validation
// rules, with no imports (U2).
//
// lib/firms/vocabulary.ts derives the vocabulary from the take-off modules,
// which a client bundle should not carry. The rate-book page instead fetches
// GET /api/rate-vocabulary (one VocabularyItem per key) and validates a draft
// entry against the item it names with `validateDraftAgainst` below — the SAME
// four rules, the SAME messages, as the server's validateEntry, so what the
// page says inline is what the API would have said. A test holds the two to
// each other.
// =============================================================================

export const KNOWN_UNITS = ["m2", "lm", "no", "project", "lump", "point", "m2 plan", "m3"] as const;

export const ENTRY_KINDS = ["labour", "supply", "supply_and_install", "lump"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface VocabularyItem {
  item_key: string;
  path: "interior" | "garden";
  label: string;
  /** POMI-style section the item's line lands in. */
  section: string;
  /** The unit the take-off measures in; null when a rule leaves it to the SKU. */
  unit: string | null;
  kinds: readonly EntryKind[];
  default_kind: EntryKind;
  /**
   * What a firm entry for this key SHADOWS. A market-reference rate exists only
   * where the resolver would read one (tier 3, the garden keys); interior keys
   * fall through to built-in pricing (catalogue SKU pick, labour book,
   * allowance, or the P4 element constant) and carry no single reference figure.
   */
  reference:
    | { kind: "market"; rate_aed: number; unit: string; grade: string | null; provenance: string }
    | { kind: "builtin"; how: "catalog" | "labour_book" | "allowance" | "element_def" }
    | { kind: "none" };
}

export interface EntryDraft {
  item_key: string;
  unit: string;
  kind: EntryKind;
  rate_aed: number;
}

/** Every reason this draft cannot go in a book, given the vocabulary item it names. Empty = valid. */
export function validateDraftAgainst(item: VocabularyItem | null | undefined, d: EntryDraft): string[] {
  const errors: string[] = [];
  if (!item) return [`"${d.item_key}" is not an item any take-off prices`];
  if (!(KNOWN_UNITS as readonly string[]).includes(d.unit)) errors.push(`unit "${d.unit}" is not a take-off unit (${KNOWN_UNITS.join(", ")})`);
  if (item.unit && item.unit !== d.unit) errors.push(`${d.item_key} is measured in "${item.unit}", not "${d.unit}"`);
  if (!item.kinds.includes(d.kind)) errors.push(`${d.item_key} takes a ${item.kinds.join(" / ")} rate, not ${d.kind}`);
  if (!(d.rate_aed >= 0) || !Number.isFinite(d.rate_aed)) errors.push("rate_aed must be a finite number ≥ 0");
  return errors;
}

/** Group vocabulary items by section, sections in first-seen order, items by label. */
export function groupBySection(items: readonly VocabularyItem[]): { section: string; items: VocabularyItem[] }[] {
  const out = new Map<string, VocabularyItem[]>();
  for (const it of items) {
    if (!out.has(it.section)) out.set(it.section, []);
    out.get(it.section)!.push(it);
  }
  return [...out.entries()].map(([section, list]) => ({ section, items: list.slice().sort((a, b) => a.label.localeCompare(b.label)) }));
}
