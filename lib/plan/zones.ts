// =============================================================================
// lib/plan/zones.ts — the room/zone type vocabulary (garden pilot G1).
//
// A zone is a room with an outdoor kind. The model is NOT forked: outdoor zones
// live in `rooms` alongside interior rooms, carry a polygon and an area, and
// travel through the same PlanGraph. What separates them is one boolean —
// `unroofed` — and the fact that their type token is in OUTDOOR_ROOM_TYPES.
//
// Two facts this module exists to keep in one place:
//
//   1. The editor previously hard-coded `room_type: "other"` for every room a
//      user drew, and offered no way to change it. "other" fails every
//      downstream classifier (render, takeoff buckets, overlay seeding), so a
//      hand-drawn plan was silently uncostable. The picker reads its options
//      from here.
//   2. The parser's prompt (lib/parse/providers/inhouse.ts, Rule 3) explicitly
//      EXCLUDES gardens, pools, driveways and courtyards from a parse. That is
//      deliberate and unchanged by this pilot: outdoor zones reach the model
//      only by being drawn. INTERIOR_ROOM_TYPES below is a mirror of that
//      prompt's canonical token list and must stay in step with it.
// =============================================================================

/** Canonical interior tokens — mirrors the parser prompt's list exactly. */
export const INTERIOR_ROOM_TYPES = [
  "master_bedroom",
  "bedroom",
  "bathroom",
  "ensuite",
  "powder",
  "closet",
  "living",
  "dining",
  "kitchen",
  "majlis",
  "maid",
  "laundry",
  "foyer",
  "stairs",
  "balcony",
  "terrace",
  "storage",
  "other",
] as const;

/**
 * Outdoor zone tokens (garden pilot). `pool` is deliberately present and
 * deliberately out of pilot scope: the token exists so a drawn pool is stored
 * as a pool rather than mislabelled, but no takeoff rule prices one yet.
 */
export const OUTDOOR_ROOM_TYPES = [
  "paving",
  "artificial_grass",
  "planting_bed",
  "deck",
  "path",
  "structure",
  "pool",
] as const;

export type InteriorRoomType = (typeof INTERIOR_ROOM_TYPES)[number];
export type OutdoorRoomType = (typeof OUTDOOR_ROOM_TYPES)[number];
export type RoomOrZoneType = InteriorRoomType | OutdoorRoomType;

const OUTDOOR_SET: ReadonlySet<string> = new Set(OUTDOOR_ROOM_TYPES);
const INTERIOR_SET: ReadonlySet<string> = new Set(INTERIOR_ROOM_TYPES);

/** True for the garden-pilot outdoor tokens only. `balcony`/`terrace` are NOT
 *  outdoor zones: they are enclosed interior-adjacent rooms the parser already
 *  emits, priced by the existing EXTERNAL_TYPES rules. Reclassifying them here
 *  would change every previously-parsed villa. */
export function isOutdoorType(type: string | null | undefined): boolean {
  return type != null && OUTDOOR_SET.has(type);
}

export function isKnownRoomType(type: string | null | undefined): boolean {
  return type != null && (OUTDOOR_SET.has(type) || INTERIOR_SET.has(type));
}

/**
 * Whether a zone of this type has no roof by default.
 *
 * `structure` — a pergola or outdoor-counter footprint — defaults unroofed too.
 * A pergola is open to the sky by construction, and the one that is not gets an
 * explicit height in the 3D scene rather than an implied 2.9 m ceiling.
 */
export function defaultUnroofed(type: string | null | undefined): boolean {
  return isOutdoorType(type);
}

/** Types the pilot's takeoff rules actually price. */
export function isPilotScoped(type: string | null | undefined): boolean {
  return isOutdoorType(type) && type !== "pool";
}

const LABELS: Record<string, string> = {
  master_bedroom: "Master bedroom",
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  ensuite: "Ensuite",
  powder: "Powder room",
  closet: "Closet / dressing",
  living: "Living",
  dining: "Dining",
  kitchen: "Kitchen",
  majlis: "Majlis",
  maid: "Maid's room",
  laundry: "Laundry",
  foyer: "Foyer",
  stairs: "Stairs",
  balcony: "Balcony",
  terrace: "Terrace",
  storage: "Storage",
  other: "Other",
  paving: "Paving",
  artificial_grass: "Artificial grass",
  planting_bed: "Planting bed",
  deck: "Deck",
  path: "Path",
  structure: "Structure footprint",
  pool: "Pool",
};

/**
 * Surface description for an outdoor zone — its type IS its finish. Shared by
 * the finish schedule and the render pack so the two documents say the same.
 */
const ZONE_SURFACES: Record<string, string> = {
  paving: "Paving to landscape spec",
  artificial_grass: "Artificial grass on prepared base",
  planting_bed: "Planting bed — topsoil and edging",
  deck: "Timber / composite decking",
  path: "Path finish to landscape spec",
  structure: "Structure base slab",
  pool: "Pool — out of scope",
};

export function zoneSurface(type: string | null | undefined): string {
  return (type && ZONE_SURFACES[type]) || "Open zone — surface to be specified";
}

export function roomTypeLabel(type: string | null | undefined): string {
  if (!type) return "Unclassified";
  return LABELS[type] ?? type;
}

export interface RoomTypeOption {
  value: RoomOrZoneType;
  label: string;
  /** Set on the one option the pilot stores but does not price. */
  note?: string;
}

export interface RoomTypeGroup {
  label: string;
  options: RoomTypeOption[];
}

/**
 * Options for the editor's type picker. Outdoor zones are offered only when the
 * garden pilot is on, so an interior project's picker is exactly the parser's
 * vocabulary and nothing else.
 */
export function roomTypeOptions(outdoorEnabled: boolean): RoomTypeGroup[] {
  const groups: RoomTypeGroup[] = [
    {
      label: "Interior",
      options: INTERIOR_ROOM_TYPES.map((v) => ({ value: v, label: roomTypeLabel(v) })),
    },
  ];
  if (outdoorEnabled) {
    groups.push({
      label: "Outdoor zone",
      options: OUTDOOR_ROOM_TYPES.map((v) => ({
        value: v,
        label: roomTypeLabel(v),
        ...(isPilotScoped(v) ? {} : { note: "not priced yet" }),
      })),
    });
  }
  return groups;
}
