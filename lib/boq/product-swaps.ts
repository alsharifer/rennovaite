// =============================================================================
// lib/boq/product-swaps.ts — "Choose a cheaper product" on a BoQ line
// (bathroom pilot B7 5). Pure.
//
// The what-if panel grades SURFACES (floor, wall tiling, ceiling, paint,
// plaster — lib/whatif/grades.ts); it cannot express a fixed glass panel for a
// hinged enclosure, a ready-made vanity for a made-to-measure one, mid-range
// fittings, bagged waste or a plain niche. Those are different PRODUCTS, each
// priced by its own rule (R-66…R-74 and the base rules they replace), chosen
// per wet room in rooms.spec.wet_room (WetRoomChoices, lib/boq/wet-room.ts).
//
// Here: which product group a BoQ line belongs to, which option it is now and
// what else it could be. Choosing one writes the room's choice and regenerates
// — a new revision whose cause reads "Product changed by <name>". "Add a price"
// stays rate-only (K11).
// =============================================================================

import { RATE_RULES } from "./rules";
import type { WetRoomChoices } from "./wet-room";

export type ProductField = keyof Omit<WetRoomChoices, never>;

export interface ProductOption {
  value: string | boolean;
  label: string;
  /** The BoQ lines this option produces — item keys, or rule ids where a line has none. */
  lines: readonly string[];
  /** Its rule's allowance where it has one (AED, per the line's unit); null = a market rate. */
  rate_aed: number | null;
  unit: string;
}

export interface ProductGroup {
  field: ProductField;
  label: string;
  options: readonly ProductOption[];
}

const allowance = (key: string): number | null => {
  const r = (RATE_RULES as Record<string, { allowance_aed?: number } | undefined>)[key];
  return typeof r?.allowance_aed === "number" ? r.allowance_aed : null;
};

export const PRODUCT_GROUPS: readonly ProductGroup[] = [
  {
    field: "shower_screen",
    label: "Shower glass",
    options: [
      { value: "enclosure", label: "Frameless enclosure — panels with a hinged door", lines: ["S6-06"], rate_aed: 2200, unit: "per panel" },
      { value: "fixed_panel", label: "One fixed walk-in panel", lines: ["alum.shower_panel_fixed"], rate_aed: allowance("alum.shower_panel_fixed"), unit: "no" },
    ],
  },
  {
    field: "shower_valve",
    label: "Shower valve",
    options: [
      { value: "thermostatic", label: "Thermostatic concealed valve, rain head + hand shower", lines: ["san.shower"], rate_aed: null, unit: "no" },
      { value: "manual", label: "Manual concealed mixer, rain head + hand shower", lines: ["san.shower_manual"], rate_aed: allowance("san.shower_manual"), unit: "no" },
    ],
  },
  {
    field: "vanity",
    label: "Vanity",
    options: [
      { value: "floating_stone", label: "Made-to-measure floating vanity with a stone top", lines: ["GT/joinery/vanity", "S6-05"], rate_aed: null, unit: "item" },
      { value: "ready_made", label: "Ready-made wall-hung vanity with its own ceramic basin", lines: ["joinery.vanity_ready"], rate_aed: allowance("joinery.vanity_ready"), unit: "no" },
    ],
  },
  {
    field: "fittings",
    label: "Fittings grade — WC, basin mixer, mirror",
    options: [
      { value: "premium", label: "Rimless WC, basin with mixer, backlit demister mirror", lines: ["san.wc_floor", "san.basin", "alum.mirror_backlit"], rate_aed: null, unit: "set" },
      { value: "mid", label: "Mid-range WC, basin mixer and LED mirror", lines: ["san.wc_floor_mid", "san.basin_mixer_mid", "alum.mirror_led_mid"], rate_aed: null, unit: "set" },
    ],
  },
  {
    field: "waste",
    label: "Waste removal",
    options: [
      { value: "skip", label: "A skip", lines: ["prelim.skips"], rate_aed: null, unit: "no" },
      { value: "bagged", label: "Bagged and carried out by hand", lines: ["prelim.waste_bagged"], rate_aed: allowance("prelim.waste_bagged"), unit: "project" },
    ],
  },
  {
    field: "niche_led",
    label: "Shower niche",
    options: [
      { value: true, label: "Niche with an LED strip", lines: ["wall.shower_niche"], rate_aed: allowance("wall.shower_niche"), unit: "no" },
      { value: false, label: "Plain niche", lines: ["wall.shower_niche_plain"], rate_aed: allowance("wall.shower_niche_plain"), unit: "no" },
    ],
  },
];

/** A line's identity for the groups: its item key, else its rule id without the R-xx suffix. */
export function lineProductKey(line: { item_key?: string | null; rule_id?: string | null }): string {
  if (line.item_key) return line.item_key;
  const r = line.rule_id ?? "";
  return r.startsWith("GT/") ? r : r.split("/")[0]!;
}

/** The product group a BoQ line belongs to and the option it is, or null. */
export function productGroupOf(line: { item_key?: string | null; rule_id?: string | null }): { group: ProductGroup; current: ProductOption } | null {
  const key = lineProductKey(line);
  for (const group of PRODUCT_GROUPS) {
    const current = group.options.find((o) => o.lines.includes(key));
    if (current) return { group, current };
  }
  return null;
}

/** Every line key a group touches — what its revision cause names. */
export function groupLineKeys(group: ProductGroup): string[] {
  return [...new Set(group.options.flatMap((o) => o.lines))];
}

export function isProductValue(field: string, value: unknown): field is ProductField {
  const g = PRODUCT_GROUPS.find((x) => x.field === field);
  return !!g && g.options.some((o) => o.value === value);
}

/** "Product changed by <name> — Shower glass: hinged enclosure → one fixed walk-in panel". */
export function productChangeSummary(byName: string | null, group: string, from: string, to: string): string {
  return `Product changed by ${byName ?? "a member"} — ${group}: ${from.charAt(0).toLowerCase()}${from.slice(1)} → ${to.charAt(0).toLowerCase()}${to.slice(1)}`;
}
