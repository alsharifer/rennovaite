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
import type { ElementPricer } from "./rates";
import { rechain, type ChainedDoc } from "./totals";

// H7: section order is the canonical one (lib/boq/section-order.ts), applied by rechain.

/** Engine lines in a mapped section that the take-off does not measure, kept on rebuild. */
const KEPT_RULE_PREFIXES = ["Q-11b", "Q-11/", "Q-10/"] as const;

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

/**
 * Replace the mapped POMI sections with take-off-derived ones (real quantities +
 * element_refs) and recompute the contingency/VAT/grand-total chain. Returns the
 * same object shape. No-op when there are no take-off items.
 */
export function applyElementMapping<T extends BoqLike>(boq: T, items: TakeoffItem[], price?: ElementPricer): T {
  if (items.length === 0) return boq;

  // T3b: the rebuilt sections price through the rate resolver's element hook
  // (firm tiers first, element constant otherwise).
  const mapped = assembleMappedSections(items, price);

  // P8b: the staircase tile (engine rule Q-11b) lives in Floor Finishes, a
  // MAPPED section — so P4 mapping would drop it. Preserve it by re-appending it
  // to the rebuilt Floor Finishes. Its footprint is already excluded from the P4
  // floor_finish (quantify.ts), so there is no double-count.
  //
  // K12 follow-up (ruled 14 Oct): the staircase RENOVATION (Q-11, R-36) was
  // dropped the same way — every plan with an element take-off lost its stair
  // fixing labour and LED nosing. It is labour only (R-36's note: the material
  // is Q-11b alone) and the take-off prices nothing on the stairs, so it is kept
  // too — never a second tile supply.
  //
  // Bathroom-pilot pre-flight (18 Oct): the SKIRTING (Q-10, R-10 — F-04: dry
  // rooms + terrace perimeter − doors; wet rooms take none) was dropped the
  // same way. The take-off measures no skirting and floor_finish is the floor
  // only, so the engine's line is kept as it was priced.
  const keptLines = boq.sections
    .filter((s) => MAPPED_SECTIONS.includes(s.work_section))
    .flatMap((s) => s.lines as { rule_id?: string; total_aed?: number }[])
    .filter((l) => typeof l.rule_id === "string" && KEPT_RULE_PREFIXES.some((p) => l.rule_id!.startsWith(p)));
  if (keptLines.length > 0) {
    let ff = mapped.find((m) => m.work_section === "Floor Finishes");
    // A take-off with no floor_finish item still keeps them (rechain totals it).
    if (!ff) mapped.push((ff = { work_section: "Floor Finishes", lines: [], section_total_aed: 0 }));
    ff.lines.push(...(keptLines as unknown as (typeof ff.lines)));
  }

  const kept = boq.sections.filter((s) => !MAPPED_SECTIONS.includes(s.work_section));
  // H7: canonical order, section totals, subtotal and chain — all by rechain.
  return rechain({ ...boq, sections: [...kept, ...(mapped as unknown as BoqSectionLike[])] } as unknown as ChainedDoc) as unknown as T;
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
