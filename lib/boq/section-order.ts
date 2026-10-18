// =============================================================================
// lib/boq/section-order.ts — THE work-section order (H7).
//
// One order, Preliminaries first, used by the BoQ JSON (every producer's output
// passes `rechain`, which sorts by it), the BoQ page, the BoQ PDF, the client
// proposal and the revision diff. Before H7 there were three — SECTION_ORDER
// (Preliminaries 14th), schema POMI_SECTIONS, element-map POMI_ORDER — and the
// appended sections (overlays, joinery, aluminium) landed wherever they were
// appended, so Arabella read Demolition · Plumbing · Preliminaries · …
//
// The sort is STABLE and moves whole sections only: a line never changes its
// position inside its section, so a REF code (section code + index within the
// section, lib/boq/refs.ts) never changes because of it (asserted in
// lib/boq/__tests__/section-order.test.ts). A section this list does not name
// keeps its relative position after every named one.
//
// Pure and client-safe.
// =============================================================================

export const CANONICAL_SECTION_ORDER = [
  "Preliminaries",
  "Demolition",
  "Blockwork",
  "Plaster",
  "Waterproofing",
  "Floor Finishes",
  "Wall Finishes",
  "Ceilings",
  "Joinery & Carpentry",
  "Joinery",
  "Aluminum & Glass",
  "Sanitaryware",
  "Electrical",
  "Electrical Installations",
  "Plumbing",
  "Plumbing & Sanitary",
  "MEP / HVAC",
  "Lighting",
  "Decoration & Painting",
  // External works, after the interior trades.
  "External Works",
  "Hardscape & Structures",
  "Landscape Structures",
  "Soft Landscaping",
  "Irrigation",
  "Electrical & Lighting",
  "External Lighting",
  // Never part of the contractor scope; always last where it is shown.
  "Furniture (optional)",
] as const;

const RANK = new Map<string, number>(CANONICAL_SECTION_ORDER.map((s, i) => [s, i]));

/** Position of a section in the canonical order; an unnamed section sorts after every named one. */
export function sectionRank(name: string): number {
  return RANK.get(name) ?? CANONICAL_SECTION_ORDER.length;
}

/** The sections in canonical order — a new array; stable, so equal ranks keep their input order. Lines are untouched. */
export function sortSections<T extends { work_section: string }>(sections: readonly T[]): T[] {
  return sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => sectionRank(a.s.work_section) - sectionRank(b.s.work_section) || a.i - b.i)
    .map(({ s }) => s);
}
