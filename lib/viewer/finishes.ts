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

// Human finish labels per style (floor / wall / ceiling) for the inspector.
const STYLE_FINISH_LABELS: Record<string, { floor: string; wall: string; ceiling: string }> = {
  "contemporary-majlis": { floor: "Honed travertine, large format", wall: "Book-matched walnut / matt paint", ceiling: "Flush plaster, matt white" },
  "modern-hijazi": { floor: "Solid mahogany / patterned tile", wall: "Ivory Tadelakt plaster", ceiling: "Flush plaster with carved cornice" },
  "coastal-emirati": { floor: "Bleached engineered oak", wall: "Sand-tone limewash", ceiling: "Flush plaster, matt white" },
  "scandi-arabic": { floor: "Pale white-oak board", wall: "Off-white flat matt", ceiling: "Flush plaster, matt white" },
  "andalusian-heritage": { floor: "Encaustic cement tile", wall: "Lime plaster / zellige feature", ceiling: "Exposed stained timber beams" },
  "luxe-minimal": { floor: "Book-matched stone slab", wall: "Micro-cement / concealed joinery", ceiling: "Seamless plaster, integrated cove" },
};

const DEFAULT_FINISH_LABELS = {
  floor: "Porcelain tile (neutral)",
  wall: "Emulsion, matt white",
  ceiling: "Flush plaster, matt white",
};

export function styleFinishes(styleKey: string | null | undefined): {
  floor: string;
  wall: string;
  ceiling: string;
} {
  return (styleKey && STYLE_FINISH_LABELS[styleKey]) || DEFAULT_FINISH_LABELS;
}
