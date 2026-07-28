// =============================================================================
// lib/overlays/boq.ts — overlay fixture counts → BoQ sections (P2).
//
// Deterministic: fixture counts become BoQ line quantities directly (NOT from
// the LLM). Two POMI sections — "Electrical Installations" and "Plumbing &
// Sanitary". Each line records element_refs (the fixture ids it counts) and
// rate_status ('needs_qs' where we have no default point rate). Rates come from
// the fixture catalog (the point-pricing path); the QS prices the rest.
// =============================================================================

import {
  ELECTRICAL_TYPES,
  FIXTURE_META,
  PLUMBING_TYPES,
  POMI_ELECTRICAL,
  POMI_PLUMBING,
} from "./catalog";
import type { FixtureType } from "./types";

export interface OverlayBoqLine {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes: string | null;
  // additive fields (match lib/boq/schema BoqLine so the blob stays uniform)
  rule_id: string;
  kind: "supply_and_install";
  rate_band: "sku" | "allowance";
  wastage_pct: number;
  // P2/P4/P5 additive
  element_refs: string[];
  rate_status: "priced" | "needs_qs";
}

export interface OverlayBoqSection {
  work_section: string;
  lines: OverlayBoqLine[];
  section_total_aed: number;
}

export interface FixtureLike {
  id: string;
  type: FixtureType;
}

function lineForType(type: FixtureType, ids: string[]): OverlayBoqLine {
  const meta = FIXTURE_META[type];
  const priced = meta.unitRateAed != null;
  const rate = meta.unitRateAed ?? 0;
  const qty = ids.length;
  return {
    description: meta.boqDescription,
    quantity: qty,
    unit: "no",
    rate_aed: rate,
    total_aed: Math.round(qty * rate),
    vendor_or_source: priced ? "Overlay point rate (P2 default)" : "TBC — QS to price",
    notes: `Count from 2D ${type} fixtures on the plan.`,
    rule_id: `P2/overlay/${type}`,
    kind: "supply_and_install",
    rate_band: priced ? "sku" : "allowance",
    wastage_pct: 0,
    element_refs: ids,
    rate_status: priced ? "priced" : "needs_qs",
  };
}

/**
 * Build the electrical + plumbing BoQ sections from plan fixtures. Returns only
 * the sections that have fixtures. Lines within a section are ordered by the
 * canonical type order for stable, deterministic output.
 */
export function buildOverlaySections(fixtures: FixtureLike[]): OverlayBoqSection[] {
  const idsByType = new Map<FixtureType, string[]>();
  for (const f of fixtures) {
    const arr = idsByType.get(f.type) ?? [];
    arr.push(f.id);
    idsByType.set(f.type, arr);
  }

  const build = (order: readonly FixtureType[], work_section: string): OverlayBoqSection | null => {
    const lines: OverlayBoqLine[] = [];
    for (const type of order) {
      const ids = idsByType.get(type);
      if (ids && ids.length > 0) lines.push(lineForType(type, ids.slice().sort()));
    }
    if (!lines.length) return null;
    return {
      work_section,
      lines,
      section_total_aed: lines.reduce((s, l) => s + l.total_aed, 0),
    };
  };

  return [
    build(ELECTRICAL_TYPES, POMI_ELECTRICAL),
    build(PLUMBING_TYPES, POMI_PLUMBING),
  ].filter((s): s is OverlayBoqSection => s !== null);
}

/** Every needs_qs line across the overlay sections (verification + QS list). */
export function needsQsLines(sections: OverlayBoqSection[]): {
  work_section: string;
  description: string;
  quantity: number;
}[] {
  const out: { work_section: string; description: string; quantity: number }[] = [];
  for (const s of sections) {
    for (const l of s.lines) {
      if (l.rate_status === "needs_qs") {
        out.push({ work_section: s.work_section, description: l.description, quantity: l.quantity });
      }
    }
  }
  return out;
}
