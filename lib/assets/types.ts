// =============================================================================
// lib/assets/types.ts — project asset library vocabulary (pure, no I/O).
//
// Shared by the intake flow, the /api/project-asset route, the render photo
// picker, and the project hub "Project files" panel. Kept free of any DOM or
// server imports so both client components and Node unit tests can use it.
// =============================================================================

export const ASSET_KINDS = [
  "floorplan",
  "drawing_mep",
  "drawing_electrical",
  "drawing_hvac",
  "photo",
  "reference_image",
  "other",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_SOURCES = ["intake", "render", "moodboard"] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

/** A stored asset row (mirrors the project_assets table). */
export type ProjectAsset = {
  id: string;
  project_id: string;
  kind: AssetKind;
  room_id: string | null;
  storage_path: string;
  filename: string | null;
  mime: string | null;
  bytes: number | null;
  uploaded_at: string | null;
  source: AssetSource | null;
};

/** Slim shape the client picker / hub panel render from (public URL resolved). */
export type AssetLite = {
  id: string;
  url: string;
  kind: AssetKind;
  room_id: string | null;
  filename: string | null;
  bytes: number | null;
};

export const DRAWING_KINDS: AssetKind[] = [
  "drawing_mep",
  "drawing_electrical",
  "drawing_hvac",
];

export function isAssetKind(x: unknown): x is AssetKind {
  return typeof x === "string" && (ASSET_KINDS as readonly string[]).includes(x);
}
export function isAssetSource(x: unknown): x is AssetSource {
  return typeof x === "string" && (ASSET_SOURCES as readonly string[]).includes(x);
}

// --- Display metadata --------------------------------------------------------

export const KIND_LABEL: Record<AssetKind, string> = {
  floorplan: "Floorplan",
  drawing_mep: "MEP drawing",
  drawing_electrical: "Electrical drawing",
  drawing_hvac: "HVAC drawing",
  photo: "Photo",
  reference_image: "Reference image",
  other: "Other",
};

/** Material Symbols glyph per kind (for the hub panel). */
export const KIND_ICON: Record<AssetKind, string> = {
  floorplan: "architecture",
  drawing_mep: "plumbing",
  drawing_electrical: "bolt",
  drawing_hvac: "hvac",
  photo: "image",
  reference_image: "wallpaper",
  other: "description",
};

/** Discipline toggle options for the intake "Existing drawings" card. */
export const DRAWING_DISCIPLINES: { kind: AssetKind; label: string }[] = [
  { kind: "drawing_mep", label: "MEP" },
  { kind: "drawing_electrical", label: "Electrical" },
  { kind: "drawing_hvac", label: "HVAC" },
];

/** Ordered kind groups for the hub "Project files" panel. */
export const HUB_GROUPS: { title: string; kinds: AssetKind[] }[] = [
  { title: "Floorplan & CAD", kinds: ["floorplan"] },
  { title: "Existing drawings", kinds: DRAWING_KINDS },
  { title: "Site photos", kinds: ["photo"] },
  { title: "References & moodboards", kinds: ["reference_image"] },
  { title: "Other", kinds: ["other"] },
];

/** Group assets into the hub's ordered sections, dropping empty groups. */
export function groupAssetsForHub(
  assets: AssetLite[],
): { title: string; assets: AssetLite[] }[] {
  return HUB_GROUPS.map((g) => ({
    title: g.title,
    assets: assets.filter((a) => g.kinds.includes(a.kind)),
  })).filter((g) => g.assets.length > 0);
}

// Upload limits and allowed types (by magic bytes) live in lib/uploads/limits.ts
// (H9) — the one table the browser, the sign route and the complete route read.
