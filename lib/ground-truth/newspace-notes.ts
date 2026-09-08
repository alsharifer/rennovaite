// =============================================================================
// lib/ground-truth/newspace-notes.ts — Newspace's own scoping gaps (S6-pre).
//
// Abdallah annotated column G of the Delta Log sheet in
// `QS Package/Mudon_Villa94_Ground_Truth_and_Delta_Log.xlsx` with components the
// CONTRACTOR's initial scoping left out. Every note is transcribed here verbatim
// so the platform reasons from what was said, not from a paraphrase of it.
//
// Read this the right way round. These notes say what the Villa 94 CONTRACT
// excluded — they are not a list of things the platform is missing. Several are
// already priced by R-xx rules (spotlights R-14, sockets R-15, water heaters
// R-17), and for those the note is evidence the platform is RIGHT to price them
// and the labour contract was the incomplete document. Treating every note as a
// missing feature would have double-counted three components.
//
// Pure data. Nothing here prices anything.
// =============================================================================

/** How a note was resolved once checked against the engine. */
export type NoteDisposition =
  /** Platform already prices it; the note confirms the contract gap, not ours. */
  | "already_priced"
  /** Genuinely absent from the platform — needs a new rule or catalog item. */
  | "gap_to_fill"
  /** Not a rule at all: a record, a pre-signal, or a scope clarification. */
  | "record_only";

export interface NewspaceNote {
  /** Cell reference in the Delta Log sheet — the audit trail back to source. */
  cell: string;
  /** Verbatim note text. Do not paraphrase; QS review reads this column. */
  text: string;
  /** Delta Log row label / trade this note sits against. */
  against: string;
  /** Contractor actual on that row (AED), where the row carries one. */
  actual_aed: number | null;
  disposition: NoteDisposition;
  /** Item keys or record ids this note resolves to. */
  resolves_to: string[];
  /** Why that disposition — the reasoning a QS should be able to challenge. */
  rationale: string;
}

export const NEWSPACE_NOTES: NewspaceNote[] = [
  {
    cell: "G7",
    text: "This is more expensive than the usual",
    against: "Mobilisation & site setup group — demolition line",
    actual_aed: 22500,
    disposition: "record_only",
    resolves_to: ["demo.soft_strip", "demo.floor_removal", "demo.wall_tile_removal"],
    rationale:
      "A market-fairness PRE-SIGNAL, not a correction. The platform prices demolition at AED 50,031 against a 22,500 actual (+122%), and the contractor is saying the actual itself ran high. Two opposing signals on one line is exactly what Friday's QS column exists to settle, so nothing changes here — the note is attached to the rates and the rate stays.",
  },
  {
    cell: "G10",
    text: "LED strips and spotlights not included",
    against: "Ceilings & Lighting (labour contract: 'Fittings by client')",
    actual_aed: 21000,
    disposition: "gap_to_fill",
    resolves_to: ["elec.downlight", "light.led_strip"],
    rationale:
      "Split verdict. SPOTLIGHTS are already priced (R-14, 40 no) — the note confirms the contract excluded them, not the platform. LED STRIPS are a real gap: R-31 prices the cove at AED 45/lm and its own note says 'strips client-supplied', so the strip material has never been in any BoQ. Only the strip is new.",
  },
  {
    cell: "G12",
    text: "Water heaters not included",
    against: "Painting works group (labour contract: 'Fixtures by client')",
    actual_aed: 20000,
    disposition: "already_priced",
    resolves_to: ["plumb.water_heater"],
    rationale:
      "R-17 already prices 1 per bathroom (3 no @ AED 5,000). The note describes the labour contract's exclusion. What was missing is CHOICE — no catalog rows existed, so the rule rate could not be overridden by spec class.",
  },
  {
    cell: "G13",
    text: "Sockets not included",
    against: "Electrical works (labour contract: 'Sockets/switches by client')",
    actual_aed: 25000,
    disposition: "already_priced",
    resolves_to: ["elec.point"],
    rationale:
      "R-15 already prices 58 points. Again the gap is choice, not quantity — and checking this note surfaced a real defect: the P2 overlay section prices sockets and switches AGAIN, with no dedupe. See COMPONENT_OWNERS in lib/boq/component-dedupe.ts.",
  },
  {
    cell: "G15",
    text: "Only labor",
    against: "Staircase (labour contract: 'Excl. handrail — priced separately')",
    actual_aed: 6000,
    disposition: "record_only",
    resolves_to: ["stairs.renovation", "floor.stair_tile"],
    rationale:
      "Scope clarification confirming what the engine already does: R-34 stairs.renovation is labour, and the stair TILE comes solely from the P8b surface line Q-11b/R-44. Asserted by test so the two can never both carry material.",
  },
  {
    cell: "G19",
    text: "Excludes slabs for vanity of the 2 bedrooms",
    against: "Tiles & slabs — RAK Ceramics",
    actual_aed: 39263.94,
    disposition: "gap_to_fill",
    resolves_to: ["join.vanity_slab"],
    rationale:
      "The tiles quotation covers floor and wall tile but not vanity counter slabs. Dimensions are unknown, so this must be a site_assessment allowance line per vanity — never folded into tile area, which would hide it inside a rate that is already QS-validated.",
  },
  {
    cell: "G20",
    text:
      "This covered 6 doors with frames, vanity for bathroom, bedroom and bathroom closets, living room closet, and the joinery for the master bedroom wall behind and around the bed only",
    against: "Joinery supply+install (net of 4% discount)",
    actual_aed: 70090.56,
    disposition: "record_only",
    resolves_to: ["MUDON_JOINERY_COVERAGE"],
    rationale:
      "The canonical statement of what the Villa 94 joinery package included. Stored as a checklist so coverage and dedupe logic has an explicit reference instead of inferring scope from line descriptions.",
  },
  {
    cell: "G21",
    text: "This excludes shower glass and mirrors",
    against: "Aluminum & glass supply+install",
    actual_aed: 92449,
    disposition: "gap_to_fill",
    resolves_to: ["alum.shower_glass", "alum.mirror"],
    rationale:
      "Both belong in Aluminum & Glass, not Sanitaryware — the sanitary accessory set (shattaf, paper holder, towel rail, actuator) deliberately excludes mirrors, so there is no overlap to resolve.",
  },
  {
    cell: "G22",
    text: "Additional tiles were required amounting to 3000",
    against: "Sanitary supply (note concerns TILES, not sanitary)",
    actual_aed: 14925,
    disposition: "record_only",
    resolves_to: ["MUDON_TILE_VARIATION"],
    rationale:
      "AED 3,000 is a VALUE, not a quantity, and the note sits on the sanitary row only because that is where it was written. Recorded as a variation against the tiles actual. One variation on one villa is not evidence to move a rate, and no tile rate or rule changes because of it.",
  },
];

/**
 * G20 verbatim, decomposed. The canonical answer to "what did the Villa 94
 * joinery package actually include?", so coverage checks cite a record rather
 * than re-reading line descriptions.
 */
export interface JoineryCoverageEntry {
  key: string;
  description: string;
  qty: number;
  unit: string;
  /** Matching item_key(s) in the joinery actuals, where one exists. */
  item_keys: string[];
}

export const MUDON_JOINERY_COVERAGE: JoineryCoverageEntry[] = [
  { key: "doors", description: "Doors with frames", qty: 6, unit: "no", item_keys: ["join.door"] },
  { key: "bathroom_vanity", description: "Vanity for bathroom", qty: 3, unit: "item", item_keys: ["join.vanity"] },
  { key: "bedroom_closets", description: "Bedroom closets", qty: 1, unit: "set", item_keys: ["join.wardrobe"] },
  { key: "bathroom_closets", description: "Bathroom closets", qty: 3, unit: "item", item_keys: ["join.vanity"] },
  { key: "living_closet", description: "Living-room closet", qty: 1, unit: "set", item_keys: ["join.wardrobe"] },
  {
    key: "master_feature_wall",
    description: "Master-bedroom wall behind and around the bed only",
    qty: 1,
    unit: "set",
    item_keys: ["join.wardrobe"],
  },
];

/**
 * Explicitly NOT covered by the joinery package. Kept beside the coverage list
 * because "the vanity was included" and "the vanity SLAB was not" are one
 * sentence apart in the source and one line apart in the money.
 */
export const MUDON_JOINERY_EXCLUSIONS = [
  {
    key: "vanity_slab",
    description: "Stone counter slabs for the 2 bedroom vanities",
    source_cell: "G19",
    resolves_to: "join.vanity_slab",
  },
] as const;

/** Look a note up by cell, for provenance strings on generated lines. */
export function noteFor(cell: string): NewspaceNote | undefined {
  return NEWSPACE_NOTES.find((n) => n.cell === cell);
}

export function notesByDisposition(d: NoteDisposition): NewspaceNote[] {
  return NEWSPACE_NOTES.filter((n) => n.disposition === d);
}
