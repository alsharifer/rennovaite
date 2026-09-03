// =============================================================================
// lib/accessories/types.ts — D1 accessory / spec selection vocabulary.
//
// The four categories that used to be priced by rule with no user choice. A
// selection swaps ONE BoQ line's rate source; quantities never move, because
// the user picks WHAT and the take-off computes HOW MANY.
//
// `spec_class` follows the P8 spec-class map, and means a CLASS of
// specification rather than a price band — an exposed and a concealed shower
// are different classes, not one item at two prices. That distinction is what
// two of the three Mudon "sanitary gaps" actually were.
//
// Pure: no DB, no React. Unit-tested.
// =============================================================================

import type { Scope } from "@/lib/ground-truth/mudon-actuals";

export const ACCESSORY_CATEGORIES = [
  "sanitary",
  "lighting",
  "electrical_points",
  "hvac",
] as const;
export type AccessoryCategory = (typeof ACCESSORY_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<AccessoryCategory, string> = {
  sanitary: "Sanitary",
  lighting: "Lighting",
  electrical_points: "Sockets & switches",
  hvac: "AC & heating",
};

export const CATEGORY_GLYPH: Record<AccessoryCategory, string> = {
  sanitary: "bathtub",
  lighting: "lightbulb",
  electrical_points: "outlet",
  hvac: "hvac",
};

export const SPEC_CLASSES = ["economy", "standard", "premium"] as const;
export type SpecClass = (typeof SPEC_CLASSES)[number];

export const SPEC_CLASS_LABEL: Record<SpecClass, string> = {
  economy: "Economy",
  standard: "Standard",
  premium: "Premium",
};

/**
 * Which BoQ item_keys belong to which category. This is the map that lets a
 * category picker drive individual BoQ lines — every key here is an item the
 * deterministic engine already emits (see lib/boq/rules.ts RATE_RULES).
 */
export const CATEGORY_ITEM_KEYS: Record<AccessoryCategory, string[]> = {
  sanitary: [
    "san.wc",
    "san.basin",
    "san.shower",
    "san.shattaf",
    "san.paper_holder",
    "san.towel_rail",
    "san.actuator",
  ],
  lighting: ["elec.downlight", "light.pendant"],
  electrical_points: ["elec.point"],
  hvac: [
    "hvac.ducted_replace",
    "hvac.office_split",
    "hvac.fcu_service",
    "plumb.water_heater",
  ],
};

/** Human label per item_key, for the picker headings. */
export const ITEM_KEY_LABEL: Record<string, string> = {
  "san.wc": "WC suite",
  "san.basin": "Basin mixer",
  "san.shower": "Shower system",
  "san.shattaf": "Shattaf",
  "san.paper_holder": "Paper holder",
  "san.towel_rail": "Towel rail",
  "san.actuator": "WC actuator plate",
  "elec.downlight": "LED downlights",
  "light.pendant": "Decorative pendants",
  "elec.point": "Sockets & switches",
  "hvac.ducted_replace": "Ducted AC replacement",
  "hvac.office_split": "Split AC unit",
  "hvac.fcu_service": "FCU service",
  "plumb.water_heater": "Water heater",
};

export function categoryForItemKey(itemKey: string): AccessoryCategory | null {
  for (const c of ACCESSORY_CATEGORIES) {
    if (CATEGORY_ITEM_KEYS[c].includes(itemKey)) return c;
  }
  return null;
}

export function isAccessoryCategory(x: unknown): x is AccessoryCategory {
  return typeof x === "string" && (ACCESSORY_CATEGORIES as readonly string[]).includes(x);
}

export function isSpecClass(x: unknown): x is SpecClass {
  return typeof x === "string" && (SPEC_CLASSES as readonly string[]).includes(x);
}

// --- Technical attributes ----------------------------------------------------
//
// A closed vocabulary so the compare view can align rows across items. Every
// field is OPTIONAL and a missing one renders as "—". Nothing here is ever
// inferred: an attribute is present only when a real source carried it.

export interface AccessoryAttributes {
  /** e.g. "1.5 Ton / 18,000 BTU" */
  capacity?: string;
  /** e.g. "Inverter", "Non-inverter", "13A" */
  efficiency?: string;
  /** e.g. "5-year compressor" */
  warranty?: string;
  /** e.g. "UAE", "Germany" */
  origin?: string;
  /** e.g. "R410A" */
  refrigerant?: string;
  /** e.g. "Matt black", "Chrome" */
  finish?: string;
  /** e.g. "Wall-hung", "Concealed", "Exposed" */
  mounting?: string;
  /** e.g. "Vitreous china", "Aluminium" */
  material?: string;
  /** e.g. "38 cm" */
  dimensions?: string;
  /** Supplier lead time in days. */
  lead_time_days?: number;
  /** ISO date the price was last checked. */
  last_verified?: string;
}

/** Display order + labels for the compare table. Attributes first, price last. */
export const ATTRIBUTE_ROWS: { key: keyof AccessoryAttributes; label: string }[] = [
  { key: "capacity", label: "Capacity" },
  { key: "efficiency", label: "Efficiency" },
  { key: "mounting", label: "Mounting" },
  { key: "finish", label: "Finish" },
  { key: "material", label: "Material" },
  { key: "dimensions", label: "Dimensions" },
  { key: "refrigerant", label: "Refrigerant" },
  { key: "warranty", label: "Warranty" },
  { key: "origin", label: "Origin" },
  { key: "lead_time_days", label: "Lead time" },
  { key: "last_verified", label: "Price checked" },
];

export interface AccessoryItem {
  id: string;
  category: AccessoryCategory;
  item_key: string;
  spec_class: SpecClass;
  name: string;
  brand: string | null;
  model_code: string | null;
  rate_aed: number;
  unit: string;
  scope: Scope;
  provenance: "seed" | "indicative" | "actual_transaction";
  source: string | null;
  rate_book_item_key: string | null;
  qs_validated: boolean;
  attributes: AccessoryAttributes;
  is_rule_default: boolean;
  sort_order: number;
}

/** project item_key → chosen catalog item id. */
export type AccessorySelections = Record<string, string>;

/**
 * Format one attribute for display. A missing value is ALWAYS "—" — never a
 * guess, never a blank that could read as zero.
 */
export function formatAttribute(
  attrs: AccessoryAttributes,
  key: keyof AccessoryAttributes,
): string {
  const v = attrs[key];
  if (v === undefined || v === null || v === "") return "—";
  if (key === "lead_time_days") return `${v} days`;
  return String(v);
}

/** Attribute rows worth showing for a comparison set — drops all-empty rows. */
export function comparableRows(
  items: AccessoryItem[],
): { key: keyof AccessoryAttributes; label: string }[] {
  return ATTRIBUTE_ROWS.filter((r) =>
    items.some((i) => {
      const v = i.attributes[r.key];
      return v !== undefined && v !== null && v !== "";
    }),
  );
}

/**
 * The S-pack invariant, applied to a selection set.
 *
 * The engine emits exactly one line per item_key, so a `supply_and_install`
 * accessory cannot spawn a second install line by construction. What we DO have
 * to guard is the inverse: a `supply_only` accessory would leave its install
 * cost unpriced, silently understating the line. Both are reported here so the
 * picker and the tests can assert on them rather than trusting the DB CHECK
 * alone.
 */
export interface ScopeIssue {
  item_key: string;
  name: string;
  kind: "install_only_forbidden" | "supply_only_uninstalled";
  detail: string;
}

export function checkSelectionScope(items: AccessoryItem[]): ScopeIssue[] {
  const issues: ScopeIssue[] = [];
  for (const i of items) {
    if (i.scope === "install_only") {
      issues.push({
        item_key: i.item_key,
        name: i.name,
        kind: "install_only_forbidden",
        detail:
          "An install_only accessory has no supply line to pair with — it would double-count against the labour section.",
      });
    } else if (i.scope === "supply_only") {
      issues.push({
        item_key: i.item_key,
        name: i.name,
        kind: "supply_only_uninstalled",
        detail:
          "A supply_only accessory leaves its installation unpriced on a one-line-per-item engine; price it supply_and_install or add an install rule.",
      });
    }
  }
  return issues;
}

/** Delta a selection makes against the rule default, per line. */
export interface SelectionDelta {
  item_key: string;
  quantity: number;
  default_rate_aed: number;
  selected_rate_aed: number;
  /** (selected − default) × quantity, rounded the way the engine rounds. */
  delta_aed: number;
}

/**
 * Predicted BoQ movement for a set of selections. Quantities come from the
 * take-off and are never altered here — this only re-prices.
 */
export function selectionDeltas(
  quantities: Record<string, number>,
  defaults: Record<string, number>,
  chosen: { item_key: string; rate_aed: number }[],
): { lines: SelectionDelta[]; total_delta_aed: number } {
  const lines: SelectionDelta[] = [];
  for (const c of chosen) {
    const qty = quantities[c.item_key];
    const def = defaults[c.item_key];
    if (qty === undefined || def === undefined) continue;
    const delta = Math.round(qty * c.rate_aed) - Math.round(qty * def);
    lines.push({
      item_key: c.item_key,
      quantity: qty,
      default_rate_aed: def,
      selected_rate_aed: c.rate_aed,
      delta_aed: delta,
    });
  }
  return {
    lines,
    total_delta_aed: lines.reduce((s, l) => s + l.delta_aed, 0),
  };
}
