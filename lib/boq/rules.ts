// =============================================================================
// lib/boq/rules.ts — every constant, factor, and mapping the deterministic
// BoQ engine uses, in one place, each with a rule ID.
//
// THIS FILE IS THE QS REVIEW SURFACE. When the quantity surveyor corrects a
// wastage factor, a measurement convention, or a rate mapping, the change is
// made here (and only here). docs/QS_REVIEW_PACK.md is generated from these
// tables by scripts/boq-example.ts.
// =============================================================================

import type { PomiSection, Tier } from "./schema";

// v0.2.0 — calibrated against the real Villa 94 (Al Naseem F2, Mudon) signed
// scope of work, tile BoQ, sanitary quotation, and Rev-00 shop drawings.
// See docs/QS_PACK_VALIDATION.md for the full derivation of each correction.
export const ENGINE_VERSION = "0.2.0";

// --- C: dimensional constants (rule IDs C-xx) --------------------------------

export const CONSTANTS = {
  /** C-01: slab-to-ceiling wall height, Dubai villa first floor. */
  WALL_HEIGHT_M: 2.9,
  /** C-02: standard internal door opening (structural), W × H. */
  DOOR_W_M: 0.9,
  DOOR_H_M: 2.1,
  /** C-03: window/opening deduction on gross wall area, non-wet rooms. */
  WINDOW_DEDUCTION_PCT: 0.08,
  /** C-04: bathroom wall tiling height — FULL HEIGHT per Villa 94 SoW §3.3
   *  (was 2.4 m in v0.1; corrected by real-project validation). */
  BATH_TILE_HEIGHT_M: 2.9,
  /** C-05: default width:depth aspect when a room has no plan polygon. */
  DEFAULT_ROOM_ASPECT: 1.3,
  /** C-06: demolition debris volume proxy, m³ per m² of refit floor area. */
  DEBRIS_M3_PER_M2: 0.2,
  /** C-07: usable skip capacity, m³ (6-yard skip). */
  SKIP_CAPACITY_M3: 4.5,
  /** C-08: staircase developed tile surface (treads + risers + landings) as a
   *  multiple of stair footprint. Villa 94: 13.3 m² footprint → 35.12 m² slab
   *  actual ≈ 2.64×; 2.6 is the calibrated default (QS to confirm from stair
   *  drawing). Makes the staircase tile surface visible (was folded into flat
   *  floor before). */
  STAIR_DEVELOPED_FACTOR: 2.6,
} as const;

// --- W: wastage factors (rule IDs W-xx), applied to MATERIAL lines only ------

export const WASTAGE = {
  /** W-01: porcelain floor tile (cuts, breakage, pattern matching). */
  FLOOR_TILE: 0.1,
  /** W-02: engineered wood flooring. */
  ENGINEERED_WOOD: 0.08,
  /** W-03: bathroom wall tile (more cuts around fittings). */
  WALL_TILE: 0.12,
} as const;

// --- F: quantity formulas (rule IDs F-xx) — implemented in takeoff.ts --------
// F-01 net wall area  = perimeter × C-01 − doors − (windows C-03, dry rooms only)
// F-02 paint area     = Σ dry-room (net wall + ceiling) + Σ bathroom ceiling
// F-03 bath wet wall  = perimeter × C-04 − door (C-02 W × C-04)
// F-04 skirting       = dry-room perimeter − door widths
// F-05 plaster make-good = 15 % of Σ net wall area
export const PLASTER_MAKEGOOD_FACTOR = 0.15; // F-05
// F-06 downlights     = ceil(room area / 3.5 m² per fitting)
export const AREA_PER_DOWNLIGHT_M2 = 3.5; // F-06
// F-07 small power/switch points = ceil(room area × 0.4)
export const POINTS_PER_M2 = 0.4; // F-07
// F-08 wardrobe runs  = 3.6 lm master bedroom, 2.4 lm secondary bedroom
export const WARDROBE_LM = { master_bedroom: 3.6, bedroom: 2.4 } as const; // F-08
// F-09 pendants       = 1 per bedroom + 2 in living
export const PENDANTS_LIVING = 2; // F-09
// F-10 internal doors = 1 per bedroom + 1 per bathroom
// F-11 skips          = ceil(total area × C-06 ÷ C-07)
// F-12 gypsum false ceiling = interior floor area × 0.9 (Villa 94: 130 m² over ~145 m²)
export const CEILING_COVERAGE_FACTOR = 0.9; // F-12
// F-13 LED cove channel lm = dry interior floor area × 0.85 (Villa 94: 120 lm)
export const COVE_LM_PER_M2 = 0.85; // F-13
// F-14 floor protection = total floor area incl. terrace (Villa 94: ~210 m²)
// F-15 ducted AC replacement = 1 per secondary bedroom (Villa 94 §7.1: kids rooms
//      get new ducted units in their bathrooms; master retains existing unit)
// F-16 split AC = 1 per office

// --- T: style → tier / band / material policy (rule IDs T-xx) ----------------

/** T-01: style key → pricing tier (from lib/styles.ts cost_delta_aed). */
export const STYLE_TIER: Record<string, Tier> = {
  "scandi-arabic": "value",
  "coastal-emirati": "value",
  "contemporary-majlis": "mid",
  "modern-hijazi": "mid",
  "andalusian-heritage": "premium",
  "luxe-minimal": "premium",
};
export const DEFAULT_TIER: Tier = "mid";

/** T-02: tier → labour rate band column. */
export const TIER_LABOUR_BAND: Record<Tier, "low" | "mid" | "high"> = {
  value: "low",
  mid: "mid",
  premium: "high",
};

/** T-03: tier → SKU price percentile within the candidate pool (0 = cheapest). */
export const TIER_SKU_PERCENTILE: Record<Tier, number> = {
  value: 0.25,
  mid: 0.5,
  premium: 0.8,
};

/** T-04: style key → floor finish. */
export const STYLE_FLOORING: Record<string, "porcelain" | "engineered_wood"> = {
  "scandi-arabic": "engineered_wood",
  "coastal-emirati": "engineered_wood",
};
export const DEFAULT_FLOORING = "porcelain" as const;

// --- R: rate resolution rules (rule IDs R-xx) ---------------------------------
// Each scope item_key maps to EITHER a labour_rates row (matched on exact
// work_section + description, whitespace-normalised), OR a SKU pool
// (category/subcategory filter + T-03 percentile pick), or both, or a fixed
// allowance when no priced source exists yet.

export type RateRule = {
  rule_id: string;
  labour?: { work_section: string; description: string };
  material?: {
    category: string;
    subcategory_includes?: string[];
    unit: string;
    wastage: number;
  };
  /** AED/unit used when neither labour row nor SKU pool resolves. */
  allowance_aed?: number;
  allowance_note?: string;
};

export const RATE_RULES: Record<string, RateRule> = {
  "demo.soft_strip": {
    rule_id: "R-01",
    labour: {
      work_section: "Demolition",
      description:
        "Soft strip — carpets, fixtures, fittings removal (no structural)",
    },
  },
  "demo.floor_removal": {
    rule_id: "R-02",
    labour: {
      work_section: "Demolition",
      description: "Floor tile removal — intact substrate",
    },
  },
  "demo.wall_tile_removal": {
    rule_id: "R-03",
    labour: {
      work_section: "Demolition",
      description: "Wall tile removal — bathroom",
    },
  },
  "plaster.make_good": {
    rule_id: "R-04",
    labour: {
      work_section: "Plaster",
      description: "Internal skim or smoothing coat",
    },
  },
  "floor.screed_wet": {
    rule_id: "R-05",
    labour: { work_section: "Floor Finishes", description: "Floor screed 50mm" },
  },
  "floor.porcelain_labour": {
    rule_id: "R-06",
    labour: {
      work_section: "Floor Finishes",
      description: "Porcelain floor tiling — labour only",
    },
  },
  "floor.porcelain_material": {
    rule_id: "R-07",
    material: {
      category: "Tiles",
      subcategory_includes: ["Marble Effect Porcelain"],
      unit: "m2",
      wastage: WASTAGE.FLOOR_TILE,
    },
  },
  "floor.wood_labour": {
    rule_id: "R-08",
    labour: {
      work_section: "Floor Finishes",
      description: "Engineered wood flooring — installation labour only",
    },
  },
  "floor.wood_material": {
    rule_id: "R-09",
    material: {
      category: "Flooring",
      subcategory_includes: ["Engineered Wood"],
      unit: "m2",
      wastage: WASTAGE.ENGINEERED_WOOD,
    },
    allowance_aed: 180,
    allowance_note:
      "No engineered-wood SKU seeded yet — allowance AED 180/m² supply (mid-range click-lock, Danube/BRKZ ballpark).",
  },
  "floor.skirting": {
    rule_id: "R-10",
    labour: {
      work_section: "Floor Finishes",
      description: "Skirting installation (MDF or wood)",
    },
  },
  "wall.bath_tiling_labour": {
    rule_id: "R-11",
    labour: {
      work_section: "Wall Finishes",
      description: "Ceramic or porcelain wall tiling — bathroom, labour only",
    },
  },
  "wall.bath_tiling_material": {
    rule_id: "R-12",
    material: {
      category: "Tiles",
      unit: "m2",
      wastage: WASTAGE.WALL_TILE,
    },
  },
  "paint.full": {
    rule_id: "R-13",
    labour: {
      work_section: "Decoration & Painting",
      description: "Internal painting — 2 coats over prepared surface",
    },
  },
  "elec.downlight": {
    rule_id: "R-14",
    labour: {
      work_section: "Electrical",
      description: "LED downlight — supply and install",
    },
  },
  "elec.point": {
    rule_id: "R-15",
    labour: {
      work_section: "Electrical",
      description: "Power socket or switch — supply and install",
    },
  },
  "plumb.bath_rewire": {
    rule_id: "R-16",
    labour: {
      work_section: "Plumbing",
      description: "Bathroom plumbing rewire — per bathroom, full",
    },
  },
  "plumb.water_heater": {
    rule_id: "R-17",
    labour: {
      work_section: "Plumbing",
      description: "Concealed water heater — supply and install",
    },
  },
  "plumb.floor_drain": {
    rule_id: "R-18",
    labour: {
      work_section: "Plumbing",
      description: "Floor drain — supply and install",
    },
  },
  "san.wc": {
    rule_id: "R-19",
    labour: {
      work_section: "Sanitaryware",
      description: "WC suite supply and install — mid-range",
    },
  },
  "san.basin": {
    rule_id: "R-20",
    labour: {
      work_section: "Sanitaryware",
      description: "Wash basin with mixer — supply and install",
    },
  },
  "san.shower": {
    rule_id: "R-21",
    labour: {
      work_section: "Sanitaryware",
      description: "Shower system — mixer, handset, rain head",
    },
  },
  // P8b: sanitary accessory set — priced directly from the Laspinas quotation
  // lines (supply). Allowance rates (QS to confirm on promotion).
  "san.shattaf": {
    rule_id: "R-40",
    allowance_aed: 250,
    allowance_note: "GROHE shattaf, matt black — Laspinas 46703 line 1025302431 (supply)",
  },
  "san.paper_holder": {
    rule_id: "R-41",
    allowance_aed: 210,
    allowance_note: "GROHE Essentials paper holder, matt black — Laspinas 46703 line 1024652430",
  },
  "san.towel_rail": {
    rule_id: "R-42",
    allowance_aed: 260,
    allowance_note: "GROHE Essentials towel rail, matt black — Laspinas 46703 line 1022512430",
  },
  "san.actuator": {
    rule_id: "R-43",
    allowance_aed: 450,
    allowance_note: "GROHE actuator plate, vertical square — Laspinas 46703 line 38732KF0",
  },
  // P8b: staircase tile — 144×305 slab format, developed tread/riser surface.
  "floor.stair_tile": {
    rule_id: "R-44",
    allowance_aed: 446.45,
    allowance_note: "RAK Surface XL 144×305 slab, list rate — staircase; developed area × C-08 factor; QS to confirm from stair drawing",
  },
  "hvac.fcu_service": {
    rule_id: "R-22",
    labour: {
      work_section: "MEP / HVAC",
      description: "AC servicing and cleaning",
    },
  },
  "join.wardrobe": {
    rule_id: "R-23",
    labour: {
      work_section: "Joinery & Carpentry",
      description: "Built-in wardrobe — mid-range MDF with lacquer or melamine",
    },
  },
  "join.vanity": {
    rule_id: "R-24",
    labour: {
      work_section: "Joinery & Carpentry",
      description: "Vanity cabinet with quartz top — bathroom",
    },
  },
  "join.door": {
    rule_id: "R-25",
    labour: {
      work_section: "Joinery & Carpentry",
      description: "Flush internal door — supply and fit",
    },
  },
  "light.pendant": {
    rule_id: "R-26",
    labour: {
      work_section: "Lighting",
      description: "Decorative pendant — installation labour only",
    },
  },
  "prelim.site_setup": {
    rule_id: "R-27",
    labour: {
      work_section: "Preliminaries",
      description:
        "Site setup, protection, daily clean — residential first-floor refit",
    },
  },
  "prelim.permits": {
    rule_id: "R-28",
    labour: {
      work_section: "Preliminaries",
      description: "Permit and DM/DEWA fees — typical first-floor refit",
    },
  },
  "prelim.skips": {
    rule_id: "R-29",
    labour: {
      work_section: "Preliminaries",
      description: "Skip hire and waste disposal",
    },
  },
  // --- v0.2 rules from Villa 94 validation (docs/QS_PACK_VALIDATION.md) ------
  "ceiling.gypsum": {
    rule_id: "R-30",
    allowance_aed: 125,
    allowance_note:
      "Gypsum false ceiling incl. plastering + painting, AED 125/m² (Villa 94: AED 21k ÷ 130 m² + 120 lm cove). No labour-rates row yet — QS to confirm.",
  },
  "ceiling.led_cove": {
    rule_id: "R-31",
    allowance_aed: 45,
    allowance_note:
      "Continuous cove + recessed LED channel, AED 45/lm labour (strips client-supplied). No labour-rates row yet — QS to confirm.",
  },
  "hvac.ducted_replace": {
    rule_id: "R-32",
    labour: {
      work_section: "MEP / HVAC",
      description: "Concealed ducted AC FCU replacement",
    },
  },
  "hvac.office_split": {
    rule_id: "R-33",
    labour: {
      work_section: "MEP / HVAC",
      description: "Split AC unit (1.5-2.5 ton) — supply and install",
    },
  },
  "terrace.waterproof": {
    rule_id: "R-34",
    allowance_aed: 50,
    allowance_note:
      "Full waterproofing membrane to external terrace, AED 50/m². No labour-rates row yet — QS to confirm.",
  },
  "civil.alterations": {
    rule_id: "R-35",
    allowance_aed: 15000,
    allowance_note:
      "Civil alterations allowance — door-opening closures/openings, new partition walls, storage-room blockwork (Villa 94 §2: AED 15k). Design-dependent; QS to re-measure per project.",
  },
  "stairs.renovation": {
    rule_id: "R-36",
    allowance_aed: 6000,
    allowance_note:
      "Staircase renovation allowance — tread tiling + LED nosing circuit, excl. handrail (Villa 94 §5: AED 6k). QS to confirm.",
  },
  "prelim.floor_protection": {
    rule_id: "R-37",
    allowance_aed: 8,
    allowance_note:
      "Protective floor covering over new tiling until handover, AED 8/m². QS to confirm.",
  },
  "prelim.scaffold": {
    rule_id: "R-38",
    allowance_aed: 2500,
    allowance_note:
      "Rolling scaffold hire for ceiling + painting works, lump. QS to confirm.",
  },
  "prelim.handover_clean": {
    rule_id: "R-39",
    allowance_aed: 1500,
    allowance_note:
      "Final site clearance + professional handover clean, lump. QS to confirm.",
  },
};

// --- P: project-level percentages (rule IDs P-xx) -----------------------------

/** P-01: contingency on subtotal. */
export const CONTINGENCY_PCT = 8;
/** P-02: UAE VAT, applied to subtotal + contingency. */
export const VAT_PCT = 5;

// --- Room classification -------------------------------------------------------

export const BEDROOM_TYPES = new Set(["master_bedroom", "bedroom"]);
export const BATHROOM_TYPES = new Set(["bathroom", "ensuite"]);
/** External rooms — tiled + skirted but no paint/ceiling/electrical counts. */
export const EXTERNAL_TYPES = new Set(["terrace", "balcony"]);
/** Rooms keeping an existing FCU that gets a deep service (F-15: secondary
 *  bedrooms get full ducted replacements instead — see hvac.ducted_replace). */
export const HVAC_SERVICE_TYPES = new Set([
  "master_bedroom",
  "living",
  "dining",
  "majlis",
  "kitchen",
]);

export type SectionOrder = Record<PomiSection, number>;
export const SECTION_ORDER: readonly PomiSection[] = [
  "Demolition",
  "Blockwork",
  "Plaster",
  "Floor Finishes",
  "Wall Finishes",
  "Ceilings",
  "Decoration & Painting",
  "Joinery & Carpentry",
  "Electrical",
  "Plumbing",
  "Sanitaryware",
  "MEP / HVAC",
  "Lighting",
  "Preliminaries",
];
