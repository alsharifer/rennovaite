// =============================================================================
// lib/overlays/rules.ts — DEFAULT electrical/plumbing placement rules (P2).
//
// A plain data table: per room-type "category", a list of fixture rules with a
// count that is either fixed or derived from area (1 per `per_m2`, min 1).
// These are our PoC DEFAULTS for auto-seeding — NOT code-compliance rules
// (DEWA/DBC code checks are owned by P6). Every entry carries a one-line
// rationale. Seeded fixtures get source: 'rule'; the user can then adjust.
// =============================================================================

import type { FixtureType } from "./types";

export interface FixtureRule {
  type: FixtureType;
  /** Fixed count, OR area-derived: 1 fixture per `per_m2` (rounded up, min 1). */
  count?: number;
  per_m2?: number;
  /** Why this default exists (shown in code review / QS notes). */
  why: string;
}

// Canonical room categories the rules are keyed by. DB room_type strings are
// mapped onto these via roomCategory().
export type RoomCategory =
  | "bedroom"
  | "living"
  | "kitchen"
  | "bathroom"
  | "powder"
  | "closet"
  | "circulation"
  | "stairs"
  | "outdoor"
  | "other";

export function roomCategory(roomType: string | null): RoomCategory {
  switch (roomType) {
    case "master_bedroom":
    case "bedroom":
      return "bedroom";
    case "living":
    case "majlis":
    case "dining":
    case "family":
      return "living";
    case "kitchen":
      return "kitchen";
    case "bathroom":
    case "ensuite":
      return "bathroom";
    case "powder":
    case "toilet":
      return "powder";
    case "closet":
    case "dressing":
      return "closet";
    case "foyer":
    case "passage":
    case "corridor":
    case "hall":
      return "circulation";
    case "stairs":
      return "stairs";
    case "balcony":
    case "terrace":
      return "outdoor";
    default:
      return "other";
  }
}

export const ROOM_RULES: Record<RoomCategory, FixtureRule[]> = {
  // Bedrooms: 4 general sockets, 2-way switching at door + bedside, a light
  // point per ~12 m², and one split-AC point.
  bedroom: [
    { type: "socket_13a", count: 4, why: "2 bedside + 2 general 13A sockets." },
    { type: "switch_2way", count: 2, why: "2-way switching: door + bedside." },
    { type: "light_point", per_m2: 12, why: "1 ceiling light point per ~12 m²." },
    { type: "ac_point", count: 1, why: "1 split-AC indoor-unit point." },
  ],
  // Living / majlis / dining: more sockets, single-gang switching, a light
  // point per ~12 m², an AC point, and a TV/data point (structured cabling).
  living: [
    { type: "socket_13a", count: 6, why: "6 general 13A sockets for a living space." },
    { type: "switch_1g", count: 2, why: "2 single-gang lighting switches." },
    { type: "light_point", per_m2: 12, why: "1 ceiling light point per ~12 m²." },
    { type: "ac_point", count: 1, why: "1 split-AC indoor-unit point." },
    { type: "data_point", count: 1, why: "TV/data outlet — structured cabling." },
  ],
  // Kitchen: 6 above-counter sockets, one switch, denser lighting, plus a sink
  // supply/waste point and a washing-machine point.
  kitchen: [
    { type: "socket_kitchen", count: 6, why: "6 above-counter appliance sockets." },
    { type: "switch_1g", count: 1, why: "1 lighting switch." },
    { type: "light_point", per_m2: 8, why: "1 light point per ~8 m² (task lighting)." },
    { type: "sink_point", count: 1, why: "Kitchen sink supply + waste." },
    { type: "washing_machine_point", count: 1, why: "Washing-machine supply + waste." },
  ],
  // Full bathroom / ensuite: WC, basin, shower mixer, floor drain, water heater,
  // plus a light point, a switch, and a DP isolator for the heater.
  bathroom: [
    { type: "light_point", count: 1, why: "1 ceiling/IP-rated light point." },
    { type: "switch_1g", count: 1, why: "1 lighting switch (outside wet zone)." },
    { type: "dp_isolator", count: 1, why: "Double-pole isolator for the water heater." },
    { type: "wc_point", count: 1, why: "WC supply + soil connection." },
    { type: "basin_point", count: 1, why: "Basin supply + waste." },
    { type: "shower_mixer", count: 1, why: "Shower mixer supply." },
    { type: "floor_drain", count: 1, why: "Wet-area floor drain." },
    { type: "water_heater", count: 1, why: "Electric water heater (QS-priced)." },
  ],
  // Powder / guest WC: WC + basin only, one light and switch — no shower/heater.
  powder: [
    { type: "light_point", count: 1, why: "1 ceiling light point." },
    { type: "switch_1g", count: 1, why: "1 lighting switch." },
    { type: "wc_point", count: 1, why: "WC supply + soil connection." },
    { type: "basin_point", count: 1, why: "Basin supply + waste." },
  ],
  // Dressing/closet: a socket, a light, a switch.
  closet: [
    { type: "socket_13a", count: 1, why: "1 grooming/charging socket." },
    { type: "light_point", count: 1, why: "1 light point." },
    { type: "switch_1g", count: 1, why: "1 lighting switch." },
  ],
  // Foyer / passage: light on 2-way switching (both ends).
  circulation: [
    { type: "light_point", count: 1, why: "1 circulation light point." },
    { type: "switch_2way", count: 2, why: "2-way switching at both ends." },
  ],
  // Stairs: light on 2-way switching (top + bottom).
  stairs: [
    { type: "light_point", count: 1, why: "1 stair light point." },
    { type: "switch_2way", count: 2, why: "2-way switching top + bottom." },
  ],
  // Balcony / terrace: weatherproof socket, light, switch.
  outdoor: [
    { type: "socket_13a", count: 1, why: "1 weatherproof (IP) socket." },
    { type: "light_point", count: 1, why: "1 external light point." },
    { type: "switch_1g", count: 1, why: "1 lighting switch." },
  ],
  // Anything unclassified: minimal light + socket so nothing is left dark.
  other: [
    { type: "light_point", count: 1, why: "1 light point (fallback)." },
    { type: "socket_13a", count: 1, why: "1 general socket (fallback)." },
  ],
};

/** Resolve a rule's count for a given room area (area-derived rounds up, min 1). */
export function ruleCount(rule: FixtureRule, area_m2: number): number {
  if (rule.per_m2 && rule.per_m2 > 0) {
    return Math.max(1, Math.ceil((area_m2 || 0) / rule.per_m2));
  }
  return Math.max(0, rule.count ?? 0);
}
