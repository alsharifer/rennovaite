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
};

export class RateResolver {
  private labourIndex = new Map<string, LabourRate>();

  constructor(
    labourRates: LabourRate[],
    private skus: PricingSku[],
    private tier: Tier,
  ) {
    for (const r of labourRates) {
      this.labourIndex.set(`${norm(r.work_section)}|${norm(r.description)}`, r);
    }
  }

  resolve(itemKey: string, unit: string): ResolvedRate {
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
