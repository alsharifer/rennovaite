// =============================================================================
// lib/boq/rules.ts — every constant, factor, and mapping the deterministic
// BoQ engine uses, in one place, each with a rule ID.
//
// THIS FILE IS THE QS REVIEW SURFACE. When the quantity surveyor corrects a
// wastage factor, a measurement convention, or a rate mapping, the change is
// made here (and only here). docs/QS_REVIEW_PACK.md is generated from these
// tables by scripts/boq-example.ts.
// =============================================================================

import { POMI_SECTIONS, type PomiSection, type Tier } from "./schema";
import { CANONICAL_SECTION_ORDER } from "./section-order";

// v0.2.0 — calibrated against the real Villa 94 (Al Naseem F2, Mudon) signed
// scope of work, tile BoQ, sanitary quotation, and Rev-00 shop drawings.
// See docs/QS_PACK_VALIDATION.md for the full derivation of each correction.
//
// v0.3.0 (H7) — 2-dp rates at resolution, line totals round(qty × rate, 2),
// contingency and VAT to the fils, the canonical section order. A revision
// diff across 0.2.0 → 0.3.0 names that as the cause of the fils it moves.
export const ENGINE_VERSION = "0.3.0";

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
    allowance_note: "GROHE shattaf, matt black — sanitaryware supplier (supply)",
  },
  "san.paper_holder": {
    rule_id: "R-41",
    allowance_aed: 210,
    allowance_note: "GROHE Essentials paper holder, matt black — sanitaryware supplier",
  },
  "san.towel_rail": {
    rule_id: "R-42",
    allowance_aed: 260,
    allowance_note: "GROHE Essentials towel rail, matt black — sanitaryware supplier",
  },
  "san.actuator": {
    rule_id: "R-43",
    allowance_aed: 450,
    allowance_note: "GROHE actuator plate, vertical square — sanitaryware supplier",
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
      "Gypsum false ceiling incl. plastering + painting, AED 125/m² (reference project: AED 21k ÷ 130 m² + 120 lm cove). No labour-rates row yet — QS to confirm.",
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
      "Civil alterations allowance — door-opening closures/openings, new partition walls, storage-room blockwork (reference project §2: AED 15k). Design-dependent; QS to re-measure per project.",
  },
  "stairs.renovation": {
    rule_id: "R-36",
    allowance_aed: 6000,
    allowance_note:
      "Staircase renovation allowance — LABOUR ONLY: tread/riser preparation, tile fixing labour and LED nosing circuit, excl. handrail (reference project §5: AED 6k). " +
      "Delta Log G15 (\"Only labor\") confirms the reference project's staircase line carried no material. The tile MATERIAL comes solely from Q-11b/R-44 floor.stair_tile — this note previously read \"tread tiling\", which would have described the same material twice. Rate unchanged. QS to confirm.",
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

  // --- S6-pre: components Newspace's scoping left out (Delta Log column G) ---
  //
  // Every rate below is INDICATIVE. None is a Villa 94 transaction — that is
  // the whole point of column G, these components were never quoted — so each
  // carries its reasoning and expects to be overwritten by Friday's QS column.

  "light.led_strip": {
    rule_id: "R-45",
    allowance_aed: 85,
    allowance_note:
      "G10 — cove LED strip SUPPLY, AED 85/lm indicative (24V 14.4W/m COB strip + driver + profile, Dubai trade counter mid-2026). Complements R-31, which prices the cove LABOUR at 45/lm and explicitly assumes 'strips client-supplied' — this is the material that assumption left out. QS to confirm.",
  },
  "join.vanity_slab": {
    rule_id: "R-46",
    allowance_aed: 1450,
    allowance_note:
      "G19 — vanity counter slab, AED 1,450/no ALLOWANCE (engineered quartz ~1.5 lm incl. cut-out, edge and fixing). The client-supplied tile package excludes these. Dimensions unknown, so this is an allowance requiring site measurement, deliberately NOT folded into tile area. QS to confirm.",
  },
  "alum.shower_glass": {
    rule_id: "R-47",
    allowance_aed: 2200,
    allowance_note:
      "G21 — frameless 10mm tempered shower partition, AED 2,200/no indicative (Dubai supply+install, typical 900-1200mm screen). Excluded from the aluminium & glazing reference package. QS to confirm.",
  },
  "alum.mirror": {
    rule_id: "R-48",
    allowance_aed: 650,
    allowance_note:
      "G21 — bathroom mirror, AED 650/no indicative (5mm silvered, polished edge, concealed fixing, ~900x700). Excluded from the aluminum package; the sanitary accessory set carries no mirror either. QS to confirm.",
  },

  // --- B5: the wet-room package (one bathroom from its dimensions) -----------
  //
  // Lines a QS expects for a bathroom refit that the villa engine never priced.
  // No transaction backs any of these: each is an ALLOWANCE with its reasoning,
  // QS to confirm. Where a market or Mudon-calibrated rate exists the package
  // reuses that rule instead (R-01/02/03 strip-out, R-05 screed, R-13 paint,
  // R-18 drain, R-19/20/21 sanitaryware, R-31/R-45 cove, R-40–43 accessories).
  "prelim.room_protection": {
    rule_id: "R-49",
    allowance_aed: 1200,
    allowance_note:
      "B5 — protection of the access route + dust screens, daily clean, ONE room in an occupied home, AED 1,200 lump allowance. R-27 (12,000) is a whole first-floor refit. QS to confirm.",
  },
  "prelim.room_clean": {
    rule_id: "R-51",
    allowance_aed: 400,
    allowance_note: "B5 — final clean of one room and its access route, AED 400 lump allowance (R-39 is 1,500 for a whole floor). QS to confirm.",
  },
  "demo.shower_screen": {
    rule_id: "R-52",
    allowance_aed: 250,
    allowance_note: "B5 — take down + dispose of the existing shower screen and its fixings, AED 250 per screen allowance. QS to confirm.",
  },
  "demo.ceiling_strip": {
    rule_id: "R-53",
    allowance_aed: 25,
    allowance_note: "B5 — strip the damaged ceiling finish (flaking paint, failed skim) back to sound plaster, AED 25/m² allowance. QS to confirm.",
  },
  "ceiling.repair": {
    rule_id: "R-54",
    allowance_aed: 45,
    allowance_note:
      "B5 — ceiling repair: fungicidal wash, stain-block primer, skim to a paint finish, AED 45/m² ALLOWANCE until the cause of the water damage is known (a leak from above is a different job). QS to confirm.",
  },
  "wp.membrane": {
    rule_id: "R-55",
    allowance_aed: 50,
    allowance_note:
      "B5 — liquid-applied waterproofing membrane, 2 coats with reinforcing tape at corners, upstands and drains, AED 50/m² (as the terrace membrane R-34). QS to confirm.",
  },
  "wall.shower_niche": {
    rule_id: "R-56",
    allowance_aed: 950,
    allowance_note: "B5 — recessed shower niche ~600 × 300: forming, waterproofing, tiling and an LED strip, AED 950 per niche allowance. QS to confirm.",
  },
  "san.wc_floor": {
    rule_id: "R-57",
    allowance_aed: 1600,
    allowance_note:
      "B5 — floor-standing close-coupled rimless WC, supply + install at the existing soil position, AED 1,600 allowance. R-19 (2,400) is the market band for a WC suite and was used for the reference villa's wall-hung WCs with concealed cisterns — the option prices that. QS to confirm.",
  },
  "san.bidet": {
    rule_id: "R-58",
    allowance_aed: 1400,
    allowance_note: "B5 — floor-standing bidet with mixer, supply + install at the existing position, AED 1,400 allowance. QS to confirm.",
  },
  "alum.mirror_backlit": {
    rule_id: "R-59",
    allowance_aed: 1400,
    allowance_note: "B5 — backlit LED mirror ~700 mm, round or pill, demister, supply + install, AED 1,400 allowance (R-48 is a plain 650 mirror). QS to confirm.",
  },
  "elec.shaver": {
    rule_id: "R-60",
    allowance_aed: 250,
    allowance_note: "B5 — shaver supply unit (BS EN 61558 isolating) by the mirror, supply + install, AED 250 allowance. QS to confirm.",
  },
  "elec.extractor": {
    rule_id: "R-61",
    allowance_aed: 650,
    allowance_note: "B5 — ceiling extractor fan with run-on timer / humidistat and isolator, ducted to the existing outlet, AED 650 allowance. QS to confirm the duct route.",
  },
  "plumb.heater_box": {
    rule_id: "R-62",
    allowance_aed: 900,
    allowance_note: "B5 — box in the retained water heater (MR board on frame, access panel, tiled or painted to match), or relocate it locally, AED 900 allowance. QS to confirm on site.",
  },
  "san.wc_duct_wall": {
    rule_id: "R-63",
    allowance_aed: 1200,
    allowance_note: "B5 option — duct wall for a wall-hung WC: MR board on the concealed-cistern frame, waterproofed and tiled, ~1.2 m wide, AED 1,200 allowance. QS to confirm.",
  },
  "ceiling.bulkhead_removal": {
    rule_id: "R-64",
    allowance_aed: 1100,
    allowance_note: "B5 option — take down the curved plaster bulkhead over the shower, make good to a flat ceiling, re-site its downlight, AED 1,100 lump allowance; check what it conceals first. QS to confirm.",
  },
  // --- Client comments (19 Oct): a storage cabinet for the bidet, and the
  // value-engineered choices a wet room can take (rooms.spec.wet_room). Each
  // is a SPEC change at its own allowance — no existing rate is cut.
  "joinery.storage_cabinet": {
    rule_id: "R-66",
    allowance_aed: 750,
    allowance_note: "White floor-standing storage cabinet ~400 × 450 × 850, moisture-resistant carcass, one door + shelves, supply + install, AED 750 allowance. QS to confirm.",
  },
  "alum.shower_panel_fixed": {
    rule_id: "R-67",
    allowance_aed: 2000,
    allowance_note: "Fixed walk-in glass panel, 10 mm clear toughened, up to ~1.4 m, wall profile + stay bar, brushed-brass fittings, supply + install, AED 2,000 allowance (the hinged 2-panel enclosure is 2 × 2,200, R-47). QS to confirm.",
  },
  "san.shower_manual": {
    rule_id: "R-68",
    allowance_aed: 2200,
    allowance_note: "Concealed manual shower mixer with diverter, rain head + hand shower, brushed brass, supply + install at the existing position, AED 2,200 allowance (thermostatic set R-21 is 3,500). QS to confirm.",
  },
  "joinery.vanity_ready": {
    rule_id: "R-69",
    allowance_aed: 2000,
    allowance_note: "Ready-made wall-hung vanity unit ~800–900 mm, two drawers, integrated ceramic basin top, supply + install, AED 2,000 allowance (the floating unit + stone top is 1,800 + 1,450). QS to confirm.",
  },
  "san.basin_mixer_mid": {
    rule_id: "R-70",
    allowance_aed: 600,
    allowance_note: "Basin mixer, mid-range, brushed brass, supply + install on the vanity's own basin, AED 600 allowance (R-20's 1,800 includes a separate basin). QS to confirm.",
  },
  "san.wc_floor_mid": {
    rule_id: "R-71",
    allowance_aed: 1200,
    allowance_note: "Floor-standing close-coupled WC, mid-range, supply + install at the existing soil position, AED 1,200 allowance (R-57 is 1,600). QS to confirm.",
  },
  "alum.mirror_led_mid": {
    rule_id: "R-72",
    allowance_aed: 900,
    allowance_note: "LED-lit mirror ~700 mm, mid-range, no demister, supply + install, AED 900 allowance (R-59 is 1,400). QS to confirm.",
  },
  "prelim.waste_bagged": {
    rule_id: "R-73",
    allowance_aed: 600,
    allowance_note: "Strip-out waste of ONE room bagged and carried out by hand, carted away, AED 600 lump allowance — instead of a skip (R-29, 1,500). Check the community allows it. QS to confirm.",
  },
  "wall.shower_niche_plain": {
    rule_id: "R-74",
    allowance_aed: 600,
    allowance_note: "Recessed shower niche ~600 × 300, formed, waterproofed, tiled — no LED strip, AED 600 allowance (R-56 with the LED is 950). QS to confirm.",
  },
  "san.bath": {
    rule_id: "R-65",
    labour: {
      work_section: "Sanitaryware",
      description: "Bathtub — supply and install",
    },
  },
};

// --- P: project-level percentages (rule IDs P-xx) -----------------------------

/** P-01: contingency on subtotal. */
export const CONTINGENCY_PCT = 8;
/** P-02: UAE VAT, applied to subtotal + contingency. */
export const VAT_PCT = 5;

// --- Room classification -------------------------------------------------------

export const BEDROOM_TYPES = new Set(["master_bedroom", "bedroom"]);
// Powder rooms are full wet rooms here: Villa 94 fitted all three (bath, ensuite,
// powder) with WC + basin + shower + accessories. Aligns the engine with the P4
// quantify wet-room set (which already tiled powder).
export const BATHROOM_TYPES = new Set(["bathroom", "ensuite", "powder"]);
/** External rooms — tiled + skirted but no paint/ceiling/electrical counts.
 *  Enclosed and roofed-adjacent: a terrace is a room of the villa. Outdoor
 *  garden zones are NOT here — see LANDSCAPE_TYPES. */
export const EXTERNAL_TYPES = new Set(["terrace", "balcony"]);

/**
 * Garden-pilot outdoor zones (G1). Mirrors OUTDOOR_ROOM_TYPES in
 * lib/plan/zones.ts; duplicated as a plain Set here so the pricing engine keeps
 * zero imports from the plan layer, matching every other classification above.
 *
 * These are excluded from BOTH the interior buckets and the external/terrace
 * ones. Folding a lawn into EXTERNAL_TYPES would have priced it as waterproofed
 * porcelain — the tidy-looking change and the wrong one. Landscape quantities
 * are their own rule set, arriving with the Villa 94 rate calibration (G2);
 * until then a drawn garden reports its area and prices nothing, which is a
 * visible gap rather than a silent wrong number.
 */
export const LANDSCAPE_TYPES = new Set([
  "paving",
  "artificial_grass",
  "planting_bed",
  "deck",
  "path",
  "structure",
  "pool",
]);
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
// H7: the engine's sections in THE canonical order (lib/boq/section-order.ts,
// Preliminaries first) — the POMI sections the engine and garden take-off can
// emit. It used to be its own list, with Preliminaries 14th.
export const SECTION_ORDER: readonly PomiSection[] = CANONICAL_SECTION_ORDER.filter((s): s is PomiSection =>
  (POMI_SECTIONS as readonly string[]).includes(s),
);
