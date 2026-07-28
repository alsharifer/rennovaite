// =============================================================================
// lib/viewer/finishes.ts — style → clay-model floor tint (P3).
//
// The 3D viewer is a deliberately non-photoreal clay model. When a style is
// locked we tint room floors with a muted approximation of that style's floor
// finish (not the real material) so the massing reads warmer. Pure data.
// =============================================================================

import { FLOOR_BONE } from "./scene";

/** Muted floor hue per style key (lib/styles). Falls back to bone. */
const STYLE_FLOOR_HEX: Record<string, string> = {
  "contemporary-majlis": "#E8DFD0", // honed travertine
  "modern-hijazi": "#8A5A3B", // mahogany
  "coastal-emirati": "#E4D8C4", // bleached oak
  "scandi-arabic": "#EDE4D2", // white oak
  "andalusian-heritage": "#CDB48F", // encaustic tile (warm)
  "luxe-minimal": "#E6E2DB", // stone slab
};

export function styleFloorColor(styleKey: string | null | undefined): string {
  return (styleKey && STYLE_FLOOR_HEX[styleKey]) || FLOOR_BONE;
}
