// =============================================================================
// lib/accessories/s6-components.ts — catalog rows for the components Newspace's
// scoping left out (S6-pre, Delta Log column G).
//
// Three of the four Step-1 components were ALREADY PRICED by R-xx rules
// (spotlights R-14, sockets R-15, water heaters R-17). What they lacked was a
// CHOICE: no catalog rows existed, so the rule rate could not be overridden by
// spec class and `NO_CATALOG_REASON` recorded the gap in prose instead. These
// rows close that, without adding a single new BoQ line — selecting one swaps
// the rate on a line that already exists.
//
// PROVENANCE IS `indicative` THROUGHOUT. Unlike the sanitary rows, which come
// from the Laspinas 46703 quotation and are genuine `actual_transaction`
// records, nothing here was transacted on Villa 94 — column G exists precisely
// because these were never quoted. Each row carries the reasoning behind its
// rate so a QS can argue with it rather than guess at it.
//
// Rates are Dubai trade-counter mid-2026, cross-checked across at least two
// retail listings per class. They are honest estimates, not prices anybody paid.
// =============================================================================

import type { CatalogSeedRow } from "./seed-data";

type Row = Omit<CatalogSeedRow, "sort_order"> & { sort_order?: number };

const rows: Row[] = [
  // --- G10: ceiling spotlights (rule R-14 already prices the LINE) ----------
  {
    category: "lighting",
    item_key: "elec.downlight",
    spec_class: "economy",
    name: "Surface COB downlight 7W, aluminium, 3000K",
    brand: null,
    model_code: null,
    rate_aed: 145,
    unit: "no",
    scope: "supply_and_install",
    provenance: "indicative",
    source: "G10 — Dubai trade counter, generic 7W COB fitting incl. install labour",
    rate_book_item_key: "elec.downlight",
    qs_validated: false,
    attributes: { wattage: "7W", colour_temp: "3000K", dimmable: "No" },
    is_rule_default: false,
  },
  {
    category: "lighting",
    item_key: "elec.downlight",
    spec_class: "standard",
    name: "Recessed anti-glare COB downlight 10W, 3000K, deep baffle",
    brand: null,
    model_code: null,
    rate_aed: 300,
    unit: "no",
    scope: "supply_and_install",
    provenance: "indicative",
    source:
      "G10 — reproduces the R-14 rule rate of AED 300/no exactly, so the default selection changes no total",
    rate_book_item_key: "elec.downlight",
    qs_validated: false,
    attributes: { wattage: "10W", colour_temp: "3000K", dimmable: "Yes", },
    // Reproduces what R-14 already assumes — selecting it is a no-op on price.
    is_rule_default: true,
  },
  {
    category: "lighting",
    item_key: "elec.downlight",
    spec_class: "premium",
    name: "Trimless plaster-in adjustable spotlight 12W, CRI>95, tuneable",
    brand: null,
    model_code: null,
    rate_aed: 620,
    unit: "no",
    scope: "supply_and_install",
    provenance: "indicative",
    source: "G10 — trimless plaster-in class; requires ceiling cut-out coordination",
    rate_book_item_key: "elec.downlight",
    qs_validated: false,
    attributes: { wattage: "12W", cri: ">95", type: "Trimless plaster-in" },
    is_rule_default: false,
  },

  // --- G10: LED strip — the genuinely new component ------------------------
  {
    category: "lighting",
    item_key: "light.led_strip",
    spec_class: "economy",
    name: "LED strip 12V 9.6W/m, IP20, surface profile",
    brand: null,
    model_code: null,
    rate_aed: 55,
    unit: "lm",
    scope: "supply_and_install",
    provenance: "indicative",
    source: "G10 — 12V strip, driver and surface profile; strip material only",
    rate_book_item_key: "light.led_strip",
    qs_validated: false,
    attributes: { voltage: "12V", output: "9.6W/m", ip_rating: "IP20", type: "Surface profile" },
    is_rule_default: false,
  },
  {
    category: "lighting",
    item_key: "light.led_strip",
    spec_class: "standard",
    name: "COB LED strip 24V 14.4W/m, IP20, recessed cove profile + driver",
    brand: null,
    model_code: null,
    rate_aed: 85,
    unit: "lm",
    scope: "supply_and_install",
    provenance: "indicative",
    source:
      "G10 — reproduces the R-45 rule rate of AED 85/lm. Complements R-31, which prices the cove LABOUR and assumes 'strips client-supplied'",
    rate_book_item_key: "light.led_strip",
    qs_validated: false,
    attributes: { voltage: "24V", output: "14.4W/m", type: "COB (dotless)", ip_rating: "IP20" },
    is_rule_default: true,
  },
  {
    category: "lighting",
    item_key: "light.led_strip",
    spec_class: "premium",
    name: "COB LED strip 24V 19.2W/m, CRI>95, tuneable white, aluminium profile",
    brand: null,
    model_code: null,
    rate_aed: 165,
    unit: "lm",
    scope: "supply_and_install",
    provenance: "indicative",
    source: "G10 — tuneable-white class; needs a compatible driver and control line",
    rate_book_item_key: "light.led_strip",
    qs_validated: false,
    attributes: { voltage: "24V", output: "19.2W/m", cri: ">95", type: "Tuneable white" },
    is_rule_default: false,
  },

  // --- G12: water heaters (rule R-17 already prices the LINE) --------------
  {
    category: "sanitary",
    item_key: "plumb.water_heater",
    spec_class: "economy",
    name: "Electric storage water heater 50L, surface mounted",
    brand: null,
    model_code: null,
    rate_aed: 1250,
    unit: "no",
    scope: "supply_and_install",
    provenance: "indicative",
    source: "G12 — 50L surface unit; cheapest compliant class, no ceiling access needed",
    rate_book_item_key: "plumb.water_heater",
    qs_validated: false,
    attributes: { capacity: "50L", mounting: "Surface", warranty: "2 years" },
    is_rule_default: false,
  },
  {
    category: "sanitary",
    item_key: "plumb.water_heater",
    spec_class: "standard",
    name: "Electric storage water heater 80L, concealed ceiling void",
    brand: null,
    model_code: null,
    rate_aed: 5000,
    unit: "no",
    scope: "supply_and_install",
    provenance: "indicative",
    source:
      "G12 — reproduces the R-17 rule rate of AED 5,000/no exactly (concealed unit incl. access hatch and re-pipe)",
    rate_book_item_key: "plumb.water_heater",
    qs_validated: false,
    attributes: { capacity: "80L", mounting: "Concealed ceiling void", warranty: "5 years" },
    is_rule_default: true,
  },
  {
    category: "sanitary",
    item_key: "plumb.water_heater",
    spec_class: "premium",
    name: "Heat-pump water heater 100L, concealed, high efficiency",
    brand: null,
    model_code: null,
    rate_aed: 8900,
    unit: "no",
    scope: "supply_and_install",
    provenance: "indicative",
    source: "G12 — heat-pump class; different technology, not the same unit at a higher price",
    rate_book_item_key: "plumb.water_heater",
    qs_validated: false,
    attributes: { capacity: "100L", type: "Heat pump", mounting: "Concealed", warranty: "7 years" },
    is_rule_default: false,
  },
];

/**
 * Catalog rows for the S6-pre components.
 *
 * `elec.point` is deliberately absent: T3 already seeded six real Schneider
 * rows for it from the vendor catalogue. What it lacked was a DEFAULT — see
 * `markSocketRuleDefault`.
 */
export function buildS6ComponentCatalog(): CatalogSeedRow[] {
  return rows.map((r, i) => ({ ...r, sort_order: r.sort_order ?? i }));
}

/**
 * G13 is the evidence that sockets must default-populate the BoQ.
 *
 * T3 seeded six `elec.point` rows but marked none `is_rule_default`, so the
 * picker offered choices while the BoQ silently kept the blended R-15 rate and
 * no row was ever presented as the standing assumption. Marking the cheapest
 * `standard` row default makes the assumption explicit and reviewable, and
 * changes no total until somebody selects something else.
 */
export function markSocketRuleDefault(catalog: CatalogSeedRow[]): CatalogSeedRow[] {
  const candidates = catalog
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => row.item_key === "elec.point" && row.spec_class === "standard");
  if (candidates.length === 0) return catalog;
  const pick = candidates.reduce((a, b) => (b.row.rate_aed < a.row.rate_aed ? b : a));
  return catalog.map((row, idx) =>
    idx === pick.idx ? { ...row, is_rule_default: true } : row,
  );
}
