// =============================================================================
// lib/boq/joinery-aluminum.ts — the two missing BoQ sections (ground-truth Step 4).
//
// The real project is 39% joinery + aluminum/glass; the platform BoQ had
// neither. Added as an ADDITIVE post-pass (like appendOverlaySections), priced
// from the Atrium (joinery) + Global Creation (aluminum) actuals:
//   - Joinery: quantities from room/fixture heuristics (wardrobe/dresser per
//     bedroom, cabinet+vanity per bathroom, doors), priced from actual composite
//     rates. All supply_and_install → NEVER get a separate install line.
//   - Aluminum & glass: the graph has no openings, so per-opening pricing is
//     impossible. Room-scoped ALLOWANCE lines flagged site_assessment, each
//     carrying the "Requires site measurement — allowance only" caveat.
//     TODO(openings): replace allowances with measured openings once captured.
// Pure + unit-tested.
// =============================================================================

import {
  JOINERY,
  ALUMINUM,
  ALUMINUM_ALLOWANCE_CAVEAT,
} from "@/lib/ground-truth/mudon-actuals";
import { enforceScope, type ScopedLine } from "./scope";

export type GtRateStatus = "actual_transaction" | "site_assessment";

export interface GtBoqLine {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes: string | null;
  rate_status: GtRateStatus;
  scope: "supply_and_install";
}
export interface GtSection {
  work_section: "Joinery" | "Aluminum & Glass";
  lines: GtBoqLine[];
  section_total_aed: number;
}

const BEDROOM = new Set(["master_bedroom", "bedroom"]);
const MASTER = "master_bedroom";
const BATHROOM = new Set(["bathroom", "ensuite", "powder"]);

// Rate lookups from the Atrium actuals (by item_key).
const rate = (key: string) => JOINERY.find((j) => j.item_key === key)?.rate ?? 0;

const round = (n: number) => Math.round(n * 100) / 100;

function line(
  description: string,
  quantity: number,
  unit: string,
  rate_aed: number,
  vendor_or_source: string,
  rate_status: GtRateStatus,
  notes: string | null,
): GtBoqLine {
  return {
    description,
    quantity: round(quantity),
    unit,
    rate_aed,
    total_aed: Math.round(quantity * rate_aed),
    vendor_or_source,
    notes,
    rate_status,
    scope: "supply_and_install",
  };
}

export interface RoomTypeCount {
  room_type: string | null;
}

/**
 * Joinery section from room-type heuristics × Atrium composite rates. Supply &
 * install — no install line is ever paired (enforced).
 */
export function buildJoinerySection(rooms: RoomTypeCount[]): GtSection | null {
  const bedrooms = rooms.filter((r) => BEDROOM.has(r.room_type ?? ""));
  const masters = bedrooms.filter((r) => r.room_type === MASTER).length;
  const kids = bedrooms.length - masters;
  const bathrooms = rooms.filter((r) => BATHROOM.has(r.room_type ?? "")).length;
  const doors = bedrooms.length + bathrooms; // one leaf per bedroom + bathroom
  if (bedrooms.length === 0 && bathrooms === 0) return null;

  const src = "Atrium Technical Services QTN20261407 (actual composite rates)";
  const lines: GtBoqLine[] = [];

  // Master bedroom: dresser (1100/m² × 10.08) + wall cladding (800/m² × 6.16).
  if (masters > 0) {
    lines.push(line(`Master bedroom dresser cabinet, glass doors + LED`, 10.08 * masters, "m2", rate("joinery_dresser"), src, "actual_transaction", "Heuristic: 10.08 m² per master (Atrium 1.1)"));
    lines.push(line(`Master bedroom wall cladding with hidden LED`, 6.16 * masters, "m2", rate("joinery_cladding"), src, "actual_transaction", "Heuristic: 6.16 m² per master (Atrium 1.2)"));
  }
  // Kids bedrooms: fitted cabinet 850/m² × 7 m² each.
  if (kids > 0) {
    lines.push(line(`Fitted bedroom cabinet, melamine MDF + architrave`, 7 * kids, "m2", rate("joinery_cabinet"), src, "actual_transaction", `Heuristic: 7 m² per bedroom × ${kids} (Atrium 2.1/3.1)`));
  }
  // Bathrooms: bath cabinet (item) + vanity (item) each.
  if (bathrooms > 0) {
    lines.push(line(`Bathroom cabinet with doors, MR melamine`, bathrooms, "item", rate("joinery_bath_cabinet_2d"), src, "actual_transaction", `One per bathroom × ${bathrooms}`));
    lines.push(line(`Bathroom vanity box, MR melamine`, bathrooms, "item", rate("joinery_vanity"), src, "actual_transaction", `One per bathroom × ${bathrooms}`));
  }
  // Doors: solid leaf + full meranti frame, per bedroom + bathroom.
  if (doors > 0) {
    lines.push(line(`Solid door leaf, new handle + hinges`, doors, "no", rate("joinery_door_leaf"), src, "actual_transaction", `Bedrooms + bathrooms = ${doors} leaves (Atrium 5.1)`));
    lines.push(line(`Solid meranti door frame, painted + fixed`, doors, "no", rate("joinery_door_frame"), src, "actual_transaction", `${doors} frames (Atrium 5.2)`));
  }

  return finalize("Joinery", lines);
}

/**
 * Aluminum & glass section — room-scoped ALLOWANCES (site_assessment), from the
 * Global Creation quote's per-item lump values. Never a measured quantity.
 */
export function buildAluminumSection(): GtSection | null {
  if (ALUMINUM.length === 0) return null;
  const src = "Global Creation Services ref 3936/R1 (allowance)";
  const lines: GtBoqLine[] = ALUMINUM.map((a) =>
    line(
      `${a.location} — ${a.item}`,
      a.qty,
      a.unit === "LM" ? "lm" : "no",
      Math.round((a.total / a.qty) * 100) / 100,
      src,
      "site_assessment",
      ALUMINUM_ALLOWANCE_CAVEAT,
    ),
  );
  return finalize("Aluminum & Glass", lines);
}

function finalize(work_section: GtSection["work_section"], lines: GtBoqLine[]): GtSection | null {
  if (lines.length === 0) return null;
  // Guard: these are all supply_and_install composites — enforceScope must find
  // no install line shadowing them (no double-count).
  const scoped: ScopedLine[] = lines.map((l) => ({ description: l.description, scope: l.scope, install_group: work_section }));
  const { violations } = enforceScope(scoped);
  if (violations.some((v) => v.kind === "composite_with_install")) {
    throw new Error(`[joinery-aluminum] scope violation in ${work_section}: composite line paired with install`);
  }
  return {
    work_section,
    lines,
    section_total_aed: lines.reduce((s, l) => s + l.total_aed, 0),
  };
}

interface BoqLike {
  sections: { work_section: string; lines: unknown[]; section_total_aed: number }[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
}

/**
 * Append the Joinery + Aluminum & Glass sections to a BoQ and recompute the
 * contingency/VAT/grand-total chain. Idempotent (drops prior copies first).
 * Ground-truth is core (not flagged) — but no-ops safely when there are no rooms.
 */
export function appendJoineryAluminumSections<T extends BoqLike>(boq: T, rooms: RoomTypeCount[]): T {
  const joinery = buildJoinerySection(rooms);
  const aluminum = buildAluminumSection();
  const extra = [joinery, aluminum].filter((s): s is GtSection => s !== null);
  if (extra.length === 0) return boq;

  // The actuals-based Joinery section SUPERSEDES the engine's own generic
  // "Joinery & Carpentry" estimate (same wardrobes/vanities/doors) — keeping
  // both would double-count joinery. Idempotent for our own two sections too.
  const kept = boq.sections.filter(
    (s) =>
      s.work_section !== "Joinery" &&
      s.work_section !== "Aluminum & Glass" &&
      !(joinery !== null && s.work_section === "Joinery & Carpentry"),
  );
  const sections = [...kept, ...(extra as unknown as BoqLike["sections"])];
  const subtotal_aed = sections.reduce((s, x) => s + x.section_total_aed, 0);
  const contingency_aed = Math.round((subtotal_aed * boq.contingency_pct) / 100);
  const vat_aed = Math.round(((subtotal_aed + contingency_aed) * boq.vat_pct) / 100);

  return {
    ...boq,
    sections,
    subtotal_aed,
    contingency_aed,
    vat_aed,
    grand_total_aed: subtotal_aed + contingency_aed + vat_aed,
  } as T;
}
