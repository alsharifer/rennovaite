// =============================================================================
// lib/boq/schema.ts — types for the deterministic BoQ engine.
//
// The output shape is a strict superset of the legacy BoqResponse produced by
// app/api/generate-boq (sections / subtotal_aed / contingency / vat / grand
// total), so it drops into the existing `boqs.sections` column and the
// /project/[id]/boq UI without changes. Extra per-line fields (rule_id, kind,
// wastage_pct, rate_band) are additive and ignored by the current reader.
// =============================================================================

import { z } from "zod";

export const POMI_SECTIONS = [
  "Demolition",
  "Blockwork",
  "Plaster",
  "Floor Finishes",
  "Wall Finishes",
  "Ceilings",
  "Joinery & Carpentry",
  "Sanitaryware",
  "Electrical",
  "Plumbing",
  "MEP / HVAC",
  "Lighting",
  "Decoration & Painting",
  "Preliminaries",
] as const;

export type PomiSection = (typeof POMI_SECTIONS)[number];

// --- Inputs ------------------------------------------------------------------

export type EngineRoom = {
  id: string;
  name: string;
  room_type: string; // master_bedroom | bedroom | bathroom | ensuite | living | ...
  area_m2: number;
  /** Optional plan polygon ([[x,y],...], pixel space). Used only to recover
   *  the width:depth aspect ratio; real dimensions come from area_m2. */
  polygon?: number[][] | null;
};

export type LabourRate = {
  work_section: string;
  description: string;
  unit: string;
  rate_low_aed: number;
  rate_mid_aed: number;
  rate_high_aed: number;
};

export type PricingSku = {
  sku: string;
  brand: string;
  category: string;
  subcategory: string;
  description_en: string;
  unit: string;
  price_aed: number;
  vendor: string;
};

export type Tier = "value" | "mid" | "premium";

export type EngineInput = {
  rooms: EngineRoom[];
  labourRates: LabourRate[];
  skus: PricingSku[];
  /** Style key from lib/styles.ts; null → "mid" tier, porcelain flooring. */
  styleKey: string | null;
};

// --- Take-off (intermediate) ---------------------------------------------------

export type ScopeItem = {
  rule_id: string; // e.g. "Q-03" — references docs/QS_REVIEW_PACK.md
  work_section: PomiSection;
  item_key: string; // stable key used by rates.ts to resolve pricing
  description: string;
  quantity: number;
  unit: string; // m2 | lm | no | m3 | project
  /** Human-readable derivation, e.g. "Σ net wall area × 0.15". Shown to the QS. */
  measurement: string;
};

// --- Output --------------------------------------------------------------------

export const BoqLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1),
  rate_aed: z.number().nonnegative(),
  total_aed: z.number().nonnegative(),
  vendor_or_source: z.string(),
  notes: z.string().nullable(),
  // -- engine-only additive fields --
  rule_id: z.string(),
  kind: z.enum(["labour", "material", "supply_and_install", "lump", "allowance"]),
  rate_band: z.enum(["low", "mid", "high", "sku", "allowance"]),
  wastage_pct: z.number().nonnegative(),
});

export const BoqSectionSchema = z.object({
  work_section: z.enum(POMI_SECTIONS),
  lines: z.array(BoqLineSchema).min(1),
  section_total_aed: z.number().nonnegative(),
});

export const BoqSchema = z.object({
  sections: z.array(BoqSectionSchema).min(1),
  subtotal_aed: z.number().nonnegative(),
  contingency_pct: z.number().nonnegative(),
  contingency_aed: z.number().nonnegative(),
  vat_pct: z.number().nonnegative(),
  vat_aed: z.number().nonnegative(),
  grand_total_aed: z.number().nonnegative(),
  // -- engine-only additive metadata --
  engine: z.object({
    version: z.string(),
    tier: z.enum(["value", "mid", "premium"]),
    flooring: z.enum(["porcelain", "engineered_wood"]),
    style_key: z.string().nullable(),
    generated_at: z.string(),
  }),
});

export type BoqLine = z.infer<typeof BoqLineSchema>;
export type BoqSection = z.infer<typeof BoqSectionSchema>;
export type Boq = z.infer<typeof BoqSchema>;
