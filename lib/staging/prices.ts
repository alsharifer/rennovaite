// =============================================================================
// lib/staging/prices.ts — indicative furniture pricing (P7).
//
// A small seed table of indicative Dubai retail prices per furniture type, at
// three retail tiers (IKEA / Home Centre / Danube Home). Each style maps to a
// tier so a set is priced consistently with its grade. EVERY price is
// `rate_status: 'indicative'` — these are ballpark retail figures for a "what
// would furnishing cost?" line, NOT contracted QS rates.
//
// This module is the single source of the numbers. `scripts/seed-furniture-
// prices.ts` copies them into an optional `furniture_prices` DB table for
// parity with the rate-book pattern; `loadFurniturePrices` prefers that table
// and falls back to this module, so the feature works before the migration is
// applied (mirrors lib/whatif/rate-book.ts).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StyleKey } from "@/lib/render-prompts";
import type { FurnitureKey } from "./sets";

export type FurnitureTier = "value" | "mid" | "premium";

// Retail-tier → the vendor cited on the BoQ line.
export const TIER_VENDOR: Record<FurnitureTier, string> = {
  value: "IKEA (indicative)",
  mid: "Home Centre (indicative)",
  premium: "Danube Home (indicative)",
};

// Each style's furnishing tier. Mirrors the material rate-band grouping used in
// generate-boq: value-leaning directions vs premium directions.
export const STYLE_TIER: Record<StyleKey, FurnitureTier> = {
  "scandi-arabic": "value",
  "coastal-emirati": "value",
  "contemporary-majlis": "mid",
  "andalusian-heritage": "mid",
  "modern-hijazi": "premium",
  "luxe-minimal": "premium",
};

// Indicative AED retail per unit, per tier. Premium tier is grounded against
// the curated KG furniture nodes (Marina Home / Western Furniture); mid ≈ 45%,
// value ≈ 22% of premium, matching Home Centre / IKEA UAE catalogue bands.
export const FURNITURE_PRICES: Record<
  FurnitureKey,
  Record<FurnitureTier, number>
> = {
  "sofa-3seat": { value: 2200, mid: 4500, premium: 8500 },
  sectional: { value: 4900, mid: 9500, premium: 18000 },
  "accent-chair": { value: 650, mid: 1400, premium: 3200 },
  "coffee-table": { value: 550, mid: 1300, premium: 3200 },
  "side-table": { value: 250, mid: 550, premium: 1200 },
  "media-console": { value: 900, mid: 2100, premium: 4800 },
  "floor-lamp": { value: 350, mid: 850, premium: 2400 },
  "table-lamp": { value: 180, mid: 450, premium: 1200 },
  "rug-large": { value: 900, mid: 1900, premium: 4200 },
  "rug-medium": { value: 550, mid: 1200, premium: 2800 },
  "majlis-floor-seating": { value: 1800, mid: 3800, premium: 7800 },
  "majlis-sofa": { value: 3500, mid: 8500, premium: 18500 },
  "floor-cushions": { value: 400, mid: 900, premium: 1900 },
  "coffee-console": { value: 600, mid: 1200, premium: 2600 },
  "king-bed": { value: 2600, mid: 5500, premium: 11200 },
  "queen-bed": { value: 1900, mid: 3900, premium: 8200 },
  "single-bed": { value: 950, mid: 1900, premium: 3800 },
  "bedside-pair": { value: 500, mid: 1100, premium: 2400 },
  "bench-end": { value: 550, mid: 1200, premium: 2600 },
  dresser: { value: 1200, mid: 2600, premium: 5400 },
  wardrobe: { value: 1900, mid: 4200, premium: 9500 },
  "upholstered-chair": { value: 750, mid: 1600, premium: 3600 },
  "study-desk": { value: 650, mid: 1300, premium: 2800 },
  "desk-chair": { value: 350, mid: 750, premium: 1600 },
  bookshelf: { value: 450, mid: 950, premium: 2200 },
  "dining-table": { value: 1900, mid: 4500, premium: 14500 },
  "dining-chairs": { value: 1400, mid: 3200, premium: 6800 },
  "buffet-console": { value: 1900, mid: 4200, premium: 9600 },
  "counter-stools": { value: 700, mid: 1500, premium: 3200 },
  "nook-table": { value: 600, mid: 1300, premium: 2900 },
  "nook-bench": { value: 750, mid: 1600, premium: 3400 },
  "bar-cart": { value: 450, mid: 950, premium: 2100 },
  "pendant-feature": { value: 550, mid: 1300, premium: 6800 },
  "wall-art": { value: 400, mid: 1200, premium: 4800 },
  "mirror-feature": { value: 600, mid: 1500, premium: 3400 },
};

export function tierForStyle(styleKey: string): FurnitureTier {
  return STYLE_TIER[styleKey as StyleKey] ?? "mid";
}

export type FurniturePriceBook = Record<FurnitureKey, Record<FurnitureTier, number>>;

/** Unit price for a furniture key at a style's tier, from a resolved book. */
export function priceFor(
  book: FurniturePriceBook,
  key: FurnitureKey,
  styleKey: string,
): number {
  const row = book[key];
  if (!row) return 0;
  return row[tierForStyle(styleKey)] ?? 0;
}

/**
 * Resolve the price book: prefer the seeded `furniture_prices` DB table (so a
 * QS can revise indicative figures without a code deploy); fall back to the
 * bundled module defaults when the table is absent/empty. Never throws.
 */
export async function loadFurniturePrices(
  supabase: SupabaseClient,
): Promise<FurniturePriceBook> {
  try {
    const { data, error } = await supabase
      .from("furniture_prices")
      .select("item_key, tier, price_aed");
    if (error || !data || data.length === 0) return FURNITURE_PRICES;
    const book: FurniturePriceBook = structuredCloneSafe(FURNITURE_PRICES);
    for (const r of data as {
      item_key: string;
      tier: string;
      price_aed: number;
    }[]) {
      const row = book[r.item_key as FurnitureKey];
      if (row && (r.tier === "value" || r.tier === "mid" || r.tier === "premium")) {
        row[r.tier] = Number(r.price_aed);
      }
    }
    return book;
  } catch {
    return FURNITURE_PRICES;
  }
}

// structuredClone isn't guaranteed across every runtime target here; a shallow
// per-row clone is enough (values are plain numbers).
function structuredCloneSafe(book: FurniturePriceBook): FurniturePriceBook {
  const out = {} as FurniturePriceBook;
  for (const k of Object.keys(book) as FurnitureKey[]) {
    out[k] = { ...book[k] };
  }
  return out;
}
