// =============================================================================
// lib/viewer/materials.ts — StyleBoard finish selection → per-surface material
// spec for the 3D walkthrough (F1).
//
// PURE DATA AND PURE FUNCTIONS. No three.js, no DOM, no textures — this module
// only decides WHICH material each surface should have. Turning a spec into an
// actual THREE material is the client's job (lib/viewer/textures.ts).
//
// Three rules govern the mapping, in order:
//
//   1. A surface with no chosen finish stays CLAY. Returning null here is the
//      honest answer, not a gap: clay in the walkthrough means "nobody has
//      picked this yet", and inventing a plausible material would erase that
//      signal. Unscoped rooms (terraces, balconies, stairs) are never given a
//      finish for the same reason — the renovation does not cover them.
//   2. Wet rooms override the style. Whatever the direction says about floors
//      and walls, a bathroom is tiled, because that is what the scope prices
//      (lib/boq/quantify.ts emits `wet_tiling` for exactly these room types).
//      The viewer must not show painted walls where the BoQ charges for tile.
//   3. Otherwise the locked style decides, per surface.
//
// Families are deliberately few. The texture set is curated and keyed by
// family, so adding a style costs a row here and no new assets.
// =============================================================================

import { styleFinishes } from "./finishes";

/** The curated texture families. One tileable texture each; `paint` is flat. */
export type FinishFamily = "tile" | "wood" | "stone" | "plaster" | "paint";

export interface SurfaceFinish {
  family: FinishFamily;
  /** Base colour (hex). Tinted under the texture, or used flat. */
  color: string;
  /** Human label, shown in the inspector and the legend. */
  label: string;
}

/**
 * Room types the renovation scope does not cover. These keep clay however the
 * style is set — see rule 1. Mirrors the outdoor/circulation types the parser
 * emits.
 */
const UNSCOPED_ROOM_TYPES = new Set([
  "balcony",
  "terrace",
  "garden",
  "yard",
  "parking",
  "garage",
  "stairs",
  "shaft",
  "void",
]);

/**
 * Wet rooms, byte-identical to `WET_ROOM_TYPES` in lib/boq/quantify.ts. If that
 * set changes, this one must change with it — the viewer showing tile where the
 * BoQ prices paint (or the reverse) is worse than showing clay.
 */
const WET_ROOM_TYPES = new Set(["bathroom", "ensuite", "powder", "kitchen"]);

export function isUnscopedRoom(roomType: string | null | undefined): boolean {
  return UNSCOPED_ROOM_TYPES.has(roomType ?? "");
}

export function isWetRoom(roomType: string | null | undefined): boolean {
  return WET_ROOM_TYPES.has(roomType ?? "");
}

/** Per-style surface families + base colours. Labels come from `styleFinishes`. */
const STYLE_SURFACES: Record<
  string,
  { floor: { family: FinishFamily; color: string }; wall: { family: FinishFamily; color: string } }
> = {
  "contemporary-majlis": {
    floor: { family: "stone", color: "#E8DFD0" }, // honed travertine
    wall: { family: "paint", color: "#F5F1EA" },
  },
  "modern-hijazi": {
    floor: { family: "wood", color: "#8A5A3B" }, // solid mahogany
    wall: { family: "plaster", color: "#F2EADC" }, // ivory Tadelakt
  },
  "coastal-emirati": {
    floor: { family: "wood", color: "#E4D8C4" }, // bleached oak
    wall: { family: "plaster", color: "#EFE6D6" }, // sand limewash
  },
  "scandi-arabic": {
    floor: { family: "wood", color: "#EDE4D2" }, // pale white oak
    wall: { family: "paint", color: "#F7F4EE" },
  },
  "andalusian-heritage": {
    floor: { family: "tile", color: "#CDB48F" }, // encaustic cement tile
    wall: { family: "plaster", color: "#F0E8D8" },
  },
  "luxe-minimal": {
    floor: { family: "stone", color: "#E6E2DB" }, // book-matched slab
    wall: { family: "plaster", color: "#EDEAE4" }, // micro-cement
  },
};

/** Wet-room finishes. Independent of style — the scope, not the direction. */
const WET_FLOOR: Omit<SurfaceFinish, "label"> = { family: "tile", color: "#DCD6CC" };
const WET_WALL: Omit<SurfaceFinish, "label"> = { family: "tile", color: "#E7E2D9" };

/**
 * Floor finish for one room, or null to keep clay.
 * Wet rooms are tiled regardless of style; unscoped rooms are never finished.
 */
export function floorFinishForRoom(
  styleKey: string | null | undefined,
  roomType: string | null | undefined,
): SurfaceFinish | null {
  if (isUnscopedRoom(roomType)) return null;
  if (!styleKey || !STYLE_SURFACES[styleKey]) return null;
  if (isWetRoom(roomType)) {
    return { ...WET_FLOOR, label: "Porcelain floor tile (wet area)" };
  }
  const s = STYLE_SURFACES[styleKey]!.floor;
  return { ...s, label: styleFinishes(styleKey).floor };
}

/**
 * Wall finish for one room, or null to keep clay.
 * Wet rooms get full-height tile — matching the `wet_tiling` line the BoQ
 * measures as perimeter × ceiling height.
 */
export function wallFinishForRoom(
  styleKey: string | null | undefined,
  roomType: string | null | undefined,
): SurfaceFinish | null {
  if (isUnscopedRoom(roomType)) return null;
  if (!styleKey || !STYLE_SURFACES[styleKey]) return null;
  if (isWetRoom(roomType)) {
    return { ...WET_WALL, label: "Full-height wall tile (wet area)" };
  }
  const s = STYLE_SURFACES[styleKey]!.wall;
  return { ...s, label: styleFinishes(styleKey).wall };
}

export interface RoomFinishInput {
  id: string;
  type: string | null;
}

export interface FinishPlan {
  floorByRoom: Record<string, SurfaceFinish | null>;
  wallByRoom: Record<string, SurfaceFinish | null>;
  /** Rooms left clay, for the legend's "not yet chosen" count. */
  unfinishedRoomIds: string[];
}

/** Build the whole plan in one pass. Server-side; the result is serialisable. */
export function buildFinishPlan(
  styleKey: string | null | undefined,
  rooms: RoomFinishInput[],
): FinishPlan {
  const floorByRoom: Record<string, SurfaceFinish | null> = {};
  const wallByRoom: Record<string, SurfaceFinish | null> = {};
  const unfinishedRoomIds: string[] = [];
  for (const r of rooms) {
    const floor = floorFinishForRoom(styleKey, r.type);
    const wall = wallFinishForRoom(styleKey, r.type);
    floorByRoom[r.id] = floor;
    wallByRoom[r.id] = wall;
    if (!floor && !wall) unfinishedRoomIds.push(r.id);
  }
  return { floorByRoom, wallByRoom, unfinishedRoomIds };
}
