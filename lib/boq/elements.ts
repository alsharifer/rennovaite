// =============================================================================
// lib/boq/elements.ts — assemble per-element take-off into POMI lines (P4).
//
// The POMI BoQ line stays AGGREGATED (correct QS/contractor format). Here we
// build the element-mapped sections from takeoff items so that, by construction:
//   - line.quantity  = Σ item.qty   (the per-room sums equal the line quantity)
//   - line.element_refs = the element ids that fed it (rooms / walls)
// Aggregation happens here, at line-assembly time — never before persistence.
// =============================================================================

import type { TakeoffItem, WorkItemKey } from "./quantify";

export interface WorkItemDef {
  section: string; // POMI work section
  description: string;
  rate_aed: number; // representative mid-tier AED / unit (deterministic)
}

/** work item → POMI section + description + rate. */
export const WORK_ITEM_DEF: Record<WorkItemKey, WorkItemDef> = {
  demolition: { section: "Demolition", description: "Wall demolition + cart away", rate_aed: 90 },
  wall_plaster: { section: "Plaster", description: "Wall plaster / skim coat (net of openings)", rate_aed: 55 },
  floor_finish: { section: "Floor Finishes", description: "Floor finish — supply & install", rate_aed: 190 },
  wet_tiling: { section: "Wall Finishes", description: "Wet-area wall tiling — supply & install", rate_aed: 260 },
  ceiling_finish: { section: "Ceilings", description: "Gypsum ceiling + finish", rate_aed: 130 },
  wall_paint: { section: "Decoration & Painting", description: "Wall painting — primer + 2 coats", rate_aed: 35 },
};

/** The POMI sections that P4 rebuilds from takeoff items (replaces engine's). */
export const MAPPED_SECTIONS: readonly string[] = Object.values(WORK_ITEM_DEF).map(
  (d) => d.section,
);

export interface MappedLine {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes: string | null;
  rule_id: string;
  kind: "supply_and_install";
  rate_band: "mid";
  wastage_pct: number;
  element_refs: string[];
  rate_status: "priced";
  work_item_key: WorkItemKey;
}

export interface MappedSection {
  work_section: string;
  lines: MappedLine[];
  section_total_aed: number;
}

const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Build the element-mapped POMI sections from the take-off items. */
export function assembleMappedSections(items: TakeoffItem[]): MappedSection[] {
  const byKey = new Map<WorkItemKey, TakeoffItem[]>();
  for (const it of items) {
    (byKey.get(it.work_item_key) ?? byKey.set(it.work_item_key, []).get(it.work_item_key)!).push(it);
  }

  // One aggregated line per work item.
  const lines: MappedLine[] = [];
  for (const [key, its] of byKey) {
    if (its.length === 0) continue;
    const def = WORK_ITEM_DEF[key];
    const quantity = r2(its.reduce((s, i) => s + i.qty, 0));
    lines.push({
      description: def.description,
      quantity,
      unit: its[0]!.unit,
      rate_aed: def.rate_aed,
      total_aed: r0(quantity * def.rate_aed),
      vendor_or_source: "Deterministic take-off (P4)",
      notes: `Aggregated from ${its.length} element take-off items.`,
      rule_id: `P4/quantify/${key}`,
      kind: "supply_and_install",
      rate_band: "mid",
      wastage_pct: 0,
      element_refs: its.map((i) => i.element_id),
      rate_status: "priced",
      work_item_key: key,
    });
  }

  // Group lines into POMI sections.
  const bySection = new Map<string, MappedLine[]>();
  for (const line of lines) {
    const section = WORK_ITEM_DEF[line.work_item_key].section;
    (bySection.get(section) ?? bySection.set(section, []).get(section)!).push(line);
  }
  return Array.from(bySection.entries()).map(([work_section, ls]) => ({
    work_section,
    lines: ls,
    section_total_aed: ls.reduce((s, l) => s + l.total_aed, 0),
  }));
}

export interface RoomRollupWorkItem {
  work_item_key: WorkItemKey;
  description: string;
  qty: number;
  unit: string;
  total_aed: number;
}

export interface RoomRollup {
  room_id: string;
  total_aed: number;
  items: RoomRollupWorkItem[];
}

/**
 * Per-room cost rollup: each room's take-off items × their line rates, summed
 * and sorted descending. Wall items are attributed to their `room_id`. Items
 * with no room (should be none) are dropped from the room view.
 */
export function roomRollup(items: TakeoffItem[]): RoomRollup[] {
  const byRoom = new Map<string, TakeoffItem[]>();
  for (const it of items) {
    if (!it.room_id) continue;
    (byRoom.get(it.room_id) ?? byRoom.set(it.room_id, []).get(it.room_id)!).push(it);
  }
  const rollups: RoomRollup[] = [];
  for (const [room_id, its] of byRoom) {
    // Collapse per work-item within the room.
    const byKey = new Map<WorkItemKey, { qty: number; unit: string }>();
    for (const i of its) {
      const cur = byKey.get(i.work_item_key) ?? { qty: 0, unit: i.unit };
      cur.qty += i.qty;
      byKey.set(i.work_item_key, cur);
    }
    const workItems: RoomRollupWorkItem[] = [];
    for (const [key, { qty, unit }] of byKey) {
      const def = WORK_ITEM_DEF[key];
      workItems.push({ work_item_key: key, description: def.description, qty: r2(qty), unit, total_aed: r0(qty * def.rate_aed) });
    }
    workItems.sort((a, b) => b.total_aed - a.total_aed);
    rollups.push({ room_id, total_aed: workItems.reduce((s, w) => s + w.total_aed, 0), items: workItems });
  }
  rollups.sort((a, b) => b.total_aed - a.total_aed);
  return rollups;
}

interface BoqLikeSection {
  work_section: string;
  lines: { total_aed: number; element_refs?: string[] | null }[];
  section_total_aed: number;
}

/**
 * Transparency metric for the investor demo: the share of BoQ line value whose
 * lines carry element_refs (i.e. tap-to-inspect can explain it). Preliminaries
 * / provisional sums stay unmapped and are honestly excluded.
 */
export function elementMappedPct(sections: BoqLikeSection[]): {
  mapped_aed: number;
  total_aed: number;
  pct: number;
} {
  let mapped = 0;
  let total = 0;
  for (const s of sections) {
    for (const l of s.lines) {
      total += l.total_aed;
      if (l.element_refs && l.element_refs.length > 0) mapped += l.total_aed;
    }
  }
  return { mapped_aed: mapped, total_aed: total, pct: total > 0 ? Math.round((mapped / total) * 1000) / 10 : 0 };
}
