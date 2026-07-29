// =============================================================================
// lib/whatif/grades.ts — material grade → real spec mapping (Prompt P5).
//
// Grades are NOT multipliers — each is a concrete spec at a concrete AED rate
// from the QS-validated Dubai rate sources (labour-rates.csv bands + the
// pricing_skus SKU catalogue). `standard` rate == the P4 baseline BoQ rate for
// that work item, so selecting "standard" is a zero-delta no-op. Every entry
// carries its source (the transparency moat) and a qs_validated flag. QS can
// review this one file directly — one comment line per choice.
// =============================================================================

export type Grade = "economy" | "standard" | "premium";

export interface GradeSpec {
  /** The concrete specification the QS prices — not a grade adjective. */
  spec: string;
  rate_aed: number;
  source: string;
  qs_validated: boolean;
}

/** BoQ work items that carry a material grade (from P4's quantify item keys). */
export type GradeableItem =
  | "floor_finish"
  | "wet_tiling"
  | "ceiling_finish"
  | "wall_paint"
  | "wall_plaster";

export const GRADEABLE_ITEMS: readonly GradeableItem[] = [
  "floor_finish",
  "wet_tiling",
  "ceiling_finish",
  "wall_paint",
  "wall_plaster",
];

export const BASELINE_GRADE: Grade = "standard";

// Human labels for the item keys (toggle-row headings).
export const ITEM_LABEL: Record<GradeableItem, string> = {
  floor_finish: "Floor finish",
  wet_tiling: "Wet-area wall tiling",
  ceiling_finish: "Ceiling",
  wall_paint: "Wall paint",
  wall_plaster: "Wall plaster",
};

export const GRADE_SPECS: Record<GradeableItem, Record<Grade, GradeSpec>> = {
  floor_finish: {
    // Basic ceramic — no exact catalogue SKU yet, so flagged for QS pricing.
    economy: { spec: "Ceramic tile 60×60, matt", rate_aed: 90, source: "Dubai supplier average 2024-25", qs_validated: false },
    // Baseline = rectified porcelain (RAK Maximus class), matches the P4 line rate.
    standard: { spec: "Porcelain 80×80, rectified", rate_aed: 190, source: "RAK Ceramics — pricing_skus SKU pool", qs_validated: true },
    // Natural stone band varies by quarry/finish — QS to confirm the slab.
    premium: { spec: "Natural marble slab, honed", rate_aed: 450, source: "Dubai stone-supplier band", qs_validated: false },
  },
  wet_tiling: {
    // Standard ceramic wall tile for wet zones.
    economy: { spec: "Ceramic wall tile 30×60", rate_aed: 140, source: "Dubai supplier average 2024-25", qs_validated: false },
    // Baseline = porcelain wall tile, matches the P4 line rate.
    standard: { spec: "Porcelain wall tile 60×60", rate_aed: 260, source: "RAK Ceramics — pricing_skus SKU pool", qs_validated: true },
    // Large-format marble-effect porcelain (RAK Maximus 60×120 @ AED 137/m² supply).
    premium: { spec: "Large-format porcelain 60×120", rate_aed: 460, source: "RAK Maximus 60×120 — pricing_skus SKU", qs_validated: true },
  },
  ceiling_finish: {
    // Plain flush gypsum board — labour-rates.csv ceilings low band.
    economy: { spec: "Plain gypsum board ceiling, flush", rate_aed: 90, source: "labour-rates.csv — Ceilings (low)", qs_validated: true },
    // Baseline = gypsum + cove + LED provision — labour-rates.csv mid band.
    standard: { spec: "Gypsum ceiling + cove + LED provision", rate_aed: 130, source: "labour-rates.csv — Ceilings (mid)", qs_validated: true },
    // Decorative gypsum with recessed detailing — labour-rates.csv high band.
    premium: { spec: "Decorative gypsum, recessed detail", rate_aed: 220, source: "labour-rates.csv — Ceilings (high)", qs_validated: true },
  },
  wall_paint: {
    // Basic emulsion, 2 coats — labour-rates.csv painting low band.
    economy: { spec: "Emulsion, 2 coats", rate_aed: 22, source: "labour-rates.csv — Decoration (low)", qs_validated: true },
    // Baseline = washable matt, primer + 2 coats — labour-rates.csv mid band.
    standard: { spec: "Washable matt emulsion, primer + 2 coats", rate_aed: 35, source: "labour-rates.csv — Decoration (mid)", qs_validated: true },
    // Premium low-VOC / lime-wash finish — labour-rates.csv high band.
    premium: { spec: "Low-VOC / lime-wash finish", rate_aed: 70, source: "labour-rates.csv — Decoration (high)", qs_validated: true },
  },
  wall_plaster: {
    // Single-coat skim — labour-rates.csv plaster low band.
    economy: { spec: "Single-coat skim", rate_aed: 40, source: "labour-rates.csv — Plaster (low)", qs_validated: true },
    // Baseline = two-coat plaster + skim — labour-rates.csv mid band.
    standard: { spec: "Two-coat plaster + skim", rate_aed: 55, source: "labour-rates.csv — Plaster (mid)", qs_validated: true },
    // Machine plaster, level-5 finish — labour-rates.csv plaster high band.
    premium: { spec: "Machine plaster, level-5 finish", rate_aed: 90, source: "labour-rates.csv — Plaster (high)", qs_validated: true },
  },
};

// =============================================================================
// Sanitary spec classes (ground-truth Step 3) — a SEPARATE reference map, NOT a
// live what-if toggle. P4 quantify emits no sanitary lines, so these do not
// drive the what-if panel; the Sanitary BoQ section consumes them. Two of the
// three "sanitary gaps" in the Rate Calibration sheet were spec-class
// mismatches, not price gaps — modelled here as distinct spec classes within a
// grade, per the workbook. EVERY assignment is `// pending partner review`
// (Newspace to confirm the tier vocabulary).
// =============================================================================

export interface SanitarySpec {
  spec: string;
  rate_aed: number;
  source: string;
  /** All ground-truth sanitary assignments await partner (Newspace) review. */
  pending_partner_review: true;
}

export type SanitaryClass = "basin_mixer" | "shower_system";

export const SANITARY_SPEC_CLASSES: Record<SanitaryClass, Record<Grade, SanitarySpec | null>> = {
  basin_mixer: {
    economy: null,
    // standard = Eurosmart (actual project spec), NOT Eurocube — the seed had
    // Eurocube in standard, which was the spec-class error. // pending partner review
    standard: { spec: "GROHE Eurosmart basin mixer (332652433)", rate_aed: 400, source: "Laspinas quotation 46703 — actual project spec", pending_partner_review: true },
    // Eurocube (the old seed's "standard") is really the premium tier. // pending partner review
    premium: { spec: "GROHE Eurocube basin mixer", rate_aed: 675, source: "seed rate reclassified to premium per Rate Calibration", pending_partner_review: true },
  },
  shower_system: {
    economy: null,
    // Exposed vs concealed are DISTINCT spec classes, not one item at two prices.
    // standard = exposed Tempesta set (the old seed). // pending partner review
    standard: { spec: "GROHE Tempesta exposed shower set", rate_aed: 500, source: "seed rate — exposed spec class", pending_partner_review: true },
    // premium = concealed Tempesta 250 system (the actual project spec). // pending partner review
    premium: { spec: "GROHE concealed shower Tempesta 250, matt black (1053362430)", rate_aed: 1_750, source: "Laspinas quotation 46703 — actual concealed system", pending_partner_review: true },
  },
};

export function isGradeableItem(key: string): key is GradeableItem {
  return (GRADEABLE_ITEMS as readonly string[]).includes(key);
}

/** Extract the gradeable item key from a P4 mapped line's rule_id (P4/quantify/<key>). */
export function itemKeyFromRuleId(ruleId: string | undefined): GradeableItem | null {
  if (!ruleId || !ruleId.startsWith("P4/quantify/")) return null;
  const key = ruleId.slice("P4/quantify/".length);
  return isGradeableItem(key) ? key : null;
}
