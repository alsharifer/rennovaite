// =============================================================================
// lib/firms/vocabulary.ts — what a firm may put in its book (L1).
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
// =============================================================================

import { UNPRICED_GARDEN_ITEMS } from "@/lib/boq/garden-takeoff";
import { WORK_ITEM_DEF } from "@/lib/boq/elements";
import { RATE_RULES } from "@/lib/boq/rules";
import { getGardenRate } from "@/lib/ground-truth/villa94-garden";
import { FIRM_ENTRY_KINDS, type FirmEntryKind } from "@/lib/rates/firm";

export const KNOWN_UNITS = ["m2", "lm", "no", "project", "lump", "point", "m2 plan", "m3"] as const;

export interface ItemVocabulary {
  item_key: string;
  path: "interior" | "garden";
  label: string;
  /** The unit the take-off measures in, when it is fixed by the vocabulary. */
  unit: string | null;
  kinds: readonly FirmEntryKind[];
  /** The kind a promotion defaults to when the correction does not say. */
  default_kind: FirmEntryKind;
}

const SCOPE_KINDS: Record<string, readonly FirmEntryKind[]> = {
  install_only: ["labour", "lump"],
  supply_only: ["supply"],
  supply_and_install: ["supply_and_install", "lump"],
};

export function itemVocabulary(item_key: string): ItemVocabulary | null {
  const g = getGardenRate(item_key);
  if (g) {
    const kinds = SCOPE_KINDS[g.scope] ?? FIRM_ENTRY_KINDS;
    return { item_key, path: "garden", label: g.label, unit: g.unit, kinds, default_kind: kinds[0]! };
  }
  const u = UNPRICED_GARDEN_ITEMS[item_key];
  if (u) {
    return { item_key, path: "garden", label: u.label, unit: u.unit, kinds: ["supply_and_install", "supply", "labour", "lump"], default_kind: "supply_and_install" };
  }
  // T3b: the six P4 element work items (Demolition, Plaster, Floor / Wall
  // Finishes, Ceilings, Painting). With the viewer flag on these lines replace
  // the engine's, so a firm prices plaster as wall_plaster, not plaster.make_good.
  const el = (WORK_ITEM_DEF as Record<string, { description: string } | undefined>)[item_key];
  if (el) {
    return { item_key, path: "interior", label: `P4 ${item_key} — ${el.description}`, unit: "m2", kinds: ["supply_and_install", "labour", "lump"], default_kind: "supply_and_install" };
  }
  const r = RATE_RULES[item_key];
  if (r) {
    if (r.material) {
      return { item_key, path: "interior", label: `${r.rule_id} ${item_key}`, unit: r.material.unit, kinds: ["supply"], default_kind: "supply" };
    }
    return {
      item_key,
      path: "interior",
      label: `${r.rule_id} ${item_key}`,
      unit: null,
      kinds: r.labour ? ["labour", "supply_and_install", "lump"] : FIRM_ENTRY_KINDS,
      default_kind: r.labour ? "labour" : "supply_and_install",
    };
  }
  return null;
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
