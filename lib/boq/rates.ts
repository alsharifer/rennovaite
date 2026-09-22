// =============================================================================
// lib/boq/rates.ts — deterministic rate resolution.
//
// Labour: exact (work_section, description) match against labour_rates, band
// column chosen by tier (T-02). Material: SKU pool filtered by category /
// subcategory, sorted by price, picked at the tier percentile (T-03).
// If a labour row is missing the engine THROWS — a silent fallback would make
// the output non-reproducible. If a SKU pool is empty, the rule's allowance
// applies (flagged as such on the line, so the QS sees it).
//
// L1 — the resolution order (documented in full in lib/rates/tiers.ts):
//   1 firm_private → 2 firm_correction → 3 reference (actual_transaction) →
//   4 catalog / allowance / labour_book (the R-xx rules below) → 5 indicative.
// The firm overlay and the reference book are consulted in resolveBase, at the
// SAME layer the D1 accessory selection is applied on top of. Every resolved
// rate carries `rate_tier` saying which tier answered, and its
// `vendor_or_source` for tiers 1–3 and 5 is a constant label — never a
// rate_book.source string (those name suppliers and contractors).
// =============================================================================

import type { FirmOverlay, FirmRateEntry } from "@/lib/rates/firm";
import {
  indexReference,
  lookupCalibrated,
  lookupIndicative,
  type RateGrade,
  type ReferenceIndex,
  type ReferenceRateRow,
} from "@/lib/rates/reference";
import {
  FIRM_CORRECTION_LABEL,
  FIRM_RATE_LABEL,
  INDICATIVE_LABEL,
  INTERIOR_REFERENCE_LABEL,
  type RateTier,
} from "@/lib/rates/tiers";

import { RATE_RULES, TIER_LABOUR_BAND, TIER_SKU_PERCENTILE, type RateRule } from "./rules";
import type { LabourRate, PricingSku, Tier } from "./schema";

/** Engine tier → rate-book grade. */
export const TIER_GRADE: Record<Tier, RateGrade> = { value: "economy", mid: "standard", premium: "premium" };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export type ResolvedRate = {
  rate_aed: number;
  vendor_or_source: string;
  kind: "labour" | "material" | "supply_and_install" | "lump" | "allowance";
  rate_band: "low" | "mid" | "high" | "sku" | "allowance" | "book";
  /** L1: which tier of the resolution order answered. */
  rate_tier: RateTier;
  wastage: number;
  notes: string | null;
  /** D1: a selection that could not be applied without deleting install cost. */
  accessory_undecomposable?: boolean;
};

/**
 * D1: a user-chosen accessory that replaces the rule-derived rate for one
 * item_key. It substitutes the RATE and its provenance only — never the
 * quantity, which stays the take-off's business. The user picks WHAT; the
 * engine keeps computing HOW MANY.
 */
export type AccessoryOverride = {
  catalog_item_id: string;
  name: string;
  /** The item's own price. For every catalogue row this is a SUPPLY price. */
  rate_aed: number;
  scope: "supply_only" | "install_only" | "supply_and_install";
  source: string | null;
  spec_class: string;
  qs_validated: boolean;
  /**
   * Supply price of the item the rule default already assumed, when the
   * catalogue knows it (the `is_rule_default` row for this item_key). This is
   * what makes an honest substitution possible — see `applyAccessory`.
   */
  default_supply_aed: number | null;
};

/**
 * Combine a rule-derived rate with a chosen accessory.
 *
 * The subtlety that makes this necessary: catalogue rates are SUPPLY prices
 * (a GROHE mixer at AED 400), while the rule defaults are whatever
 * labour_rates says — sometimes supply-and-install (a fitted basin at AED
 * 4,500), sometimes installation labour only (a pendant hung for AED 500),
 * sometimes an allowance that is itself a supply price. Substituting a supply
 * price for a supply-and-install rate silently deletes the installation cost:
 * picking a PREMIUM spec would make the BoQ cheaper, which is nonsense.
 *
 * So the adjustment depends on what the default actually contains:
 *
 *   supply_and_install  → keep the rule's installation component and move only
 *                         the specification: default + (chosen − default_supply).
 *                         Both sides are supply prices from the same source, so
 *                         the difference is a pure spec delta. Without a known
 *                         default supply price we CANNOT decompose the rate, so
 *                         the line is left at the rule rate and flagged for the
 *                         QS rather than guessed at.
 *   labour              → the rate is installation only, so the fixture's
 *                         supply price is genuinely additive: default + chosen.
 *   allowance/material  → the default is itself a supply price from the same
 *                         catalogue, so it is a like-for-like swap: chosen.
 */
export function applyAccessory(
  base: ResolvedRate,
  chosen: AccessoryOverride,
): ResolvedRate {
  let rate: number;
  let basis: string;
  let undecomposable = false;

  // A KNOWN default supply price is the strongest signal available: it means
  // the catalogue can name the product the rule already assumed, so the honest
  // move is always to shift by the specification delta and leave whatever else
  // the rule rate contains untouched. This takes precedence over `kind`, which
  // is only a regex over a free-text labour_rates description and mis-reads
  // some rows (san.shower's "mixer, handset, rain head" scans as labour-only
  // even though it plainly describes the product).
  if (chosen.default_supply_aed != null) {
    rate = base.rate_aed + (chosen.rate_aed - chosen.default_supply_aed);
    basis = `${base.rate_aed} rule rate + (${chosen.rate_aed} − ${chosen.default_supply_aed} spec delta); the rest of the rule rate is preserved`;
  } else if (base.kind === "supply_and_install") {
    rate = base.rate_aed;
    basis = `rule rate kept: the default's supply component is unknown, so the ${chosen.rate_aed} supply price cannot be substituted without deleting installation — QS to re-price`;
    undecomposable = true;
  } else if (base.kind === "labour" || base.kind === "lump") {
    rate = base.rate_aed + chosen.rate_aed;
    basis = `${base.rate_aed} installation labour + ${chosen.rate_aed} supply`;
  } else {
    rate = chosen.rate_aed;
    basis = `like-for-like supply swap (default ${base.rate_aed} is itself a supply price)`;
  }

  return {
    rate_aed: Math.round(rate * 100) / 100,
    vendor_or_source: chosen.source ?? `accessory: ${chosen.name}`,
    // Scope is unchanged by a selection: the engine still emits exactly ONE
    // line per item_key, so no separate install line can appear.
    kind: base.kind,
    rate_band: "sku",
    wastage: base.wastage,
    notes: `D1/accessory/${chosen.catalog_item_id}: ${chosen.name} (${chosen.spec_class}) — ${basis}${chosen.qs_validated ? "" : "; rate not QS-validated"}`,
    accessory_undecomposable: undecomposable,
    rate_tier: "selection",
  };
}

const FIRM_KIND: Record<FirmRateEntry["kind"], ResolvedRate["kind"]> = {
  labour: "labour",
  supply: "material",
  supply_and_install: "supply_and_install",
  lump: "lump",
};

/** Books behind the R-xx rules (L1). Both absent = the pre-L1 resolver, exactly. */
export interface ResolverBooks {
  reference?: readonly ReferenceRateRow[];
  firm?: FirmOverlay;
}

export class RateResolver {
  private labourIndex = new Map<string, LabourRate>();

  private reference: ReferenceIndex | null;
  private firm: FirmOverlay | null;

  constructor(
    labourRates: LabourRate[],
    private skus: PricingSku[],
    private tier: Tier,
    /** item_key → chosen accessory. Absent key = the R-xx rule applies. */
    private accessories: Record<string, AccessoryOverride> = {},
    books: ResolverBooks = {},
  ) {
    for (const r of labourRates) {
      this.labourIndex.set(`${norm(r.work_section)}|${norm(r.description)}`, r);
    }
    this.reference = books.reference ? indexReference(books.reference) : null;
    this.firm = books.firm ?? null;
  }

  /** The rate this item_key would take with no user selection — the default. */
  resolveDefault(itemKey: string, unit: string): ResolvedRate {
    return this.resolveBase(itemKey, unit);
  }

  resolve(itemKey: string, unit: string): ResolvedRate {
    const base = this.resolveBase(itemKey, unit);
    const chosen = this.accessories[itemKey];
    return chosen ? applyAccessory(base, chosen) : base;
  }

  /** Tiers 1–5, first answer wins. See the header and lib/rates/tiers.ts. */
  private resolveBase(itemKey: string, unit: string): ResolvedRate {
    const rule = RATE_RULES[itemKey];
    if (!rule) {
      throw new Error(`No rate rule for item_key "${itemKey}".`);
    }
    const grade = TIER_GRADE[this.tier];

    // 1–2. The project's firm: its own rate, then its promoted correction.
    const hit = this.firm?.lookup(itemKey, grade, unit);
    if (hit) return this.fromFirm(rule, hit.entry, hit.tier);

    // 3. The calibrated reference book.
    const ref = this.reference ? lookupCalibrated(this.reference, itemKey, grade) : null;
    if (ref) return this.fromBook(rule, ref, unit, "reference");

    // 4. The R-xx rules: catalogue pick, allowance, labour book. 5. Indicative,
    // only when those cannot answer at all (they throw rather than guess).
    try {
      return this.resolveFromRules(itemKey, unit);
    } catch (e) {
      const ind = this.reference ? lookupIndicative(this.reference, itemKey, grade) : null;
      if (ind) return this.fromBook(rule, ind, unit, "indicative");
      throw e;
    }
  }

  private fromFirm(rule: RateRule, e: FirmRateEntry, tier: "firm_private" | "firm_correction"): ResolvedRate {
    return {
      rate_aed: e.rate_aed,
      vendor_or_source: tier === "firm_private" ? FIRM_RATE_LABEL : FIRM_CORRECTION_LABEL,
      kind: FIRM_KIND[e.kind],
      rate_band: "book",
      // Wastage is a property of the MEASUREMENT (how much material a m² of
      // floor consumes), not of whose price it is — it stays the rule's.
      wastage: rule.material?.wastage ?? 0,
      notes: `${rule.rule_id}: ${tier === "firm_private" ? "contractor rate book" : "contractor rate book — promoted correction"} (entry ${e.id}${e.grade ? `, ${e.grade}` : ""})`,
      rate_tier: tier,
    };
  }

  private fromBook(rule: RateRule, row: ReferenceRateRow, unit: string, tier: "reference" | "indicative"): ResolvedRate {
    if (row.unit !== unit) {
      throw new Error(`rate_book unit drift for ${row.item_key}: row says "${row.unit}", the take-off measures "${unit}".`);
    }
    const kind: ResolvedRate["kind"] =
      row.scope === "supply_only"
        ? "material"
        : row.scope === "install_only"
          ? "labour"
          : row.scope === "supply_and_install"
            ? "supply_and_install"
            : rule.material
              ? "material"
              : "labour";
    return {
      rate_aed: row.rate_aed,
      vendor_or_source: tier === "reference" ? INTERIOR_REFERENCE_LABEL : INDICATIVE_LABEL,
      kind,
      rate_band: "book",
      wastage: rule.material?.wastage ?? 0,
      notes: `${rule.rule_id}: ${tier === "reference" ? "calibrated reference" : "indicative"} rate, ${row.grade}, valid from ${row.valid_from}`,
      rate_tier: tier,
    };
  }

  private resolveFromRules(itemKey: string, unit: string): ResolvedRate {
    const rule = RATE_RULES[itemKey];
    if (!rule) {
      throw new Error(`No rate rule for item_key "${itemKey}".`);
    }

    if (rule.material) {
      const m = rule.material;
      let pool = this.skus.filter(
        (s) => norm(s.category) === norm(m.category) && s.price_aed > 0,
      );
      if (m.subcategory_includes && m.subcategory_includes.length > 0) {
        const subs = m.subcategory_includes.map(norm);
        const narrowed = pool.filter((s) =>
          subs.some((sub) => norm(s.subcategory).includes(sub)),
        );
        if (narrowed.length > 0) pool = narrowed;
      }
      if (pool.length > 0) {
        pool.sort(
          (a, b) => a.price_aed - b.price_aed || a.sku.localeCompare(b.sku),
        );
        const idx = Math.min(
          pool.length - 1,
          Math.floor(TIER_SKU_PERCENTILE[this.tier] * (pool.length - 1)),
        );
        const pick = pool[idx]!;
        return {
          rate_aed: pick.price_aed,
          vendor_or_source: `${pick.vendor} — ${pick.sku}`,
          kind: "material",
          rate_band: "sku",
          wastage: m.wastage,
          notes: `${rule.rule_id}: ${pick.description_en.slice(0, 90)} (tier ${this.tier}, pick ${idx + 1}/${pool.length} by price)`,
          rate_tier: "catalog",
        };
      }
      if (rule.allowance_aed != null) {
        return {
          rate_aed: rule.allowance_aed,
          vendor_or_source: "allowance — no seeded SKU",
          kind: "allowance",
          rate_band: "allowance",
          wastage: m.wastage,
          notes: `${rule.rule_id}: ${rule.allowance_note ?? "allowance rate — QS to confirm"}`,
          rate_tier: "allowance",
        };
      }
      throw new Error(
        `Empty SKU pool for "${itemKey}" (category=${m.category}) and no allowance defined.`,
      );
    }

    if (rule.labour) {
      const row = this.labourIndex.get(
        `${norm(rule.labour.work_section)}|${norm(rule.labour.description)}`,
      );
      if (!row) {
        throw new Error(
          `labour_rates row not found for "${itemKey}": [${rule.labour.work_section}] ${rule.labour.description}`,
        );
      }
      const band = TIER_LABOUR_BAND[this.tier];
      const rate =
        band === "low"
          ? row.rate_low_aed
          : band === "high"
            ? row.rate_high_aed
            : row.rate_mid_aed;
      const isSupplyAndInstall = /supply and (install|fit|hang)/i.test(
        row.description,
      );
      const isLump = unit === "project";
      return {
        rate_aed: rate,
        vendor_or_source: `labour_rates: ${row.description}`,
        kind: isLump ? "lump" : isSupplyAndInstall ? "supply_and_install" : "labour",
        rate_band: band,
        wastage: 0,
        notes: `${rule.rule_id}: ${band} band (tier ${this.tier})`,
        rate_tier: "labour_book",
      };
    }

    if (rule.allowance_aed != null) {
      return {
        rate_aed: rule.allowance_aed,
        vendor_or_source: "allowance",
        kind: "allowance",
        rate_band: "allowance",
        wastage: 0,
        notes: `${rule.rule_id}: ${rule.allowance_note ?? "allowance rate — QS to confirm"}`,
        rate_tier: "allowance",
      };
    }

    throw new Error(`Rate rule "${itemKey}" has no labour, material, or allowance.`);
  }
}

// --- Element sections (P4 take-off) -------------------------------------------

/**
 * T3b: the price of a P4 element work item (demolition, wall_plaster,
 * floor_finish, wet_tiling, ceiling_finish, wall_paint — the six sections the
 * element take-off rebuilds when the viewer flag is on).
 *
 * Before T3b those sections priced ONLY from the constants in
 * lib/boq/elements.ts, bypassing this resolver — so a firm's private rates never
 * reached the bulk of an interior BoQ. They now resolve through the SAME firm
 * overlay as every other line (tiers 1–2, `FirmOverlay.lookup`), and fall back
 * to the element constant (tier 4) exactly as before.
 *
 * The reference book (tier 3) is deliberately NOT consulted for these keys: in
 * production `rate_book` holds the what-if grade cells under exactly these item
 * keys (floor_finish, wet_tiling, …), including Mudon's transacted tile rates.
 * They have never priced an element line; consulting them would silently
 * re-price every existing interior BoQ with no firm involved.
 */
export interface ElementRate {
  rate_aed: number;
  vendor_or_source: string;
  rate_tier: "firm_private" | "firm_correction";
}
export type ElementPricer = (workItemKey: string, unit: string) => ElementRate | null;

export function elementPricer(firm: FirmOverlay | null | undefined, tier: Tier): ElementPricer {
  const grade = TIER_GRADE[tier] ?? "standard";
  return (key, unit) => {
    const hit = firm?.lookup(key, grade, unit);
    if (!hit) return null;
    return {
      rate_aed: hit.entry.rate_aed,
      vendor_or_source: hit.tier === "firm_private" ? FIRM_RATE_LABEL : FIRM_CORRECTION_LABEL,
      rate_tier: hit.tier,
    };
  };
}
