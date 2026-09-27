// =============================================================================
// lib/firms/vocabulary.ts — what a firm may put in its book (L1 + U2).
//
// A firm entry prices one take-off item_key. It is validated against the same
// vocabulary the take-offs emit, so an entry can never:
//   - name a key no take-off produces (it would sit in the book doing nothing,
//     and look like it was doing something);
//   - price in a unit the take-off does not measure in (a per-lm rate applied to
//     m² is a silent wrong number — the resolver also refuses it at pricing time);
//   - change what a line CONTAINS. The kind must match the item's scope: a
//     supply-only material line takes a supply price, never supply-and-install,
//     or its separate labour line would be paid twice.
// Pure — no I/O.
//
// U2: `listVocabulary()` enumerates every key from the same four sources
// `itemVocabulary` resolves one from, with its POMI section and what a firm
// entry for it shadows — so the vocabulary is data an endpoint can serve
// (GET /api/rate-vocabulary), not only code. The rules themselves live in
// lib/firms/vocabulary-client.ts so the page can apply them without carrying
// the take-off modules; `validateEntry` here is the server's copy of the same
// four checks, and a test holds the two to each other.
// =============================================================================

import { UNPRICED_GARDEN_ITEMS, GARDEN_ITEM_SECTION } from "@/lib/boq/garden-takeoff";
import { WORK_ITEM_DEF } from "@/lib/boq/elements";
import { RATE_RULES } from "@/lib/boq/rules";
import { GARDEN_RATES, getGardenRate } from "@/lib/ground-truth/villa94-garden";
import { FIRM_ENTRY_KINDS, type FirmEntryKind } from "@/lib/rates/firm";

import { KNOWN_UNITS } from "./vocabulary-client";

export { KNOWN_UNITS };

export interface ItemVocabulary {
  item_key: string;
  path: "interior" | "garden";
  label: string;
  /** POMI-style section the item's line lands in. */
  section: string;
  /** The unit the take-off measures in, when it is fixed by the vocabulary. */
  unit: string | null;
  kinds: readonly FirmEntryKind[];
  /** The kind a promotion defaults to when the correction does not say. */
  default_kind: FirmEntryKind;
  /** Interior keys: the built-in pricing a firm entry shadows (garden keys shadow the reference book). */
  builtin?: "catalog" | "labour_book" | "allowance" | "element_def";
}

const SCOPE_KINDS: Record<string, readonly FirmEntryKind[]> = {
  install_only: ["labour", "lump"],
  supply_only: ["supply"],
  supply_and_install: ["supply_and_install", "lump"],
};

const GARDEN_FALLBACK_SECTION = "External Works";

export function itemVocabulary(item_key: string): ItemVocabulary | null {
  const g = getGardenRate(item_key);
  if (g) {
    const kinds = SCOPE_KINDS[g.scope] ?? FIRM_ENTRY_KINDS;
    return { item_key, path: "garden", label: g.label, section: GARDEN_ITEM_SECTION[item_key] ?? GARDEN_FALLBACK_SECTION, unit: g.unit, kinds, default_kind: kinds[0]! };
  }
  const u = UNPRICED_GARDEN_ITEMS[item_key];
  if (u) {
    return {
      item_key,
      path: "garden",
      label: u.label,
      section: GARDEN_ITEM_SECTION[item_key] ?? GARDEN_FALLBACK_SECTION,
      unit: u.unit,
      kinds: ["supply_and_install", "supply", "labour", "lump"],
      default_kind: "supply_and_install",
    };
  }
  // T3b: the six P4 element work items (Demolition, Plaster, Floor / Wall
  // Finishes, Ceilings, Painting). With the viewer flag on these lines replace
  // the engine's, so a firm prices plaster as wall_plaster, not plaster.make_good.
  const el = (WORK_ITEM_DEF as Record<string, { section: string; description: string } | undefined>)[item_key];
  if (el) {
    return {
      item_key,
      path: "interior",
      label: `P4 ${item_key} — ${el.description}`,
      section: el.section,
      unit: "m2",
      kinds: ["supply_and_install", "labour", "lump"],
      default_kind: "supply_and_install",
      builtin: "element_def",
    };
  }
  const r = RATE_RULES[item_key];
  if (r) {
    if (r.material) {
      return {
        item_key,
        path: "interior",
        label: `${r.rule_id} ${item_key}`,
        section: r.labour?.work_section ?? "Materials (supply)",
        unit: r.material.unit,
        kinds: ["supply"],
        default_kind: "supply",
        builtin: "catalog",
      };
    }
    return {
      item_key,
      path: "interior",
      label: `${r.rule_id} ${item_key}`,
      section: r.labour?.work_section ?? "Interior (allowance)",
      unit: null,
      kinds: r.labour ? ["labour", "supply_and_install", "lump"] : FIRM_ENTRY_KINDS,
      default_kind: r.labour ? "labour" : "supply_and_install",
      builtin: r.labour ? "labour_book" : "allowance",
    };
  }
  return null;
}

/** Every key a firm may price, in a stable order: garden book, garden QS-to-price, P4 elements, R-xx rules. */
export function listVocabulary(): ItemVocabulary[] {
  const keys = [
    ...GARDEN_RATES.map((g) => g.item_key),
    ...Object.keys(UNPRICED_GARDEN_ITEMS),
    ...Object.keys(WORK_ITEM_DEF),
    ...Object.keys(RATE_RULES),
  ];
  const seen = new Set<string>();
  const out: ItemVocabulary[] = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    const v = itemVocabulary(k);
    if (v) out.push(v);
  }
  return out;
}

export interface EntryDraft {
  item_key: string;
  unit: string;
  kind: FirmEntryKind;
  rate_aed: number;
}

/** Every reason this entry cannot go in a book. Empty = valid. */
export function validateEntry(d: EntryDraft): string[] {
  const errors: string[] = [];
  const v = itemVocabulary(d.item_key);
  if (!v) return [`"${d.item_key}" is not an item any take-off prices`];
  if (!(KNOWN_UNITS as readonly string[]).includes(d.unit)) errors.push(`unit "${d.unit}" is not a take-off unit (${KNOWN_UNITS.join(", ")})`);
  if (v.unit && v.unit !== d.unit) errors.push(`${d.item_key} is measured in "${v.unit}", not "${d.unit}"`);
  if (!v.kinds.includes(d.kind)) errors.push(`${d.item_key} takes a ${v.kinds.join(" / ")} rate, not ${d.kind}`);
  if (!(d.rate_aed >= 0) || !Number.isFinite(d.rate_aed)) errors.push("rate_aed must be a finite number ≥ 0");
  return errors;
}
