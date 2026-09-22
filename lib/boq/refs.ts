// =============================================================================
// lib/boq/refs.ts — BoQ line REF codes (D5).
//
// Before D5 a REF was the initials of its section's words + a line number, so
// Plaster, Plumbing and Preliminaries all produced "P-01" — three different
// lines, one code. A partner quoting "P-01" back could not say which one.
//
// Now every section has its own three-letter code (SECTION_REF_CODES), so a REF
// is unique within a BoQ: "PLA-01", "PLB-01", "PRE-01". A section with no code
// (an unknown or future name) gets its initials, and `assignRefs` suffixes any
// code that would collide inside one BoQ — uniqueness never depends on the
// table being complete.
//
// RECONCILIATION. Documents already sent carry the old codes. `legacyRef`
// reproduces the old scheme exactly, and `refMigration(boq)` returns the
// per-line old → new table (served at /api/projects/:id/boq-refs, JSON or CSV,
// and printed as the "REF changes" page of the BoQ PDF). A legacy code is
// section-qualified in that table because on its own it was ambiguous.
//
// Pure and client-safe.
// =============================================================================

/** One code per section name. Every value is unique (asserted in lib/boq/__tests__/refs.test.ts). */
export const SECTION_REF_CODES: Readonly<Record<string, string>> = {
  Demolition: "DEM",
  Blockwork: "BLK",
  Plaster: "PLA",
  "Floor Finishes": "FLR",
  "Wall Finishes": "WAL",
  Ceilings: "CLG",
  "Joinery & Carpentry": "JNC",
  Joinery: "JNY",
  "Aluminum & Glass": "ALU",
  Sanitaryware: "SAN",
  Electrical: "ELE",
  Plumbing: "PLB",
  "MEP / HVAC": "HVC",
  Lighting: "LGT",
  "Electrical Installations": "ELI",
  "Plumbing & Sanitary": "PLS",
  "Decoration & Painting": "PNT",
  Preliminaries: "PRE",
  "Hardscape & Structures": "HRD",
  "Soft Landscaping": "SFT",
  Irrigation: "IRR",
  "Electrical & Lighting": "EXL",
  "External Works": "EXW",
  "Landscape Structures": "LST",
  "External Lighting": "EXT",
  "Furniture (optional)": "FUR",
};

const initials = (workSection: string) =>
  workSection
    .split(/[\s&/()]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 4);

const pad = (idx: number) => String(idx + 1).padStart(2, "0");

/** The pre-D5 REF, reproduced exactly (ambiguous across sections — reconciliation only). */
export function legacyRef(workSection: string, idx: number): string {
  return `${initials(workSection)}-${pad(idx)}`;
}

/** A section's REF code, before any in-BoQ collision suffix. */
export function sectionCode(workSection: string): string {
  return SECTION_REF_CODES[workSection] ?? initials(workSection);
}

/**
 * REF codes for every line of a BoQ, keyed `${work_section}-${idx}` (the BoQ
 * view's row key). Unique within the BoQ by construction: a section whose code
 * is already taken (two unknown sections with the same initials) is suffixed.
 */
export function assignRefs(sections: readonly { work_section: string; lines: readonly unknown[] }[]): Record<string, string> {
  const taken = new Map<string, string>(); // code → section that owns it
  const out: Record<string, string> = {};
  for (const s of sections) {
    let code = sectionCode(s.work_section);
    for (let n = 2; taken.has(code) && taken.get(code) !== s.work_section; n++) code = `${sectionCode(s.work_section)}${n}`;
    taken.set(code, s.work_section);
    s.lines.forEach((_, idx) => {
      out[`${s.work_section}-${idx}`] = `${code}-${pad(idx)}`;
    });
  }
  return out;
}

export interface RefMigrationRow {
  work_section: string;
  line: number;
  description: string;
  /** The code printed before D5 — meaningful only together with its section. */
  legacy_ref: string;
  ref: string;
}

/** The old → new REF table for one BoQ, in document order. */
export function refMigration(
  sections: readonly { work_section: string; lines: readonly { description?: string }[] }[],
): RefMigrationRow[] {
  const refs = assignRefs(sections);
  return sections.flatMap((s) =>
    s.lines.map((l, idx) => ({
      work_section: s.work_section,
      line: idx + 1,
      description: l.description ?? "",
      legacy_ref: legacyRef(s.work_section, idx),
      ref: refs[`${s.work_section}-${idx}`]!,
    })),
  );
}

/**
 * Resolve a REF from a link or a partner's note. A current REF resolves
 * exactly. A legacy REF resolves only when it is UNAMBIGUOUS in this BoQ;
 * otherwise null (never a guess at which "P-01" was meant).
 */
export function resolveRef(
  sections: readonly { work_section: string; lines: readonly unknown[] }[],
  ref: string,
): string | null {
  const refs = assignRefs(sections);
  const current = Object.entries(refs).find(([, r]) => r === ref);
  if (current) return current[1];
  const legacy = sections.flatMap((s) => s.lines.map((_, idx) => ({ key: `${s.work_section}-${idx}`, legacy: legacyRef(s.work_section, idx) }))).filter((x) => x.legacy === ref);
  return legacy.length === 1 ? refs[legacy[0]!.key]! : null;
}

export const REF_MIGRATION_CSV_HEADER = "work_section,line,legacy_ref,ref,description";

export function refMigrationCsv(rows: readonly RefMigrationRow[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [REF_MIGRATION_CSV_HEADER, ...rows.map((r) => [q(r.work_section), r.line, r.legacy_ref, r.ref, q(r.description)].join(","))].join("\n");
}
