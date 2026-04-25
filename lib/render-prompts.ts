// Prompt builder for Replicate / Flux. Anchors the model in
// "interior architectural photograph from inside the room" so it doesn't
// interpret the control image as the SUBJECT (which produced the hexagonal
// objects we saw with the old isometric-cube control image).

export type StyleKey =
  | "contemporary-majlis"
  | "modern-hijazi"
  | "coastal-emirati"
  | "scandi-arabic"
  | "andalusian-heritage"
  | "luxe-minimal";

// Pilot scope: first-floor refit covers these four room types.
export type RoomType =
  | "master-bedroom"
  | "secondary-bedroom"
  | "bathroom"
  | "living";

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

export const ROOM_TYPES: readonly RoomType[] = Object.keys(
  ROOM_FRAGMENTS,
) as RoomType[];

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
};

export function roomTypeFromDb(dbRoomType: string | null): RoomType | null {
  if (!dbRoomType) return null;
  return DB_ROOM_TYPE_MAP[dbRoomType] ?? null;
}
