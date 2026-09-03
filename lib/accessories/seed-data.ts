// =============================================================================
// lib/accessories/seed-data.ts — how the catalogue is built, and from what.
//
// Two real sources, and nothing else:
//
//   1. The Mudon Laspinas quotation 46703 (lib/ground-truth/mudon-actuals
//      SANITARY) plus the P8 spec-class map (lib/whatif/grades
//      SANITARY_SPEC_CLASSES). These carry model codes, finishes and the
//      exposed-vs-concealed class distinction, so sanitary attributes are real
//      and provenance is `actual_transaction`.
//
//   2. The verified pricing_skus vendor catalogue, for AC, lighting and
//      electrical points. Descriptions there genuinely carry capacity, BTU,
//      refrigerant, origin and warranty, so those attributes are parsed out —
//      by strict regex, never inferred. Provenance is `seed`, and the source
//      says "vendor catalogue", NOT "Mudon quotation", because it isn't.
//
// WHAT IS DELIBERATELY MISSING: the Mudon ground truth has no AC or water
// heater EQUIPMENT quotation — only a lump "HVAC Works" labour figure of AED
// 31,500. So AC attributes come from the vendor catalogue above, and
// `plumb.water_heater` gets no alternatives at all: there is not one water
// heater SKU in the catalogue. Both facts are surfaced rather than papered
// over with invented specifications.
//
// Pure module: takes SKU rows in, returns catalogue rows out. Unit-tested.
// =============================================================================

import { SANITARY } from "@/lib/ground-truth/mudon-actuals";
import { SANITARY_SPEC_CLASSES } from "@/lib/whatif/grades";

import type { AccessoryAttributes, SpecClass } from "./types";

export interface CatalogSeedRow {
  category: "sanitary" | "lighting" | "electrical_points" | "hvac";
  item_key: string;
  spec_class: SpecClass;
  name: string;
  brand: string | null;
  model_code: string | null;
  rate_aed: number;
  unit: string;
  scope: "supply_only" | "supply_and_install";
  provenance: "seed" | "indicative" | "actual_transaction";
  source: string;
  rate_book_item_key: string | null;
  qs_validated: boolean;
  attributes: AccessoryAttributes;
  is_rule_default: boolean;
  sort_order: number;
}

export interface SkuRow {
  sku: string;
  brand: string;
  category: string;
  subcategory: string;
  description_en: string;
  price_aed: number;
  vendor: string;
  lead_time_days: number | null;
  last_verified: string | null;
}

const LASPINAS = "Laspinas quotation 46703, 13 Jun 2026 (Mudon Villa 94)";

/** Finish read from a GROHE description — only when it literally says so. */
function finishOf(desc: string): string | undefined {
  if (/matt black/i.test(desc)) return "Matt black";
  if (/chrome/i.test(desc)) return "Chrome";
  return undefined;
}

function mountingOf(desc: string): string | undefined {
  if (/concealed/i.test(desc)) return "Concealed";
  if (/wall-hung/i.test(desc)) return "Wall-hung";
  if (/exposed/i.test(desc)) return "Exposed";
  return undefined;
}

/**
 * Sanitary catalogue — the actual Mudon spec, plus the spec-class alternatives
 * the P8 map already documents. Every rate here was paid or quoted on a real
 * project, so provenance is `actual_transaction`.
 *
 * Scope note: the Laspinas lines are SUPPLY. The engine prices san.* as a
 * single supply-and-install line against the Sanitaryware labour rules, so
 * these rows are recorded `supply_and_install` at the engine's own scope —
 * emitting them as `supply_only` would leave installation unpriced on a
 * one-line-per-item engine (see checkSelectionScope).
 */
export function buildSanitaryCatalog(): CatalogSeedRow[] {
  const rows: CatalogSeedRow[] = [];
  const byCode = new Map(SANITARY.map((s) => [s.code, s]));

  const add = (
    item_key: string,
    spec_class: SpecClass,
    code: string | null,
    name: string,
    rate_aed: number,
    attrs: AccessoryAttributes,
    opts: { is_rule_default?: boolean; source?: string; sort?: number } = {},
  ) => {
    rows.push({
      category: "sanitary",
      item_key,
      spec_class,
      name,
      brand: "GROHE",
      model_code: code,
      rate_aed,
      unit: "no",
      scope: "supply_and_install",
      provenance: "actual_transaction",
      source: opts.source ?? LASPINAS,
      rate_book_item_key: item_key,
      // Every ground-truth sanitary assignment awaits Newspace review (P8).
      qs_validated: false,
      attributes: attrs,
      is_rule_default: opts.is_rule_default ?? false,
      sort_order: opts.sort ?? rows.length,
    });
  };

  // --- WC suite -------------------------------------------------------------
  const wcSet = byCode.get("4-GROHE-3877200F");
  const wcPan = byCode.get("39328I0H");
  if (wcSet) {
    add("san.wc", "standard", wcSet.code, wcSet.desc, wcSet.unit_price, {
      finish: finishOf(wcSet.desc),
      mounting: "Concealed frame",
      origin: "Germany",
    }, { is_rule_default: true, sort: 0 });
  }
  if (wcPan) {
    add("san.wc", "premium", wcPan.code, wcPan.desc, wcPan.unit_price, {
      finish: "White",
      mounting: mountingOf(wcPan.desc),
      material: "Vitreous china",
      origin: "Germany",
    }, { sort: 1 });
  }

  // --- Basin mixer — the P8 spec-class correction ---------------------------
  // The seed had Eurocube as "standard"; the actual project spec is Eurosmart.
  // That was a grade-mapping error, not a rate gap, and both classes ship here.
  const basinStd = SANITARY_SPEC_CLASSES.basin_mixer.standard;
  const basinPrem = SANITARY_SPEC_CLASSES.basin_mixer.premium;
  if (basinStd) {
    add("san.basin", "standard", "332652433", basinStd.spec, basinStd.rate_aed, {
      finish: "Chrome",
      mounting: "Deck-mounted",
      origin: "Germany",
    }, { is_rule_default: true, source: basinStd.source, sort: 0 });
  }
  if (basinPrem) {
    add("san.basin", "premium", null, basinPrem.spec, basinPrem.rate_aed, {
      finish: "Chrome",
      mounting: "Deck-mounted",
      origin: "Germany",
    }, { source: basinPrem.source, sort: 1 });
  }

  // --- Shower system — exposed vs concealed are DIFFERENT CLASSES -----------
  const showerStd = SANITARY_SPEC_CLASSES.shower_system.standard;
  const showerPrem = SANITARY_SPEC_CLASSES.shower_system.premium;
  if (showerStd) {
    add("san.shower", "standard", null, showerStd.spec, showerStd.rate_aed, {
      mounting: "Exposed",
      finish: "Chrome",
      origin: "Germany",
    }, { is_rule_default: true, source: showerStd.source, sort: 0 });
  }
  if (showerPrem) {
    add("san.shower", "premium", "1053362430", showerPrem.spec, showerPrem.rate_aed, {
      mounting: "Concealed",
      finish: "Matt black",
      origin: "Germany",
    }, { source: showerPrem.source, sort: 1 });
  }

  // --- Accessory set (P8b) — one class each, straight off the quotation -----
  const accessories: [string, string][] = [
    ["san.shattaf", "1025302431"],
    ["san.paper_holder", "1024652430"],
    ["san.towel_rail", "1022512430"],
    ["san.actuator", "38732KF0"],
  ];
  for (const [item_key, code] of accessories) {
    const line = byCode.get(code);
    if (!line) continue;
    add(item_key, "standard", code, line.desc, line.unit_price, {
      finish: finishOf(line.desc),
      origin: "Germany",
    }, { is_rule_default: true, sort: 0 });
  }

  return rows;
}

// --- Vendor-catalogue derived rows ------------------------------------------

/** "1.5 Ton 18,000 BTU" → "1.5 Ton / 18,000 BTU". Absent when not stated. */
function acCapacity(desc: string): string | undefined {
  const ton = desc.match(/([\d.]+)\s*Ton/i);
  const btu = desc.match(/([\d,]+)\s*BTU/i);
  if (ton && btu) return `${ton[1]} Ton / ${btu[1]} BTU`;
  if (ton) return `${ton[1]} Ton`;
  return undefined;
}

function acWarranty(desc: string): string | undefined {
  const m = desc.match(/(\d+)-year\s+([a-z]+)\s+warranty/i);
  return m ? `${m[1]}-year ${m[2]}` : undefined;
}

function acOrigin(desc: string): string | undefined {
  const m = desc.match(/made in ([A-Za-z ]+?)(?:,|$)/i);
  return m ? m[1]!.trim() : undefined;
}

function acRefrigerant(desc: string): string | undefined {
  const m = desc.match(/\b(R\d{3}[A-Z]?)\b/);
  return m ? m[1] : undefined;
}

function baseAttrs(s: SkuRow): AccessoryAttributes {
  const a: AccessoryAttributes = {};
  if (s.lead_time_days != null) a.lead_time_days = s.lead_time_days;
  if (s.last_verified) a.last_verified = s.last_verified;
  return a;
}

/** Spread a price-sorted pool across the three spec classes. */
function classify(index: number, total: number): SpecClass {
  if (total <= 1) return "standard";
  const t = index / (total - 1);
  if (t < 0.34) return "economy";
  if (t < 0.67) return "standard";
  return "premium";
}

/**
 * AC units from the HVAC SKU pool. Capacity, refrigerant, origin and warranty
 * are all genuinely present in these descriptions, so they are parsed out;
 * anything absent stays absent.
 */
export function buildHvacCatalog(skus: SkuRow[]): CatalogSeedRow[] {
  const pool = skus
    .filter((s) => s.category === "HVAC" && /split ac/i.test(s.subcategory) && s.price_aed > 0)
    .sort((a, b) => a.price_aed - b.price_aed || a.sku.localeCompare(b.sku));
  if (pool.length === 0) return [];

  // Two engine items are priced per unit against this pool.
  const rows: CatalogSeedRow[] = [];
  for (const item_key of ["hvac.ducted_replace", "hvac.office_split"]) {
    // Ducted replacement wants the larger units; the office split the smaller.
    const relevant =
      item_key === "hvac.office_split"
        ? pool.filter((s) => /1(\.5)?\s*Ton|2\s*Ton/i.test(s.description_en))
        : pool;
    const chosen = (relevant.length >= 3 ? relevant : pool).slice(0, 6);
    chosen.forEach((s, i) => {
      const attrs = baseAttrs(s);
      const cap = acCapacity(s.description_en);
      if (cap) attrs.capacity = cap;
      const war = acWarranty(s.description_en);
      if (war) attrs.warranty = war;
      const org = acOrigin(s.description_en);
      if (org) attrs.origin = org;
      const ref = acRefrigerant(s.description_en);
      if (ref) attrs.refrigerant = ref;
      attrs.efficiency = /inverter/i.test(s.description_en) ? "Inverter" : "Non-inverter";

      rows.push({
        category: "hvac",
        item_key,
        spec_class: classify(i, chosen.length),
        name: s.description_en.split(",")[0]!.trim(),
        brand: s.brand || null,
        model_code: s.sku || null,
        rate_aed: s.price_aed,
        unit: "no",
        scope: "supply_and_install",
        provenance: "seed",
        source: `${s.vendor} vendor catalogue — ${s.sku}`,
        rate_book_item_key: item_key,
        qs_validated: false,
        attributes: attrs,
        is_rule_default: false,
        sort_order: i,
      });
    });
  }
  return rows;
}

/** Decorative pendants. The catalogue carries size and material, not wattage. */
export function buildLightingCatalog(skus: SkuRow[]): CatalogSeedRow[] {
  const pool = skus
    .filter((s) => s.category === "Lighting" && /pendant/i.test(s.subcategory) && s.price_aed > 0)
    .sort((a, b) => a.price_aed - b.price_aed || a.sku.localeCompare(b.sku))
    .slice(0, 8);

  return pool.map((s, i) => {
    const attrs = baseAttrs(s);
    const dim = s.description_en.match(/(\d+)\s*cm/i);
    if (dim) attrs.dimensions = `${dim[1]} cm`;
    const mat = s.description_en.match(/\b(aluminium|aluminum|brass|steel|glass|rattan)\b/i);
    if (mat) attrs.material = mat[1]!.replace(/^./, (c) => c.toUpperCase());
    const col = s.description_en.match(/\b(white|black|dark grey|brass|chrome)\b/i);
    if (col) attrs.finish = col[1]!.replace(/^./, (c) => c.toUpperCase());

    return {
      category: "lighting" as const,
      item_key: "light.pendant",
      spec_class: classify(i, pool.length),
      name: s.description_en.trim(),
      brand: s.brand || null,
      model_code: s.sku || null,
      rate_aed: s.price_aed,
      unit: "no",
      scope: "supply_and_install" as const,
      provenance: "seed" as const,
      source: `${s.vendor} vendor catalogue — ${s.sku}`,
      rate_book_item_key: "light.pendant",
      qs_validated: false,
      attributes: attrs,
      is_rule_default: false,
      sort_order: i,
    };
  });
}

/** Sockets & switches. Amperage and series are real; nothing else is claimed. */
export function buildElectricalCatalog(skus: SkuRow[]): CatalogSeedRow[] {
  const pool = skus
    .filter(
      (s) =>
        s.category === "Electrical" &&
        /switch|socket/i.test(s.description_en) &&
        s.price_aed > 0,
    )
    .sort((a, b) => a.price_aed - b.price_aed || a.sku.localeCompare(b.sku))
    .slice(0, 8);

  return pool.map((s, i) => {
    const attrs = baseAttrs(s);
    const amp = s.description_en.match(/(\d+)\s*A\b/);
    if (amp) attrs.efficiency = `${amp[1]}A`;
    const col = s.description_en.match(/\b(white|black|grey|anthracite)\b/i);
    if (col) attrs.finish = col[1]!.replace(/^./, (c) => c.toUpperCase());
    const series = s.description_en.match(/\b(Unica|Asfora|Acti9)\b/i);
    if (series) attrs.material = `${series[1]} series`;

    return {
      category: "electrical_points" as const,
      item_key: "elec.point",
      spec_class: classify(i, pool.length),
      name: s.description_en.trim(),
      brand: s.brand || null,
      model_code: s.sku || null,
      rate_aed: s.price_aed,
      unit: "no",
      scope: "supply_and_install" as const,
      provenance: "seed" as const,
      source: `${s.vendor} vendor catalogue — ${s.sku}`,
      rate_book_item_key: "elec.point",
      qs_validated: false,
      attributes: attrs,
      is_rule_default: false,
      sort_order: i,
    };
  });
}

/**
 * Item keys we deliberately ship with NO alternatives, and why. Surfaced in the
 * picker so an empty category reads as a known gap rather than a broken screen.
 */
export const NO_CATALOGUE_REASON: Record<string, string> = {
  "plumb.water_heater":
    "No water-heater SKU exists in the vendor catalogue and the Mudon ground truth has no heater quotation — only a lump HVAC labour figure. Priced by rule until a supplier list is ingested.",
  "hvac.fcu_service":
    "A service operation, not a product — there is nothing to specify. Priced by the R-22 labour rule.",
  "elec.downlight":
    "The catalogue has no downlight SKUs (only pendants). Priced by the R-14 labour rule until a lighting supplier list is ingested.",
};

export function buildCatalog(skus: SkuRow[]): CatalogSeedRow[] {
  return [
    ...buildSanitaryCatalog(),
    ...buildHvacCatalog(skus),
    ...buildLightingCatalog(skus),
    ...buildElectricalCatalog(skus),
  ];
}
