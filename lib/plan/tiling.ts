// =============================================================================
// lib/plan/tiling.ts — a wet room's tiled height, in words and in the record
// (bathroom pilot B5, migration 065).
//
// Pure and client-safe. The rule (room sheet §7 item 7): per room a tiled height
// — full height by default for a wet room — with wall paint only ABOVE it and the
// ceiling always (lib/boq/quantify.ts). A dado (say 1.20 m) moves both lines
// together: wet tiling down, wall paint up.
//
// An edit is a `design_edit` on layer "tiling" with the rooms it moved
// ({ id, name, from, to } — null = full height); the revision diff names the NET
// change in its window on the tiling and paint lines ("Tiled height — Bathroom
// full height → 1.20 m"), and Regenerate reads "Tiled height changed since rev N".
// =============================================================================

/** Room types whose walls are tiled (the element take-off's wet rooms). */
export const TILED_ROOM_TYPES = ["bathroom", "ensuite", "powder", "kitchen"] as const;
export const isTiledRoomType = (t: string | null | undefined) => (TILED_ROOM_TYPES as readonly string[]).includes(t ?? "");

/** The take-off lines a tiled height moves. */
export const TILING_ITEM_KEYS = ["wet_tiling", "wall_paint"] as const;

export const TILING_BOUNDS_M = [0, 6] as const;

export interface TilingEdit {
  id: string;
  name?: string | null;
  from: number | null;
  to: number | null;
}

const fmt = (h: number | null) => (h == null ? "full height" : `${Number(h).toFixed(2)} m`);

/** "full height" / "1.20 m". */
export const tiledLabel = fmt;

/** The net change per room over a window of edits, unchanged rooms dropped. */
export function netTilingChange(events: readonly { rooms: readonly TilingEdit[] }[]): TilingEdit[] {
  const by = new Map<string, TilingEdit>();
  for (const e of events) {
    for (const r of e.rooms) {
      const cur = by.get(r.id);
      by.set(r.id, { id: r.id, name: r.name ?? cur?.name ?? null, from: cur ? cur.from : r.from, to: r.to });
    }
  }
  return [...by.values()].filter((r) => r.from !== r.to);
}

/** "Bathroom full height → 1.20 m" · "2 rooms" beyond one. */
export function tilingChangeSummary(changes: readonly TilingEdit[]): string {
  if (changes.length === 1) {
    const c = changes[0]!;
    return `${c.name?.trim() || "a room"} ${fmt(c.from)} → ${fmt(c.to)}`;
  }
  return `${changes.length} rooms`;
}
