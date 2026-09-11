// =============================================================================
// lib/parse/disputes.ts — carry an area dispute from the parse to the editor.
//
// `repairOverlaps` records a dispute when a room's PRINTED dimension and its
// outline cannot both be right. The measurement wins, because a vision model's
// read of where the walls are does not outrank a number the architect typed.
// But that leaves a room whose outline is probably wrong, and only a person can
// say which. So the dispute has to reach the editor.
//
// It cannot travel by id. The parse writes rooms with the provider's slugs
// ("bathroom-01") and the database hands back fresh uuids, so by the time the
// editor loads a plan the slug is gone. Rather than add a column for it, a
// dispute is matched on the three things that do survive the round trip: the
// room's name, its type, and the area — which for a disputed room is by
// definition the stated one, because that is the branch that records a dispute.
//
// That key also gives the right behaviour over time for free. Correct the
// outline and the editor recomputes the area, so the key stops matching and the
// issue clears. Accept the outline's figure and the same thing happens. Keep the
// label and leave the shape alone, and the issue comes back on reload — which is
// correct, because it is still true.
//
// Pure: no DB, no React.
// =============================================================================

import type { AreaDispute } from "./repair";

/** A room as the parse recorded it, keyed by the provider's slug. */
export interface ParsedRoomRef {
  id: string;
  name_en?: string | null;
  room_type?: string | null;
}

/** A room as the database returns it to the plan page. */
export interface DbRoomRef {
  id: string;
  name_en?: string | null;
  room_type?: string | null;
  area_m2?: number | null;
}

/** A dispute addressed to a room the editor actually has on screen. */
export interface RoomAreaDispute {
  /** The database room id, so the editor can select and mark it. */
  room_id: string;
  /** What the drawing prints. Currently the room's area. */
  stated_area_m2: number;
  /** What the outline works out to. What the room's area would become. */
  geometric_area_m2: number;
}

const key = (name: unknown, type: unknown, area: unknown) =>
  `${String(name ?? "").trim().toLowerCase()}|${String(type ?? "").trim().toLowerCase()}|${
    typeof area === "number" ? area.toFixed(2) : ""
  }`;

/**
 * Re-address parse-time disputes to the database rooms they describe.
 *
 * Rooms that cannot be matched are dropped rather than guessed at: showing
 * someone a contradiction about the wrong room is worse than showing nothing.
 */
export function resolveDisputes(
  disputes: readonly AreaDispute[],
  parsedRooms: readonly ParsedRoomRef[],
  dbRooms: readonly DbRoomRef[],
): RoomAreaDispute[] {
  if (disputes.length === 0) return [];

  const parsedById = new Map(parsedRooms.map((r) => [r.id, r]));

  // Bucket the database rooms by key; duplicates (two "Bath" of equal area)
  // pair off in order, which is as well-defined as the question allows.
  const buckets = new Map<string, string[]>();
  for (const room of dbRooms) {
    const k = key(room.name_en, room.room_type, room.area_m2);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(room.id);
    else buckets.set(k, [room.id]);
  }

  const out: RoomAreaDispute[] = [];
  for (const dispute of disputes) {
    const parsed = parsedById.get(dispute.room_id);
    if (!parsed) continue;
    const bucket = buckets.get(key(parsed.name_en, parsed.room_type, dispute.stated_area_m2));
    const roomId = bucket?.shift();
    if (!roomId) continue;
    out.push({
      room_id: roomId,
      stated_area_m2: dispute.stated_area_m2,
      geometric_area_m2: dispute.geometric_area_m2,
    });
  }
  return out;
}

/** Read the disputes out of a plan's `parsed_json`, tolerating every shape a
 *  plan parsed before this existed might have. Never throws. */
export function disputesFromParsedJson(parsedJson: unknown): {
  disputes: AreaDispute[];
  rooms: ParsedRoomRef[];
} {
  const empty = { disputes: [], rooms: [] };
  if (!parsedJson || typeof parsedJson !== "object") return empty;
  const root = parsedJson as { parse?: unknown; rooms?: unknown };

  const parse = root.parse;
  const rawDisputes =
    parse && typeof parse === "object" && Array.isArray((parse as { disputes?: unknown }).disputes)
      ? ((parse as { disputes: unknown[] }).disputes)
      : [];

  const disputes: AreaDispute[] = [];
  for (const d of rawDisputes) {
    if (!d || typeof d !== "object") continue;
    const { room_id, stated_area_m2, geometric_area_m2 } = d as Record<string, unknown>;
    if (
      typeof room_id === "string" &&
      typeof stated_area_m2 === "number" &&
      typeof geometric_area_m2 === "number"
    ) {
      disputes.push({ room_id, stated_area_m2, geometric_area_m2 });
    }
  }
  if (disputes.length === 0) return empty;

  const rooms: ParsedRoomRef[] = [];
  if (Array.isArray(root.rooms)) {
    for (const r of root.rooms) {
      if (!r || typeof r !== "object") continue;
      const { id, name_en, room_type } = r as Record<string, unknown>;
      if (typeof id === "string") {
        rooms.push({
          id,
          name_en: typeof name_en === "string" ? name_en : null,
          room_type: typeof room_type === "string" ? room_type : null,
        });
      }
    }
  }
  return { disputes, rooms };
}
