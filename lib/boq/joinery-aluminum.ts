// =============================================================================
// lib/boq/joinery-aluminum.ts — the two missing BoQ sections (ground-truth Step 4).
//
// The real project is 39% joinery + aluminum/glass; the platform BoQ had
// neither. Added as an ADDITIVE post-pass (like appendOverlaySections):
//   - Joinery: quantities from room/fixture heuristics (wardrobe/dresser per
//     bedroom, cabinet+vanity per bathroom, doors), priced from the reference
//     villa's composite rates PER UNIT (lib/ground-truth/mudon-actuals JOINERY —
//     rates only, never its lines). All supply_and_install → NEVER get a
//     separate install line.
//   - Aluminum & glass (C1): the lines come from THIS plan's windows and
//     external doors (lib/boq/glazing.ts), priced by the caller per m² of
//     opening (R-75 / R-76). Until C1 this section printed the reference
//     villa's aluminium order line by line on every project — its rooms, its
//     quantities (docs/SPRINT_C_ROOT_CAUSE.md). Ground truth never emits a
//     line (lib/boq/__tests__/ground-truth-rule.test.ts).
// Pure + unit-tested.
// =============================================================================

import { JOINERY } from "@/lib/ground-truth/mudon-actuals";
import { enforceScope, type ScopedLine } from "./scope";
import { lineTotal, money2, sumMoney } from "./money";
import { RATE_RULES } from "./rules";
import { mirrorCount, showerGlassCount, vanitySlabCount } from "./scope-components";
import { rechain, type ChainedDoc } from "./totals";

export type GtRateStatus = "actual_transaction" | "site_assessment" | "indicative";

export interface GtBoqLine {
  /**
   * Provenance id, required. Ground-truth actuals use "GT/<trade>/<slug>";
   * S6-pre component rules use "S6-xx/R-yy" like the engine's own lines.
   *
   * These lines carried none until now, which broke more than tidiness: the
   * dedupe detector matches a stored BoQ by rule_id, so the vanity-slab check
   * against join.vanity could never fire, and the CSV export for the QS had a
   * blank column for two whole sections.
   */
  rule_id: string;
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
/** C1: a glazing line priced through the resolver (lib/boq/glazing.ts) — an engine line, supply and install. */
export interface GlazingLine {
  rule_id: string;
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes: string | null;
  [field: string]: unknown;
}

export interface GtSection {
  work_section: "Joinery" | "Aluminum & Glass";
  lines: (GtBoqLine | GlazingLine)[];
  section_total_aed: number;
}

/**
 * C1: what the aluminium section is built from — this plan's priced glazing
 * lines, and, when the plan has none, the reason the BoQ records for the
 * Issues navigator (null when nothing needs saying).
 */
export interface GlazingInput {
  lines: GlazingLine[];
  notPriced: string | null;
}

export const NO_GLAZING: GlazingInput = { lines: [], notPriced: null };

const BEDROOM = new Set(["master_bedroom", "bedroom"]);
/** Outdoor zones — see lib/boq/rules.ts LANDSCAPE_TYPES. */
const LANDSCAPE = new Set([
  "paving",
  "artificial_grass",
  "planting_bed",
  "deck",
  "path",
  "structure",
  "pool",
]);
const MASTER = "master_bedroom";
const BATHROOM = new Set(["bathroom", "ensuite", "powder"]);

// Rate lookups from the Atrium actuals (by item_key).
const rate = (key: string) => JOINERY.find((j) => j.item_key === key)?.rate ?? 0;

const round = (n: number) => Math.round(n * 100) / 100;

function line(
  rule_id: string,
  description: string,
  quantity: number,
  unit: string,
  rate_aed: number,
  vendor_or_source: string,
  rate_status: GtRateStatus,
  notes: string | null,
): GtBoqLine {
  // H7: the total multiplies out from the quantity and rate PRINTED on the line
  // (2-dp each); it used to use the unrounded quantity and whole dirhams.
  const qty = round(quantity);
  return {
    rule_id,
    description,
    quantity: qty,
    unit,
    rate_aed: money2(rate_aed),
    total_aed: lineTotal(qty, rate_aed),
    vendor_or_source,
    notes,
    rate_status,
    scope: "supply_and_install",
  };
}

export interface RoomTypeCount {
  room_type: string | null;
  /** Optional — only the S6-pre component counts read it. Nullable because the
   *  route passes DB rows straight through. */
  area_m2?: number | null;
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

  // I4: a role label, never the contractor or its quotation number (lib/identity/curation.ts).
  const src = "joinery reference quotation (transacted composite rates)";
  const lines: GtBoqLine[] = [];

  // Master bedroom: dresser (1100/m² × 10.08) + wall cladding (800/m² × 6.16).
  if (masters > 0) {
    lines.push(line(
      "GT/joinery/dresser",
      `Master bedroom dresser cabinet, glass doors + LED`, 10.08 * masters, "m2", rate("joinery_dresser"), src, "actual_transaction", "Heuristic: 10.08 m² per master (ref 1.1)"));
    lines.push(line(
      "GT/joinery/cladding",
      `Master bedroom wall cladding with hidden LED`, 6.16 * masters, "m2", rate("joinery_cladding"), src, "actual_transaction", "Heuristic: 6.16 m² per master (ref 1.2)"));
  }
  // Kids bedrooms: fitted cabinet 850/m² × 7 m² each.
  if (kids > 0) {
    lines.push(line(
      "GT/joinery/cabinet",
      `Fitted bedroom cabinet, melamine MDF + architrave`, 7 * kids, "m2", rate("joinery_cabinet"), src, "actual_transaction", `Heuristic: 7 m² per bedroom × ${kids} (ref 2.1/3.1)`));
  }
  // Bathrooms: bath cabinet (item) + vanity (item) each.
  if (bathrooms > 0) {
    lines.push(line(
      "GT/joinery/bath_cabinet",
      `Bathroom cabinet with doors, MR melamine`, bathrooms, "item", rate("joinery_bath_cabinet_2d"), src, "actual_transaction", `One per bathroom × ${bathrooms}`));
    lines.push(line(
      "GT/joinery/vanity",
      `Bathroom vanity box, MR melamine`, bathrooms, "item", rate("joinery_vanity"), src, "actual_transaction", `One per bathroom × ${bathrooms}`));
  }
  // Doors: solid leaf + full meranti frame, per bedroom + bathroom.
  if (doors > 0) {
    lines.push(line(
      "GT/joinery/door_leaf",
      `Solid door leaf, new handle + hinges`, doors, "no", rate("joinery_door_leaf"), src, "actual_transaction", `Bedrooms + bathrooms = ${doors} leaves (ref 5.1)`));
    lines.push(line(
      "GT/joinery/door_frame",
      `Solid meranti door frame, painted + fixed`, doors, "no", rate("joinery_door_frame"), src, "actual_transaction", `${doors} frames (ref 5.2)`));
  }

  // --- S6-pre (G19): "Excludes slabs for vanity of the 2 bedrooms" ---------
  //
  // One slab per vanity unit in the joinery scope. Deliberately NOT folded into
  // tile area, which would hide an unpriced component inside a QS-validated
  // rate. Dimensions are unknown, so it is a site_assessment allowance.
  if (bathrooms > 0) {
    const slabs = vanitySlabCount(bathrooms);
    lines.push(
      line(
        "S6-05/R-46",
        "Vanity counter slab — allowance, requires site measurement",
        slabs.quantity,
        "no",
        RATE_RULES["join.vanity_slab"]!.allowance_aed!,
        "S6-pre G19 — excluded from the client-supplied tile package; indicative allowance",
        "site_assessment",
        slabs.measurement,
      ),
    );
  }

  return finalize("Joinery", lines);
}

/**
 * Aluminum & glass section (C1) — this plan's glazing lines (windows and
 * external doors, priced per m² of opening by the caller), then the S6-pre
 * shower glass and mirrors. No openings → no glazing lines; the caller records
 * why (GlazingInput.notPriced).
 */
export function buildAluminumSection(rooms: RoomTypeCount[] = [], glazing: readonly GlazingLine[] = []): GtSection | null {
  // A plan with no interior rooms has no glazing, shower or mirror of its own.
  if (rooms.length > 0 && rooms.every((r) => LANDSCAPE.has(r.room_type ?? ""))) return null;
  const lines: (GtBoqLine | GlazingLine)[] = glazing.map((l) => ({ ...l, scope: "supply_and_install" as const }));
  // --- S6-pre (G21): shower glass and mirrors -------------------------------
  //
  // Appended here rather than emitted by the engine, for the same reason the
  // stair tile is re-appended in element-map.ts: this section is rebuilt on
  // every generation, so anything the engine put in "Aluminum & Glass" would be
  // discarded on the way through. Flagged "indicative".
  const componentRooms = rooms.map((r, i) => ({
    id: String(i),
    type: r.room_type,
    area_m2: r.area_m2 ?? 0,
  }));
  if (componentRooms.length > 0) {
    const glass = showerGlassCount(componentRooms);
    const vanities = componentRooms.filter(
      (r) => r.type === "bathroom" || r.type === "ensuite" || r.type === "powder",
    ).length;
    const mirrors = mirrorCount(componentRooms, vanities);
    if (glass.quantity > 0) {
      lines.push(
        line(
          "S6-06/R-47",
          "Frameless shower glass partition — supply and install",
          glass.quantity,
          "no",
          RATE_RULES["alum.shower_glass"]!.allowance_aed!,
          "S6-pre G21 — excluded from the aluminium & glazing reference package; indicative rate",
          "indicative",
          glass.measurement,
        ),
      );
    }
    if (mirrors.quantity > 0) {
      lines.push(
        line(
          "S6-07/R-48",
          "Bathroom mirror — supply and install",
          mirrors.quantity,
          "no",
          RATE_RULES["alum.mirror"]!.allowance_aed!,
          "S6-pre G21 — excluded from the aluminium & glazing reference package; indicative rate",
          "indicative",
          mirrors.measurement,
        ),
      );
    }
  }
  return finalize("Aluminum & Glass", lines);
}

function finalize(work_section: GtSection["work_section"], lines: (GtBoqLine | GlazingLine)[]): GtSection | null {
  if (lines.length === 0) return null;
  // Guard: these are all supply_and_install composites — enforceScope must find
  // no install line shadowing them (no double-count).
  const scoped: ScopedLine[] = lines.map((l) => ({ description: l.description, scope: "supply_and_install", install_group: work_section }));
  const { violations } = enforceScope(scoped);
  if (violations.some((v) => v.kind === "composite_with_install")) {
    throw new Error(`[joinery-aluminum] scope violation in ${work_section}: composite line paired with install`);
  }
  return {
    work_section,
    lines,
    section_total_aed: sumMoney(lines.map((l) => l.total_aed)),
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
 * Core (not flagged) — but no-ops safely when there are no rooms.
 *
 * C1: `glazing` carries this plan's priced glazing lines; when it says the
 * glazing is not priced (no windows or doors drawn), the document records the
 * reason as `glazing_not_priced` — the Issues navigator's row.
 */
export function appendJoineryAluminumSections<T extends BoqLike>(boq: T, rooms: RoomTypeCount[], glazing: GlazingInput = NO_GLAZING): T {
  const joinery = buildJoinerySection(rooms);
  const aluminum = buildAluminumSection(rooms, glazing.lines);
  const extra = [joinery, aluminum].filter((s): s is GtSection => s !== null);
  const reason = glazing.notPriced ? { glazing_not_priced: glazing.notPriced } : {};
  if (extra.length === 0) return { ...boq, ...reason };

  // The actuals-based Joinery section SUPERSEDES the engine's own generic
  // "Joinery & Carpentry" estimate (same wardrobes/vanities/doors) — keeping
  // both would double-count joinery. Idempotent for our own two sections too.
  const kept = boq.sections.filter(
    (s) =>
      s.work_section !== "Joinery" &&
      s.work_section !== "Aluminum & Glass" &&
      !(joinery !== null && s.work_section === "Joinery & Carpentry"),
  );
  // H7: canonical order, section totals, subtotal and chain — all by rechain.
  return rechain({ ...boq, ...reason, sections: [...kept, ...(extra as unknown as BoqLike["sections"])] } as unknown as ChainedDoc) as unknown as T;
}
