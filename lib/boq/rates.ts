// =============================================================================
// lib/boq/rates.ts — deterministic rate resolution.
//
// Labour: exact (work_section, description) match against labour_rates, band
// column chosen by tier (T-02). Material: SKU pool filtered by category /
// subcategory, sorted by price, picked at the tier percentile (T-03).
// If a labour row is missing the engine THROWS — a silent fallback would make
// the output non-reproducible. If a SKU pool is empty, the rule's allowance
// applies (flagged as such on the line, so the QS sees it).
// =============================================================================

import { RATE_RULES, TIER_LABOUR_BAND, TIER_SKU_PERCENTILE } from "./rules";
import type { LabourRate, PricingSku, Tier } from "./schema";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export type ResolvedRate = {
  rate_aed: number;
  vendor_or_source: string;
  kind: "labour" | "material" | "supply_and_install" | "lump" | "allowance";
  rate_band: "low" | "mid" | "high" | "sku" | "allowance";
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
  };
}

export class RateResolver {
  private labourIndex = new Map<string, LabourRate>();

  constructor(
    labourRates: LabourRate[],
    private skus: PricingSku[],
    private tier: Tier,
    /** item_key → chosen accessory. Absent key = the R-xx rule applies. */
    private accessories: Record<string, AccessoryOverride> = {},
  ) {
    for (const r of labourRates) {
      this.labourIndex.set(`${norm(r.work_section)}|${norm(r.description)}`, r);
    }
  }

  /** The rate this item_key would take with no user selection — the default. */
  resolveDefault(itemKey: string, unit: string): ResolvedRate {
    return this.resolveFromRules(itemKey, unit);
  }

  resolve(itemKey: string, unit: string): ResolvedRate {
    const base = this.resolveFromRules(itemKey, unit);
    const chosen = this.accessories[itemKey];
    return chosen ? applyAccessory(base, chosen) : base;
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
      };
    }

    throw new Error(`Rate rule "${itemKey}" has no labour, material, or allowance.`);
  }
}
