// =============================================================================
// Parse eval fixture #2 — ground truth for the Mudon first-floor CAD sheet.
//
// SOURCE DOCUMENT
//   "Original FIRST FLOOR PLAN LAYOUT.pdf"
//   sha256 32555c4f031c0ffb98a2cf4e8cae36d3de148d693963be1c86ba1b608e639a7f
//   1,385,107 bytes · 1 page · media box 1684 x 1191 pt = 594.1 x 420.2 mm (A2)
//   Arif & Bintoak, "MUDON PHASE II (120 TOWN HOUSES)", drawing SPML/MDN/A DT 302
//   rev AB00, AS BUILT, drawn 20-09-2016, title block states "1:100 @ A2".
//
//   The binary is NOT committed: `/data/` is gitignored because these are real
//   client construction drawings whose title blocks carry client and contractor
//   names (see .gitignore — "the code-shaped source of truth lives in lib/,
//   not the raw workbook"). Keep the PDF at `data/eval-plans/<name>.pdf`; the
//   sha256 above identifies it. Every number below is transcribed from the
//   sheet, so this file is self-sufficient for the eval.
//
//   NOTE: this file is byte-identical to `assets/villa-plan-first-floor.pdf`,
//   the canonical pilot plan behind `lib/plan/__tests__/mudon.fixture.ts`
//   (eval fixture #1). Fixture #2 is therefore not a second building — it is
//   the ground truth the first fixture never had. Both parses are scored
//   against this one table.
//
// GROUND TRUTH PROVENANCE
//   Room tags (F01…F13), room names and the NNNNxNNNN room dimension labels are
//   read from the PDF's own text layer with coordinates — they are what the CAD
//   author typed, not an interpretation. Areas are width x height / 1e6 from
//   those labels. Five rooms (F05, F07, F11, F12, F13) carry no printed
//   dimension on the sheet, so their area is `null` and they are scored for
//   presence only, never for area.
//
//   The dimension CHAINS along the grid (2725 / 1520 / 4470 / 19910 …) are NOT
//   in the text layer — the CAD export drew those digits as vector strokes. So
//   they cannot be transcribed mechanically and are not part of this table.
// =============================================================================

export interface GroundTruthRoom {
  /** Room tag as printed on the sheet, e.g. "F01". */
  tag: string;
  /** Room name as printed, upper case on the sheet. */
  name: string;
  /** [width, height] in mm exactly as the NNNNxNNNN label reads, or null when
   *  the sheet prints no dimension for this room. */
  dim_mm: [number, number] | null;
  /** Area in m² derived from `dim_mm`; null when undimensioned. */
  area_m2: number | null;
  /** Centre of the tag box in PDF points on the A2 sheet (origin top-left). */
  label_pt: [number, number];
  /** Lower-case substrings that identify this room in a parse's `name_en`. */
  names: string[];
  /** Canonical room_type tokens acceptable for this room; used to break ties
   *  when two rooms share a name (the two "BATH"s). */
  types?: string[];
  /** Rooms that cannot be told apart by name are scored as a group: presence
   *  is counted, area never is (no group member has a printed dimension). */
  group?: string;
}

export const MUDON_SHEET = {
  file: "data/eval-plans/Original FIRST FLOOR PLAN LAYOUT.pdf",
  sha256: "32555c4f031c0ffb98a2cf4e8cae36d3de148d693963be1c86ba1b608e639a7f",
  bytes: 1_385_107,
  page_size_pt: [1684, 1191] as [number, number],
  page_size_mm: [594.1, 420.2] as [number, number],
  sheet_format: "A2",
  scale: "1:100",
  /** 1 pt on the sheet = this many mm of building at 1:100. */
  mm_per_pt: (25.4 / 72) * 100,
  drawing_no: "SPML/MDN/A DT 302",
  revision: "AB00",
  unit: "MU.F02.094",
  /** Where the plan itself sits on the sheet, in PDF points — the rest is
   *  title block (x >= 1404), key plan (top right) and the 6-villa cluster
   *  thumbnail (x 912..1344, y 96..228). Measured, not estimated. */
  plan_region_pt: [384, 108, 900, 1092] as [number, number, number, number],
} as const;

export const MUDON_GROUND_TRUTH: GroundTruthRoom[] = [
  { tag: "F01", name: "FAMILY AREA",    dim_mm: [3325, 3770], area_m2: 12.54, label_pt: [705.0, 608.5], names: ["family"] },
  { tag: "F02", name: "MASTER BEDROOM", dim_mm: [3985, 5000], area_m2: 19.93, label_pt: [573.0, 520.5], names: ["master bed"] },
  { tag: "F03", name: "DRESS",          dim_mm: [2585, 1800], area_m2: 4.65,  label_pt: [573.0, 637.5], names: ["dress", "closet", "wardrobe"] },
  { tag: "F04", name: "BATH",           dim_mm: [2585, 3400], area_m2: 8.79,  label_pt: [571.0, 714.5], names: ["bath"], types: ["ensuite"] },
  { tag: "F05", name: "PASSAGE",        dim_mm: null,         area_m2: null,  label_pt: [774.0, 612.5], names: ["passage", "corridor", "hall"] },
  { tag: "F06", name: "BEDROOM 3",      dim_mm: [4000, 4200], area_m2: 16.8,  label_pt: [818.0, 457.5], names: ["bedroom 3", "bedroom-3"] },
  { tag: "F07", name: "TERRACE",        dim_mm: null,         area_m2: null,  label_pt: [812.0, 404.5], names: ["terrace"], group: "terrace" },
  { tag: "F08", name: "BATH",           dim_mm: [2700, 1750], area_m2: 4.72,  label_pt: [823.0, 530.5], names: ["bath"], types: ["bathroom"] },
  { tag: "F09", name: "TOILET",         dim_mm: [2000, 1350], area_m2: 2.7,   label_pt: [811.0, 686.5], names: ["toilet", "powder", "wc"] },
  { tag: "F10", name: "BEDROOM-4",      dim_mm: [4000, 4800], area_m2: 19.2,  label_pt: [813.0, 758.5], names: ["bedroom 4", "bedroom-4"] },
  { tag: "F11", name: "F-BALCONY",      dim_mm: null,         area_m2: null,  label_pt: [815.0, 811.0], names: ["balcony"], group: "balcony" },
  { tag: "F12", name: "TERRACE",        dim_mm: null,         area_m2: null,  label_pt: [641.0, 852.5], names: ["terrace"], group: "terrace" },
  { tag: "F13", name: "F-BALCONY",      dim_mm: null,         area_m2: null,  label_pt: [585.0, 437.5], names: ["balcony"], group: "balcony" },
];

/** The stair run is drawn and labelled "DN" but carries no F-tag, so a parse
 *  that reports it is neither right nor wrong. Scored as "expected extra". */
export const MUDON_UNTAGGED_SPACES = ["stairs", "stair", "wardrobe", "niche"];

/** Sum of the eight rooms the sheet actually dimensions. Not the floor area of
 *  the unit — five rooms are undimensioned — so never compare it to a parse's
 *  `total_area_m2`. */
export const MUDON_DIMENSIONED_AREA_M2 = 89.33;
