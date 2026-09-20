// =============================================================================
// lib/garden-styles.ts — the two exterior directions (garden pilot G1b).
//
// Deliberately a SEPARATE module from lib/styles.ts rather than two more
// entries in STYLES. That array is not just a list: lib/ideation/questionnaire
// scores every entry in it to recommend a direction, the moodboard page builds
// its reference catalogue from it, and the style page renders all of it. Adding
// garden directions there would have changed the ideation recommendation for
// every interior villa and put a lawn in the moodboard picker for a bedroom.
//
// The pilot needs two exterior directions, not eight, and it needs them to
// reach the render pipeline — which is exactly what this module does.
// =============================================================================

import type { Style } from "@/lib/styles";

/** Room segments the exterior moodboard art covers (same naming as the 24). */
const GARDEN_ROOMS = ["garden", "structure"] as const;

function imagesFor(styleKey: string): string[] {
  return GARDEN_ROOMS.map((room) => `/moodboards/${styleKey}-${room}.png`);
}

export type GardenStyleKey = "desert-modern" | "courtyard-majlis";

/** Structurally a `Style` from lib/styles.ts (narrower key, shorter image list),
 *  so any surface that renders "the project's direction" takes either. */
export interface GardenStyle extends Style {
  key: GardenStyleKey;
  /** Same asset shape and naming as the interior 24: /moodboards/<key>-<room>.png */
  reference_images: string[];
}

export const GARDEN_STYLES: GardenStyle[] = [
  {
    key: "desert-modern",
    name_en: "Desert Modern",
    name_ar: "الصحراء العصرية",
    one_line:
      "Large-format stone, clipped lawn, linear planting. Quiet, graphic, low-water.",
    // Signed against the same AED 850k interior baseline the six are signed
    // against, which a garden has nothing to do with. Zero until the Villa 94
    // landscape rates land in G2 — a made-up delta would read as a price.
    cost_delta_aed: 0,
    palette: ["#E7DFD2", "#8C8574", "#2F3A33", "#C2A878"],
    reference_images: imagesFor("desert-modern"),
    what_changes: [
      "Large-format sandstone paving laid to a single running bond.",
      "Linear corten planters with architectural grasses and agave.",
      "Recessed step and uplighting on the boundary wall, nothing visible by day.",
    ],
  },
  {
    key: "courtyard-majlis",
    name_en: "Courtyard Majlis",
    name_ar: "مجلس الفناء",
    one_line:
      "Shaded pergola, floor seating, patterned tile. A Gulf courtyard to sit in.",
    cost_delta_aed: 0,
    palette: ["#EBD9BE", "#A4793A", "#3E5C4B", "#7A3B2E"],
    reference_images: imagesFor("courtyard-majlis"),
    what_changes: [
      "Timber pergola over a raised majlis platform with floor cushions.",
      "Patterned cement tile underfoot, bordered in honed limestone.",
      "Date palms and a wall-set water spout against lime-rendered boundary walls.",
    ],
  },
];

const BY_KEY = new Map(GARDEN_STYLES.map((s) => [s.key, s] as const));

export function getGardenStyle(key: string | null | undefined): GardenStyle | null {
  return key ? (BY_KEY.get(key as GardenStyleKey) ?? null) : null;
}

export function isGardenStyleKey(key: string | null | undefined): key is GardenStyleKey {
  return key != null && BY_KEY.has(key as GardenStyleKey);
}

export const GARDEN_STYLE_KEYS: readonly GardenStyleKey[] = GARDEN_STYLES.map((s) => s.key);

/**
 * The exterior direction that goes with each interior one.
 *
 * The pilot does not ask a user to pick a garden style — they pick one
 * direction for the project and the garden should follow it rather than
 * contradict it. The pairing is by register: the four contemporary interiors
 * pair with Desert Modern, the two ornamented/traditional ones with Courtyard
 * Majlis. An unknown key falls to Desert Modern, which is the quieter of the
 * two and the safer thing to be wrong about.
 */
const COMPANION: Record<string, GardenStyleKey> = {
  "contemporary-majlis": "desert-modern",
  "coastal-emirati": "desert-modern",
  "scandi-arabic": "desert-modern",
  "luxe-minimal": "desert-modern",
  "modern-hijazi": "courtyard-majlis",
  "andalusian-heritage": "courtyard-majlis",
};

export function gardenStyleFor(interiorKey: string | null | undefined): GardenStyleKey {
  if (isGardenStyleKey(interiorKey)) return interiorKey;
  return (interiorKey && COMPANION[interiorKey]) || "desert-modern";
}

/** The reverse pairing, for an interior room on a project that locked a garden
 *  direction. Same logic, same reason. */
const INTERIOR_COMPANION: Record<GardenStyleKey, string> = {
  "desert-modern": "luxe-minimal",
  "courtyard-majlis": "modern-hijazi",
};

export function interiorStyleFor(key: string | null | undefined): string | null {
  if (!isGardenStyleKey(key)) return key ?? null;
  return INTERIOR_COMPANION[key];
}

/**
 * Resolve whichever direction a project locked, interior or exterior.
 *
 * Surfaces that just want to SHOW the chosen direction (the render page's
 * style card, the BoQ's style note) should not have to know which family it
 * belongs to — before this they called getStyleByKey, got null for a garden
 * key, and silently showed nothing.
 */
export function resolveAnyStyle(
  key: string | null | undefined,
  getInterior: (k: string) => Style | null | undefined,
): Style | null {
  if (!key) return null;
  return getGardenStyle(key) ?? getInterior(key) ?? null;
}
