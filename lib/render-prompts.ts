// Prompt builder for Replicate / Flux. Anchors the model in
// "interior architectural photograph from inside the room" so it doesn't
// interpret the control image as the SUBJECT (which produced the hexagonal
// objects we saw with the old isometric-cube control image).

import { getGardenStyle, isGardenStyleKey, type GardenStyleKey } from "@/lib/garden-styles";
import { getStyleByKey } from "@/lib/styles";

export type InteriorStyleKey =
  | "contemporary-majlis"
  | "modern-hijazi"
  | "coastal-emirati"
  | "scandi-arabic"
  | "andalusian-heritage"
  | "luxe-minimal";

/** G1b: interior directions plus the two exterior ones. */
export type StyleKey = InteriorStyleKey | GardenStyleKey;

// Pilot scope: the first-floor refit covers four interior room types. G1b adds
// two EXTERIOR types, which is all a garden needs: a zone of ground (paving,
// lawn, planting, deck, path, pool, and the terraces and balconies that were a
// hard 400 until now) and a built structure standing on it.
export type InteriorRoomType =
  | "master-bedroom"
  | "secondary-bedroom"
  | "bathroom"
  | "living";

export type ExteriorRoomType = "garden-zone" | "outdoor-structure";

export type RoomType = InteriorRoomType | ExteriorRoomType;

const EXTERIOR_ROOM_TYPES: ReadonlySet<string> = new Set<ExteriorRoomType>([
  "garden-zone",
  "outdoor-structure",
]);

export function isExteriorRoomType(t: string | null | undefined): t is ExteriorRoomType {
  return t != null && EXTERIOR_ROOM_TYPES.has(t);
}

const PROMPT_HEAD =
  "Architectural interior photograph, taken from inside the room at human eye height (approximately 1.6m), looking toward the back wall. Wide-angle 24mm lens.";

const PROMPT_TAIL =
  "Visible: floor, ceiling, side walls in perspective, with the back wall in the centre of frame. Magazine-quality interior photography, soft natural daylight from the side, 4k, ultra-detailed, no people, no text, no abstract objects, no sculpture, no geometric shape, no top-down view, no isometric view, no floating object, no hexagon, no cube, no render of a single piece of furniture, no bird's eye view.";

// Negative prompt for models that accept one as a separate field (most
// FLUX-pro models do not — bake into PROMPT_TAIL above instead).
export const NEGATIVE_PROMPT =
  "abstract object, sculpture, geometric shape, top-down view, isometric view, no walls visible, floating object, hexagon, cube, render of a single piece of furniture, bird's eye view";

// Style finishes — palette + signature materials per direction.
// Each ends with a trailing comma so it concatenates cleanly with the room.
const STYLE_FRAGMENTS: Record<StyleKey, string> = {
  // G1b exterior directions.
  "desert-modern":
    "large-format honed sandstone paving, clipped low lawn, corten steel linear planters, architectural grasses and agave, warm buff and sage palette, concealed step lighting,",
  "courtyard-majlis":
    "shaded timber pergola, raised majlis platform with floor cushions, patterned cement tile bordered in honed limestone, date palms, lime-rendered boundary walls, a wall-set water spout,",
  "contemporary-majlis":
    "warm walnut paneling, brushed gold accents, low-profile silhouettes, neutral linen upholstery, sculptural alabaster pendant,",
  "modern-hijazi":
    "carved mashrabiya screens, deep burgundy paneled walls, burnished brass hardware, hand-loomed kilim rug, latticework cabinet doors,",
  "coastal-emirati":
    "bleached oak floors, woven jute area rugs, sea-glass blue accents, whitewashed plaster walls, rattan-wrapped pendant lighting,",
  "scandi-arabic":
    "pale ash flooring, off-white linen drapery, soft sage and warm sand textiles, a single mashrabiya silhouette panel, minimal matte black hardware,",
  "andalusian-heritage":
    "hand-cut cobalt zellige tilework, carved plaster muqarnas detailing, ochre tadelakt walls, hammered copper accents, brass-studded ivory upholstery,",
  "luxe-minimal":
    "honed calacatta stone surfaces, smoked oak veneer cabinetry, brushed champagne brass, integrated concealed lighting, soft graphite tonal palette,",
};

// Room cues — each one anchors specific objects against named walls so the
// AI stops drifting toward "object-in-frame" interpretations.
const ROOM_FRAGMENTS: Record<RoomType, string> = {
  // G1b: the frame is the garden, not a wall. These anchor an outdoor scene so
  // the model does not read the ground plane as a room floor.
  "garden-zone":
    "open outdoor ground running to a boundary wall at the back, planting along one side, seating or a low bench in the middle distance, open sky above",
  "outdoor-structure":
    "a shading structure standing in the open on its own base, seating beneath it, garden ground running out on every side, open sky beyond the roof",
  "master-bedroom":
    "low king-size platform bed against the back wall, soft layered linens, integrated bedside lighting, curtains visible on the side wall",
  "secondary-bedroom":
    "single or twin bed against the side wall, study desk visible in the corner, integrated wardrobe along one wall",
  bathroom:
    "vanity with mirror against the back wall, shower or bath visible on the side, large-format porcelain wall tiles, glass partition",
  living:
    "modular sofa facing the camera, coffee table in the foreground, feature wall visible at the back, full-height curtains on the side",
};

export type BuildRenderPromptInput = {
  styleKey: StyleKey;
  roomType: RoomType;
};

export function buildRenderPrompt({
  styleKey,
  roomType,
}: BuildRenderPromptInput): string {
  const styleFrag = STYLE_FRAGMENTS[styleKey];
  const roomFrag = ROOM_FRAGMENTS[roomType];
  if (!styleFrag) throw new Error(`Unknown styleKey: ${styleKey}`);
  if (!roomFrag) throw new Error(`Unknown roomType: ${roomType}`);
  return `${PROMPT_HEAD} ${styleFrag} ${roomFrag}. ${PROMPT_TAIL}`;
}

// All recognised keys, useful for iterating the full 6×4 matrix in tests
// or admin tooling.
export const STYLE_KEYS: readonly StyleKey[] = Object.keys(
  STYLE_FRAGMENTS,
) as StyleKey[];

/** The six interior directions alone. Staging, the style picker and the
 *  ideation scorer all mean these, never the two exterior ones. */
export const INTERIOR_STYLE_KEYS: readonly InteriorStyleKey[] = STYLE_KEYS.filter(
  (k): k is InteriorStyleKey => !isGardenStyleKey(k),
);

export const ROOM_TYPES: readonly RoomType[] = Object.keys(
  ROOM_FRAGMENTS,
) as RoomType[];

/** The four interior room types alone. */
export const INTERIOR_ROOM_TYPES: readonly InteriorRoomType[] = ROOM_TYPES.filter(
  (t): t is InteriorRoomType => !isExteriorRoomType(t),
);

// Database `rooms.room_type` uses snake_case (e.g. "master_bedroom"). Use
// this when adapting from the parsed-plan schema to this prompt builder.
const DB_ROOM_TYPE_MAP: Record<string, RoomType> = {
  master_bedroom: "master-bedroom",
  bedroom: "secondary-bedroom",
  bathroom: "bathroom",
  ensuite: "bathroom",
  powder: "bathroom",
  living: "living",
  majlis: "living",
  dining: "living",
  // G1b — outdoor zones. Every garden token is a zone of ground; `structure`
  // is the one that stands on it. `terrace` and `balcony` land here too: they
  // are outdoor rooms, they were a hard 400 before this map grew, and a
  // garden-zone render of a terrace is a great deal closer to the truth than
  // refusing to render it.
  paving: "garden-zone",
  artificial_grass: "garden-zone",
  planting_bed: "garden-zone",
  deck: "garden-zone",
  path: "garden-zone",
  pool: "garden-zone",
  terrace: "garden-zone",
  balcony: "garden-zone",
  structure: "outdoor-structure",
};

export function roomTypeFromDb(dbRoomType: string | null): RoomType | null {
  if (!dbRoomType) return null;
  return DB_ROOM_TYPE_MAP[dbRoomType] ?? null;
}

/** Room types this pipeline can render, for an honest "what IS supported"
 *  message when a room type is not one of them. */
export const RENDERABLE_DB_ROOM_TYPES: readonly string[] = Object.keys(DB_ROOM_TYPE_MAP);

// ---------------------------------------------------------------------------
// Photo-first / edit-model prompts
// ---------------------------------------------------------------------------
//
// buildRenderPrompt above targets the old text-to-image (flux-canny/depth)
// path and bakes in camera + negative clauses. The edit model (nano-banana)
// preserves the source image's geometry itself, so its prompt is shorter and
// framed as a restyle instruction. buildOffplanBasePrompt describes the empty
// shell the base model synthesises before that restyle.

// Human-readable room label for prose prompts.
const ROOM_LABELS: Record<RoomType, string> = {
  "master-bedroom": "bedroom",
  "secondary-bedroom": "bedroom",
  bathroom: "bathroom",
  living: "living room",
  "garden-zone": "garden area",
  "outdoor-structure": "garden structure",
};

export type BuildEditPromptInput = {
  styleKey: StyleKey;
  roomType: RoomType;
};

// Restyle instruction for the edit model. Preserves architecture/geometry
// (the model reads it from the source image) and injects the chosen style's
// signature materials + palette. KG context and the Materials: clause are
// appended by the caller so they land in the cache key.
export function buildEditPrompt({
  styleKey,
  roomType,
}: BuildEditPromptInput): string {
  const styleFrag = STYLE_FRAGMENTS[styleKey];
  if (!styleFrag) throw new Error(`Unknown styleKey: ${styleKey}`);
  const style = isGardenStyleKey(styleKey)
    ? getGardenStyle(styleKey)
    : getStyleByKey(styleKey);
  const styleName = style?.name_en ?? styleKey;
  const palette = style ? style.palette.join(", ") : "";
  const paletteClause = palette ? ` Palette anchors: ${palette}.` : "";
  const roomLabel = ROOM_LABELS[roomType];
  // An exterior scene has no ceiling and no back wall, so the "keep the room's
  // architecture" clause would be asking the model to preserve things that are
  // not there. What must hold outdoors is the ground plane and the boundary.
  if (isExteriorRoomType(roomType)) {
    return `Redesign this exact ${roomLabel} in ${styleName} style: ${styleFrag}${paletteClause} Keep the site's shape, boundary wall positions, levels, existing trees and camera angle exactly the same. Photorealistic landscape photography, daylight, magazine quality.`;
  }
  return `Renovate this exact ${roomLabel} in ${styleName} style: ${styleFrag}${paletteClause} Keep the room's architecture, wall positions, window and door locations, and camera angle exactly the same. Photorealistic interior photography, magazine quality.`;
}

export type BuildOffplanBasePromptInput = {
  roomType: RoomType;
  widthM?: number | null;
  depthM?: number | null;
};

// Text-to-image prompt for the empty-room shell (off-plan path). Dimensions are
// optional — when the polygon is missing we drop the size clause rather than
// invent numbers.
export function buildOffplanBasePrompt({
  roomType,
  widthM,
  depthM,
}: BuildOffplanBasePromptInput): string {
  const roomLabel = ROOM_LABELS[roomType];
  const dims =
    widthM && depthM
      ? `${widthM.toFixed(1)}m wide by ${depthM.toFixed(1)}m deep, `
      : "";
  // G1b: a garden's empty shell is a FLAT GROUND PLANE inside a boundary, not a
  // room. Synthesising a room shell and then restyling it outdoors gave the
  // edit model a ceiling and three walls to argue with, and it kept them.
  if (isExteriorRoomType(roomType)) {
    const boundary =
      roomType === "outdoor-structure"
        ? "a bare concrete base slab standing in the open"
        : "bare compacted sand and dust";
    return `Empty ${roomLabel} before landscaping, ${dims}flat level ground, ${boundary}, plain unpainted blockwork boundary wall about 1.8m high running around the plot, no planting, no paving, no furniture, open sky, bright Dubai daylight, photorealistic, eye-level 24mm.`;
  }
  return `Empty unfurnished ${roomLabel}, ${dims}ceiling 2.9m, a single window on one side wall, screed floor, white primed walls, photorealistic, eye-level 24mm.`;
}
