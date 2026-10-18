// =============================================================================
// lib/plan/ceiling.ts — a room's ceiling height, in words and in the record (B1).
//
// Pure and client-safe. 061 lets a room STORE its height (01 Plan, or the room
// intake); a room that stores none keeps the 2.9 m default, derived. Every
// wall area follows it — wet tiling, plaster, paint (lib/boq/quantify.ts), and
// the engine's C-01 / C-04 lines (lib/boq/takeoff.ts).
//
// An edit is a `design_edit` on layer "ceiling" with the rooms it moved
// ({ id, name, from, to } — null = the default); the revision diff names the
// NET change in its window as the cause on the wall-area lines, and the
// Regenerate control reads "Ceiling height changed since rev N".
// =============================================================================

import { DEFAULT_CEILING_H_M } from "./geometry";

/** The take-off lines a ceiling height drives (the element take-off's wall areas). */
export const CEILING_ITEM_KEYS = ["wall_plaster", "wall_paint", "wet_tiling", "demolition"] as const;

export const CEILING_BOUNDS_M = [1.8, 6] as const;

/** "2.80 m · measured" / "2.90 m · default". */
export function ceilingLabel(h: number | null | undefined, source?: string | null): string {
  if (h == null || !(Number(h) > 0)) return `${DEFAULT_CEILING_H_M.toFixed(2)} m · default`;
  return `${Number(h).toFixed(2)} m · ${source === "derived" ? "derived" : "measured"}`;
}

export interface CeilingEdit {
  id: string;
  name?: string | null;
  from: number | null;
  to: number | null;
}

/** The net change per room over a window of edits (first `from` → last `to`), unchanged rooms dropped. */
export function netCeilingChange(events: readonly { rooms: readonly CeilingEdit[] }[]): CeilingEdit[] {
  const by = new Map<string, CeilingEdit>();
  for (const e of events) {
    for (const r of e.rooms) {
      const cur = by.get(r.id);
      by.set(r.id, { id: r.id, name: r.name ?? cur?.name ?? null, from: cur ? cur.from : r.from, to: r.to });
    }
  }
  // Only a height that moves a quantity: stating 2.90 over the 2.90 default moves none.
  return [...by.values()].filter((r) => (r.from ?? DEFAULT_CEILING_H_M) !== (r.to ?? DEFAULT_CEILING_H_M));
}

const fmt = (h: number | null) => (h == null ? `${DEFAULT_CEILING_H_M.toFixed(2)} (default)` : Number(h).toFixed(2));

/** "Bathroom 2.90 (default) → 2.80 m" · "2 rooms" beyond one. */
export function ceilingChangeSummary(changes: readonly CeilingEdit[]): string {
  if (changes.length === 1) {
    const c = changes[0]!;
    return `${c.name?.trim() || "a room"} ${fmt(c.from)} → ${fmt(c.to)} m`;
  }
  return `${changes.length} rooms`;
}
