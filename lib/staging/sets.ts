// =============================================================================
// lib/staging/sets.ts — furniture-staging vocabulary (P7).
//
// Per style key × room type, a style-consistent furniture set (4–6 pieces,
// GCC-appropriate). Two jobs feed off this ONE table:
//   1. Render prompt enrichment — a STAGING block appended after KG context so
//      the photoreal render reads as furnished (lib/staging/prompt.ts).
//   2. The optional priced "Furniture (optional)" BoQ section, if the homeowner
//      opts a room in (lib/staging/furniture-boq.ts).
//
// Pure data + pure lookups — no DB, no LLM, SSR-safe, unit-tested. Each item's
// `key` is a generic priceable furniture type (priced in lib/staging/prices.ts);
// its `label` carries the per-style flavour shown in the render prompt and BoQ.
// =============================================================================

import type { StyleKey } from "@/lib/render-prompts";

// Staging distinguishes six key room types. Broader than the 4 render RoomTypes
// (majlis / dining / kitchen collapse to "living" for the render camera prompt)
// so a majlis gets floor seating and a dining room gets a table, not a sofa.
export type StagingRoomType =
  | "living"
  | "majlis"
  | "master-bed"
  | "kids-bed"
  | "dining"
  | "kitchen-adjacent";

// Generic, priceable furniture types. The label on each StagingItem is
// style-specific; this key is what lib/staging/prices.ts prices per tier.
export type FurnitureKey =
  | "sofa-3seat"
  | "sectional"
  | "accent-chair"
  | "coffee-table"
  | "side-table"
  | "media-console"
  | "floor-lamp"
  | "table-lamp"
  | "rug-large"
  | "rug-medium"
  | "majlis-floor-seating"
  | "majlis-sofa"
  | "floor-cushions"
  | "coffee-console"
  | "king-bed"
  | "queen-bed"
  | "single-bed"
  | "bedside-pair"
  | "bench-end"
  | "dresser"
  | "wardrobe"
  | "upholstered-chair"
  | "study-desk"
  | "desk-chair"
  | "bookshelf"
  | "dining-table"
  | "dining-chairs"
  | "buffet-console"
  | "counter-stools"
  | "nook-table"
  | "nook-bench"
  | "bar-cart"
  | "pendant-feature"
  | "wall-art"
  | "mirror-feature";

export type StagingItem = {
  key: FurnitureKey;
  /** Style-specific description, e.g. "3-seat sofa in oatmeal linen". */
  label: string;
  /** Priced units (default 1). A "(pair)"/"(set of 6)" label prices as one. */
  qty?: number;
};

export type StagingSet = StagingItem[];

// Convenience so a set literal reads cleanly.
const i = (key: FurnitureKey, label: string, qty?: number): StagingItem =>
  qty && qty !== 1 ? { key, label, qty } : { key, label };

// -----------------------------------------------------------------------------
// The 6 styles × 6 room types. Traditional directions (majlis, hijazi,
// andalusian) get majlis floor seating; contemporary directions get raised
// majlis sofas. Every set is 4–6 items (unit-tested).
// -----------------------------------------------------------------------------

export const STAGING_SETS: Record<StyleKey, Record<StagingRoomType, StagingSet>> = {
  "contemporary-majlis": {
    living: [
      i("sofa-3seat", "3-seat sofa in oatmeal linen"),
      i("coffee-table", "walnut coffee table"),
      i("rug-large", "wool rug 300×200 in sand"),
      i("accent-chair", "brass-legged accent chairs", 2),
      i("floor-lamp", "arc floor lamp in brushed brass"),
    ],
    majlis: [
      i("majlis-floor-seating", "majlis floor seating set, oatmeal linen cushions"),
      i("floor-cushions", "scatter bolster cushions, brass-thread weave"),
      i("coffee-console", "low walnut coffee-service console"),
      i("rug-large", "hand-loomed wool rug 300×400"),
      i("table-lamp", "travertine table lamp"),
    ],
    "master-bed": [
      i("king-bed", "walnut platform king bed, linen headboard"),
      i("bedside-pair", "floating walnut bedsides (pair)"),
      i("bench-end", "linen end-of-bed bench"),
      i("dresser", "walnut 6-drawer dresser"),
      i("rug-medium", "wool rug 200×300"),
      i("table-lamp", "travertine bedside lamps (pair)"),
    ],
    "kids-bed": [
      i("single-bed", "single bed with linen headboard"),
      i("study-desk", "compact walnut study desk"),
      i("desk-chair", "upholstered desk chair"),
      i("wardrobe", "3-door walnut wardrobe"),
      i("bookshelf", "open oak bookshelf"),
    ],
    dining: [
      i("dining-table", "walnut dining table, seats 8"),
      i("dining-chairs", "linen dining chairs (set of 6)"),
      i("buffet-console", "fluted walnut buffet console"),
      i("pendant-feature", "linear brass pendant over table"),
      i("rug-large", "flatweave rug under table 300×200"),
    ],
    "kitchen-adjacent": [
      i("counter-stools", "brass-legged counter stools (set of 3)"),
      i("nook-table", "walnut breakfast-nook table"),
      i("nook-bench", "linen banquette bench"),
      i("bar-cart", "brushed-brass bar cart"),
    ],
  },

  "modern-hijazi": {
    living: [
      i("sofa-3seat", "deep mahogany-framed sofa in ivory linen"),
      i("coffee-table", "carved-wood coffee table"),
      i("rug-large", "hand-loomed kilim rug 300×200"),
      i("accent-chair", "burgundy velvet accent chairs", 2),
      i("mirror-feature", "arched brass-framed mirror"),
    ],
    majlis: [
      i("majlis-floor-seating", "traditional majlis floor seating, burgundy & ivory"),
      i("floor-cushions", "kilim bolster cushions"),
      i("coffee-console", "carved mahogany coffee console"),
      i("rug-large", "hand-knotted kilim rug 300×400"),
      i("table-lamp", "brass table lamp, opal glass"),
    ],
    "master-bed": [
      i("king-bed", "mahogany king bed, carved headboard"),
      i("bedside-pair", "mahogany bedsides (pair)"),
      i("wardrobe", "mashrabiya-front wardrobe"),
      i("dresser", "mahogany dresser with brass pulls"),
      i("bench-end", "ivory linen bench"),
      i("rug-medium", "kilim runner rug 200×300"),
    ],
    "kids-bed": [
      i("single-bed", "carved-wood single bed"),
      i("wardrobe", "mashrabiya-panel wardrobe"),
      i("study-desk", "mahogany study desk"),
      i("desk-chair", "woven-seat desk chair"),
      i("bookshelf", "mahogany bookshelf"),
    ],
    dining: [
      i("dining-table", "solid mahogany dining table, seats 10"),
      i("dining-chairs", "brass-studded ivory dining chairs (set of 6)"),
      i("buffet-console", "latticework buffet console"),
      i("pendant-feature", "brass lattice pendant"),
      i("rug-large", "kilim dining rug 300×200"),
    ],
    "kitchen-adjacent": [
      i("counter-stools", "mahogany counter stools (set of 3)"),
      i("nook-table", "carved-wood nook table"),
      i("nook-bench", "ivory linen banquette"),
      i("bar-cart", "brass & glass bar cart"),
    ],
  },

  "coastal-emirati": {
    living: [
      i("sectional", "modular sectional in whitewashed linen"),
      i("coffee-table", "bleached-oak coffee table"),
      i("rug-large", "woven jute rug 300×200"),
      i("accent-chair", "rattan-wrapped lounge chairs", 2),
      i("floor-lamp", "rattan-shade floor lamp"),
    ],
    majlis: [
      i("majlis-sofa", "deep coastal majlis sofa, sea-glass linen", 2),
      i("coffee-console", "bleached-oak coffee console"),
      i("rug-large", "oversized jute rug 300×400"),
      i("floor-cushions", "sea-glass blue floor cushions"),
    ],
    "master-bed": [
      i("king-bed", "bleached-oak platform bed, linen bedding"),
      i("bedside-pair", "rattan-front bedsides (pair)"),
      i("bench-end", "woven bench at bed foot"),
      i("dresser", "whitewashed oak dresser"),
      i("rug-medium", "jute-blend rug 200×300"),
    ],
    "kids-bed": [
      i("single-bed", "whitewashed single bed"),
      i("wardrobe", "rattan-front wardrobe"),
      i("study-desk", "bleached-oak desk"),
      i("desk-chair", "rattan desk chair"),
      i("bookshelf", "open coastal shelving"),
    ],
    dining: [
      i("dining-table", "bleached-oak dining table, seats 8"),
      i("dining-chairs", "rattan-back dining chairs (set of 6)"),
      i("buffet-console", "whitewashed sideboard"),
      i("pendant-feature", "rope-wrapped rattan pendant"),
      i("rug-large", "jute dining rug 300×200"),
    ],
    "kitchen-adjacent": [
      i("counter-stools", "rattan counter stools (set of 3)"),
      i("nook-table", "bleached-oak nook table"),
      i("nook-bench", "linen banquette, sea-glass piping"),
      i("bar-cart", "rattan bar cart"),
    ],
  },

  "scandi-arabic": {
    living: [
      i("sofa-3seat", "3-seat sofa in off-white linen"),
      i("coffee-table", "pale-ash coffee table"),
      i("rug-large", "wool rug 300×200 in sand"),
      i("accent-chair", "sage bouclé accent chairs", 2),
      i("floor-lamp", "matte-black tripod floor lamp"),
    ],
    majlis: [
      i("majlis-sofa", "low ash-framed majlis sofa, off-white linen", 2),
      i("coffee-console", "pale-ash coffee console"),
      i("rug-large", "flatweave wool rug 300×400"),
      i("floor-cushions", "sand & sage floor cushions"),
    ],
    "master-bed": [
      i("king-bed", "ash platform bed, off-white linen"),
      i("bedside-pair", "pale-ash bedsides (pair)"),
      i("bench-end", "sage linen bench"),
      i("dresser", "ash 6-drawer dresser"),
      i("rug-medium", "wool rug 200×300"),
      i("table-lamp", "matte-black bedside lamps (pair)"),
    ],
    "kids-bed": [
      i("single-bed", "ash single bed, linen headboard"),
      i("wardrobe", "pale-ash wardrobe"),
      i("study-desk", "ash study desk"),
      i("desk-chair", "sage desk chair"),
      i("bookshelf", "ash open shelving"),
    ],
    dining: [
      i("dining-table", "pale-ash dining table, seats 8"),
      i("dining-chairs", "off-white moulded dining chairs (set of 6)"),
      i("buffet-console", "ash sideboard, matte-black pulls"),
      i("pendant-feature", "matte-black opal pendant"),
      i("rug-large", "flatweave dining rug 300×200"),
    ],
    "kitchen-adjacent": [
      i("counter-stools", "ash counter stools (set of 3)"),
      i("nook-table", "pale-ash nook table"),
      i("nook-bench", "off-white linen banquette"),
      i("bar-cart", "matte-black bar cart"),
    ],
  },

  "andalusian-heritage": {
    living: [
      i("sofa-3seat", "carved-frame sofa in ivory"),
      i("coffee-table", "copper-topped coffee table"),
      i("rug-large", "hand-knotted rug in cobalt & ochre 300×200"),
      i("accent-chair", "ochre velvet accent chairs", 2),
      i("wall-art", "hand-glazed ceramic wall panel"),
    ],
    majlis: [
      i("majlis-floor-seating", "Andalusian majlis floor seating, ochre & ivory"),
      i("floor-cushions", "zellige-pattern bolster cushions"),
      i("coffee-console", "carved coffee-service console"),
      i("rug-large", "hand-knotted cobalt rug 300×400"),
      i("table-lamp", "hammered-copper table lamp"),
    ],
    "master-bed": [
      i("king-bed", "carved-headboard king bed, ivory linen"),
      i("bedside-pair", "carved-wood bedsides (pair)"),
      i("wardrobe", "carved-plaster-front wardrobe"),
      i("dresser", "copper-pull dresser"),
      i("bench-end", "ochre velvet bench"),
      i("rug-medium", "cobalt runner rug 200×300"),
    ],
    "kids-bed": [
      i("single-bed", "carved single bed"),
      i("wardrobe", "painted-panel wardrobe"),
      i("study-desk", "carved-leg study desk"),
      i("desk-chair", "woven desk chair"),
      i("bookshelf", "arched-top bookshelf"),
    ],
    dining: [
      i("dining-table", "carved-leg dining table, seats 10"),
      i("dining-chairs", "ivory dining chairs, copper studs (set of 6)"),
      i("buffet-console", "zellige-topped buffet console"),
      i("pendant-feature", "pierced-copper lantern pendant"),
      i("rug-large", "cobalt & ochre dining rug 300×200"),
    ],
    "kitchen-adjacent": [
      i("counter-stools", "copper-seat counter stools (set of 3)"),
      i("nook-table", "zellige-topped nook table"),
      i("nook-bench", "ochre banquette bench"),
      i("bar-cart", "hammered-copper bar cart"),
    ],
  },

  "luxe-minimal": {
    living: [
      i("sectional", "modular sectional in graphite bouclé"),
      i("coffee-table", "calacatta-stone coffee table"),
      i("rug-large", "hand-tufted wool rug 300×200, tonal graphite"),
      i("accent-chair", "smoked-oak lounge chairs", 2),
      i("floor-lamp", "champagne-brass floor lamp"),
    ],
    majlis: [
      i("majlis-sofa", "deep tonal majlis sofa, graphite linen", 2),
      i("coffee-console", "smoked-oak & stone coffee console"),
      i("rug-large", "hand-tufted wool rug 300×400"),
      i("floor-cushions", "tonal silk floor cushions"),
    ],
    "master-bed": [
      i("king-bed", "smoked-oak platform king bed"),
      i("bedside-pair", "floating stone-top bedsides (pair)"),
      i("bench-end", "graphite leather bench"),
      i("dresser", "smoked-oak dresser, push-to-open"),
      i("rug-medium", "wool rug 200×300"),
      i("table-lamp", "alabaster bedside lamps (pair)"),
    ],
    "kids-bed": [
      i("single-bed", "smoked-oak single bed"),
      i("wardrobe", "handleless smoked-oak wardrobe"),
      i("study-desk", "stone-top study desk"),
      i("desk-chair", "graphite desk chair"),
      i("bookshelf", "concealed-fix shelving"),
    ],
    dining: [
      i("dining-table", "calacatta-top dining table, seats 8"),
      i("dining-chairs", "graphite bouclé dining chairs (set of 6)"),
      i("buffet-console", "handleless smoked-oak buffet"),
      i("pendant-feature", "linear champagne-brass pendant"),
      i("rug-large", "tonal wool dining rug 300×200"),
    ],
    "kitchen-adjacent": [
      i("counter-stools", "smoked-oak counter stools (set of 3)"),
      i("nook-table", "stone-top nook table"),
      i("nook-bench", "graphite leather banquette"),
      i("bar-cart", "champagne-brass bar cart"),
    ],
  },
};

// Database `rooms.room_type` (snake_case) → staging room type. Wet rooms,
// circulation, terraces, closets get no staging set (null). majlis / dining /
// kitchen split out from the render-prompt "living" bucket so each is furnished
// appropriately.
const DB_TO_STAGING: Record<string, StagingRoomType> = {
  living: "living",
  family: "living",
  majlis: "majlis",
  master_bedroom: "master-bed",
  bedroom: "kids-bed",
  dining: "dining",
  kitchen: "kitchen-adjacent",
};

export function stagingRoomTypeFromDb(
  dbRoomType: string | null | undefined,
): StagingRoomType | null {
  if (!dbRoomType) return null;
  return DB_TO_STAGING[dbRoomType] ?? null;
}

export function getStagingSet(
  styleKey: string,
  roomType: StagingRoomType,
): StagingSet | null {
  const byRoom = STAGING_SETS[styleKey as StyleKey];
  if (!byRoom) return null;
  return byRoom[roomType] ?? null;
}

export const STAGING_ROOM_TYPES: readonly StagingRoomType[] = [
  "living",
  "majlis",
  "master-bed",
  "kids-bed",
  "dining",
  "kitchen-adjacent",
];
