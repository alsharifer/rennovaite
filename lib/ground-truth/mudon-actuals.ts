// =============================================================================
// lib/ground-truth/mudon-actuals.ts — Mudon Villa 94 contract + quotation actuals.
//
// SOURCE OF TRUTH. Every figure here is transcribed programmatically from
// data/ground-truth/Mudon_Villa94_Ground_Truth_and_Delta_Log.xlsx (parsed via
// unzip + the sheet XML — NOT retyped from any prompt). Sheet + document refs
// are cited per record. This module is consumed by:
//   - scripts/seed-rate-book-actuals.ts  (Step 2 rate reseed)
//   - lib/boq/joinery-aluminum.ts         (Step 4 new sections)
//   - the boq_outcomes record             (Step 6 delta log)
//   - kg/seed/nodes/mudon_actuals.json    (Step 5 KG slice — kept in sync)
//
// All AED, excl. VAT unless noted. Discounts are RELATIONSHIP PRICING and are
// recorded separately from gross values (per the Delta Log guidance: judge
// market fairness on pre-discount section values).
// =============================================================================

export const MUDON_M2 = 178.5; // platform parse, first floor
export const TILE_NET_FACTOR = 0.6; // RAK cart: effective net = 60% of list (40% off)

export type Scope = "supply_only" | "install_only" | "supply_and_install";
export type Provenance = "seed" | "indicative" | "actual_transaction";

// --- Trade totals (Summary sheet) --------------------------------------------
export const TRADE_TOTALS = {
  labour: { excl_vat: 200_000, incl_vat: 210_000, discount_aed: 36_500, discount_pct: 0.154, gross: 236_500, source: "SOW AlNaseem F2 V94 (ref SOW-R02, 21 Jun 2026)" },
  tiles: { excl_vat: 39_263.9436, incl_vat: 41_227.14078, discount_pct: 0.4, source: "RAK cart 0000160602, 15 Jul 2026" },
  joinery: { excl_vat: 70_090.56, incl_vat: 73_595.088, discount_pct: 0.04, source: "Atrium QTN20261407, 14 Jul 2026" },
  aluminum: { excl_vat: 92_449, incl_vat: 97_071.45, discount_pct: 0, source: "Global Creation ref 3936/R1, 17 Jul 2026" },
  sanitary: { excl_vat: 14_925, incl_vat: 15_671.24, discount_aed: 240, source: "Laspinas quotation 46703, 13 Jun 2026" },
  project_total_excl_vat: 416_728.5036,
  per_m2_excl_vat: 2_334.61,
} as const;

// --- Labour & works contract — Newspace (Labour SOW sheet) -------------------
// 14 sections, GROSS (pre-discount) values. The AED 36,500 discount applies at
// CONTRACT level, not per section (Delta Log note) — do not distribute it.
export const LABOUR_SECTIONS: { section: string; gross_aed: number; note?: string }[] = [
  { section: "Mobilisation & Site Setup", gross_aed: 10_500 },
  { section: "Waste Management & Site Clearance", gross_aed: 17_000 },
  { section: "Demolition & Strip-Out", gross_aed: 22_500 },
  { section: "Civil Works", gross_aed: 15_000 },
  { section: "Flooring Works", gross_aed: 30_500, note: "Labour only — tiles by client (install_only counterpart to tile supply)" },
  { section: "Ceilings & Lighting", gross_aed: 21_000, note: "Fittings by client" },
  { section: "Painting Works", gross_aed: 21_500 },
  { section: "Sanitary & Plumbing", gross_aed: 20_000, note: "Fixtures by client (install_only counterpart to sanitary supply)" },
  { section: "Electrical Works", gross_aed: 25_000, note: "Sockets/switches by client" },
  { section: "HVAC Works", gross_aed: 31_500 },
  { section: "Staircase Renovation", gross_aed: 6_000, note: "Excl. handrail" },
  { section: "Office Build-Out", gross_aed: 0, note: "Covered within the aluminum & glass quotation (Global Creation)" },
  { section: "Terrace Balcony", gross_aed: 6_000 },
  { section: "Master Bathroom (built-in unit & partition)", gross_aed: 10_000 },
];
export const LABOUR_GROSS = 236_500;
export const LABOUR_DISCOUNT = -36_500;
export const LABOUR_NET = 200_000;

// --- Tiles & slabs — RAK (Tiles sheet) — SUPPLY ONLY -------------------------
// list_rate = cart list AED/m²; net = list × 0.60. Installation is the labour
// contract's "Flooring Works" (install_only), so these NEVER get an added
// install line in BoQ assembly.
export const TILES: {
  sku: string; desc: string; allocation: string; qty_m2: number; list_rate: number;
  // which what-if grade cell (if any) this SKU represents — used to map actuals
  // onto floor_finish / wet_tiling grades; null = SKU-only rate_book row.
  maps_to: { item_key: "floor_finish" | "wet_tiling"; grade: "economy" | "standard" | "premium" } | null;
}[] = [
  { sku: "A22GZSFX-OWH", desc: "Surface XL Off-White RT 120×120 TH9", allocation: "Main flooring + all bedrooms", qty_m2: 158.4, list_rate: 181, maps_to: { item_key: "floor_finish", grade: "standard" } },
  { sku: "A4MGZSFX-OWH", desc: "Surface XL Off-White UR slab 144×305 TH14", allocation: "Staircase (slab size)", qty_m2: 35.12, list_rate: 446.45, maps_to: { item_key: "floor_finish", grade: "premium" } },
  { sku: "A4MGPNTO-IVO", desc: "Pontino Ivory UR slab 144×305 TH14", allocation: "Master bath behind vanity + counter", qty_m2: 17.56, list_rate: 446.45, maps_to: { item_key: "wet_tiling", grade: "premium" } },
  { sku: "A12GPNTO-IVO", desc: "Pontino Ivory RT 60×120 TH9", allocation: "Master bath floor + other walls", qty_m2: 28.08, list_rate: 141, maps_to: { item_key: "wet_tiling", grade: "standard" } },
  { sku: "A22GTRRA-IVO", desc: "Terra Ivory MAT LS RT 120×120 TH9", allocation: "Kids 1 & Kids 2 wall + floor (except brick wall)", qty_m2: 40.32, list_rate: 217, maps_to: null },
  { sku: "A42WPTFN-GRE", desc: "Portofino Green LS high-glossy 6.5×26", allocation: "Kids 1 brick wall (mix)", qty_m2: 1.4, list_rate: 86, maps_to: null },
  { sku: "A42WPTFN-BLE", desc: "Portofino Blue LS high-glossy 6.5×26", allocation: "Kids 1 brick wall (mix)", qty_m2: 0.7, list_rate: 86, maps_to: null },
  { sku: "A42WPTFN-OCN", desc: "Portofino Ocean LS high-glossy 6.5×26", allocation: "Kids 1 brick wall (mix)", qty_m2: 0.7, list_rate: 86, maps_to: null },
  { sku: "A42WPTFN-WHE", desc: "Portofino White LS high-glossy 6.5×26", allocation: "Kids 2 brick wall", qty_m2: 3.5, list_rate: 86, maps_to: null },
];

// --- Joinery — Atrium (Joinery sheet) — SUPPLY & INSTALL composites ----------
// Specialist subcontractor prices with NO corresponding labour section, so a
// line priced from these NEVER receives an added install line.
export const JOINERY: { ref: string; desc: string; rate: number; qty: number; unit: "SQM" | "ITEM"; item_key: string }[] = [
  { ref: "1.1", desc: "Master BR dresser cabinet, glass doors, incl. LED (shiba oak)", rate: 1_100, qty: 10.08, unit: "SQM", item_key: "joinery_dresser" },
  { ref: "1.2", desc: "Master BR wall cladding on bed wall with hidden LED", rate: 800, qty: 6.16, unit: "SQM", item_key: "joinery_cladding" },
  { ref: "1.3", desc: "Master BR bath cabinet (3 doors) with shelves, MR melamine", rate: 2_200, qty: 1, unit: "ITEM", item_key: "joinery_bath_cabinet_3d" },
  { ref: "1.4", desc: "Master BR bath cabinet (2 doors), MR melamine", rate: 2_400, qty: 1, unit: "ITEM", item_key: "joinery_bath_cabinet_2d" },
  { ref: "1.5", desc: "Master BR vanity box with shelf, MR melamine, LED (160×60)", rate: 2_600, qty: 1, unit: "ITEM", item_key: "joinery_vanity_master" },
  { ref: "2.1", desc: "Kids BR1 cabinet box with doors, melamine MDF + architrave", rate: 850, qty: 7, unit: "SQM", item_key: "joinery_cabinet" },
  { ref: "2.2", desc: "Kids BR1 bath cabinet with doors (×3), MR melamine", rate: 2_400, qty: 1, unit: "ITEM", item_key: "joinery_bath_cabinet_2d" },
  { ref: "2.3", desc: "Kids BR1 vanity box with drawer, MR melamine", rate: 1_800, qty: 1, unit: "ITEM", item_key: "joinery_vanity" },
  { ref: "3.1", desc: "Kids Bath2 cabinet box with doors, melamine MDF", rate: 850, qty: 6.3, unit: "SQM", item_key: "joinery_cabinet" },
  { ref: "3.2", desc: "Kids Bath2 bath cabinet (2 doors), MR melamine", rate: 2_400, qty: 1, unit: "ITEM", item_key: "joinery_bath_cabinet_2d" },
  { ref: "3.3", desc: "Kids Bath2 vanity box with drawer, MR melamine", rate: 1_800, qty: 1, unit: "ITEM", item_key: "joinery_vanity" },
  { ref: "4.1", desc: "Stair cabinet box with doors, melamine MDF (166×280)", rate: 850, qty: 5.4, unit: "SQM", item_key: "joinery_cabinet" },
  { ref: "5.1", desc: "New door w/o frame, half solid, new handle + hinges", rate: 2_700, qty: 6, unit: "SQM", item_key: "joinery_door_leaf" },
  { ref: "5.2", desc: "New door frame, full solid meranti, full paint + fixing", rate: 1_550, qty: 6, unit: "SQM", item_key: "joinery_door_frame" },
];
export const JOINERY_GROSS = 73_011;

// --- Aluminum & glass — Global Creation (Aluminum sheet) — ALLOWANCE ---------
// The plan graph has NO openings, so per-opening pricing is impossible today.
// Each line is a room-scoped ALLOWANCE flagged site_assessment. Line totals are
// lump amounts (no unit-rate split in the quote). Never present as measured qty.
export const ALUMINUM_ALLOWANCE_CAVEAT = "Requires site measurement — allowance only";
export const ALUMINUM: { item: string; location: string; qty: number; unit: "Nos" | "LM"; total: number }[] = [
  { item: "Thermal-break hinged door + curved fixed DG glass, 700×2650", location: "Guest bedroom", qty: 2, unit: "Nos", total: 10_300 },
  { item: "Thermal-break hinged door + curved fixed DG glass, 700×2650", location: "Master bedroom", qty: 2, unit: "Nos", total: 10_300 },
  { item: "Tilt & turn system DG, 950×950", location: "Master bathroom", qty: 1, unit: "Nos", total: 3_000 },
  { item: "Thermal-break sliding system DG, 1850×2460", location: "Kids bedroom", qty: 1, unit: "Nos", total: 12_040 },
  { item: "Thermal-break sliding system DG, 1700×2300", location: "Office", qty: 1, unit: "Nos", total: 10_384 },
  { item: "Thermal-break sliding system DG, 1830×3000", location: "Office", qty: 1, unit: "Nos", total: 14_176 },
  { item: "Skylight DG, 1830×3750", location: "Living area", qty: 1, unit: "Nos", total: 15_749 },
  { item: "Shaped glass balustrade 12mm tinted bronze", location: "G.F–F.F stair", qty: 10, unit: "LM", total: 16_500 },
];

// --- Sanitary — Laspinas (Sanitary sheet) — SUPPLY ONLY ---------------------
// Installation is the labour contract's "Sanitary & Plumbing" (install_only).
export const SANITARY: { code: string; desc: string; qty: number; unit_price: number }[] = [
  { code: "4-GROHE-3877200F", desc: "GROHE WC set Rapid SL 1.13m, chrome", qty: 3, unit_price: 525 },
  { code: "39328I0H", desc: "GROHE Euro Ceramic wall-hung WC", qty: 3, unit_price: 850 },
  { code: "1025302431", desc: "GROHE shattaf, matt black", qty: 3, unit_price: 250 },
  { code: "332652433", desc: "GROHE Eurosmart basin mixer", qty: 4, unit_price: 400 },
  { code: "1053362430", desc: "GROHE concealed shower Tempesta 250, matt black", qty: 3, unit_price: 1_750 },
  { code: "CA0290061W", desc: "Claytan wash basin, square", qty: 2, unit_price: 340 },
  { code: "1024652430", desc: "GROHE Essentials paper holder, matt black", qty: 3, unit_price: 210 },
  { code: "1022512430", desc: "GROHE Essentials towel rail, matt black", qty: 3, unit_price: 260 },
  { code: "38732KF0", desc: "GROHE actuator plate, vertical square", qty: 3, unit_price: 450 },
];

// --- Rate Calibration corrections (Rate Calibration sheet) ------------------
// Explicit seed-vs-actual corrections the workbook documents.
export const RATE_CALIBRATION: { label: string; seed: number; list: number | null; net: number; note: string }[] = [
  { label: "RAK Surface XL Off-White 120×120 (AED/m²)", seed: 281, list: 181, net: 108.6, note: "Seed ~2.6× achieved net; even list is below seed" },
  { label: "RAK Terra Ivory 120×120 (AED/m²)", seed: 155, list: 217, net: 130.2, note: "Seed below list but above net" },
  { label: "RAK Pontino Ivory 60×120 (AED/m²)", seed: 281, list: 141, net: 84.6, note: "Seed dramatically high vs 84.60 net" },
  { label: "RAK Pontino Ivory slab 144×305 (AED/m²)", seed: 446.45, list: 446.45, net: 267.87, note: "Slab format absent from seed — add" },
  { label: "RAK Portofino mosaics (AED/m²)", seed: 86, list: 86, net: 51.6, note: "Seed = list; net is 51.60" },
  { label: "GROHE wall-hung WC (AED)", seed: 900, list: 850, net: 850, note: "Close; model 39328I0H" },
  { label: "GROHE basin mixer (AED)", seed: 675, list: 400, net: 400, note: "Seed was Eurocube 675; actual is Eurosmart 400 — grade mapping, not a rate gap" },
  { label: "GROHE shower set (AED)", seed: 500, list: 1_750, net: 1_750, note: "Seed was exposed Tempesta 500; actual is CONCEALED Tempesta 250 @ 1,750 — spec-class mismatch" },
];

// Net rate helper: cart net = list × 0.60, rounded to fils.
export const netRate = (list: number): number => Math.round(list * TILE_NET_FACTOR * 100) / 100;
