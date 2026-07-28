// =============================================================================
// lib/boq/element-map.ts — P4 element mapping applied to a generated BoQ.
//
// Rebuilds the element-mapped POMI sections from takeoff items so their line
// quantities = Σ per-room take-off and their element_refs are real element ids.
// The stored POMI document format is unchanged (same sections, same schema);
// only quantities/refs on the mapped sections come from the take-off. Gated by
// the viewer flag in the route; best-effort persistence of takeoff_items.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { assembleMappedSections, MAPPED_SECTIONS } from "./elements";
import type { TakeoffItem } from "./quantify";

// POMI display order for a clean merged document.
const POMI_ORDER = [
  "Demolition",
  "Blockwork",
  "Plaster",
  "Floor Finishes",
  "Wall Finishes",
  "Ceilings",
  "Joinery & Carpentry",
  "Sanitaryware",
  "Electrical",
  "Plumbing",
  "MEP / HVAC",
  "Lighting",
  "Electrical Installations",
  "Plumbing & Sanitary",
  "Decoration & Painting",
  "Preliminaries",
];

interface BoqSectionLike {
  work_section: string;
  lines: unknown[];
  section_total_aed: number;
}
interface BoqLike {
  sections: BoqSectionLike[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
}

function orderIndex(section: string): number {
  const i = POMI_ORDER.indexOf(section);
  return i === -1 ? POMI_ORDER.length : i;
}

/**
 * Replace the mapped POMI sections with take-off-derived ones (real quantities +
 * element_refs) and recompute the contingency/VAT/grand-total chain. Returns the
 * same object shape. No-op when there are no take-off items.
 */
export function applyElementMapping<T extends BoqLike>(boq: T, items: TakeoffItem[]): T {
  if (items.length === 0) return boq;

  const mapped = assembleMappedSections(items);
  const kept = boq.sections.filter((s) => !MAPPED_SECTIONS.includes(s.work_section));
  const sections = [...kept, ...(mapped as unknown as BoqSectionLike[])].sort(
    (a, b) => orderIndex(a.work_section) - orderIndex(b.work_section),
  );

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

/** Persist takeoff items for the project (best-effort; replaces prior items). */
export async function persistTakeoffItems(
  projectId: string,
  items: TakeoffItem[],
  supabase: SupabaseClient,
  planSnapshotId: string | null = null,
): Promise<void> {
  try {
    await supabase.from("takeoff_items").delete().eq("project_id", projectId);
    if (items.length === 0) return;
    const rows = items.map((i) => ({
      project_id: projectId,
      plan_snapshot_id: planSnapshotId,
      work_item_key: i.work_item_key,
      room_id: i.room_id,
      element_id: i.element_id,
      qty: i.qty,
      unit: i.unit,
      wet_area: i.wet_area,
    }));
    await supabase.from("takeoff_items").insert(rows);
  } catch (e) {
    console.warn("[boq/element-map] takeoff_items persist skipped:", e instanceof Error ? e.message : e);
  }
}
