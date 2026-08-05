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

// --- Upload validation (server + client share this) --------------------------

export const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MB backstop

const IMAGE_MIMES = new Set(["image/png", "image/jpeg"]);
// DWG/DXF rarely carry a reliable MIME (often "" or application/octet-stream),
// so those two are validated by extension instead.
const DRAWING_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/acad",
  "image/vnd.dwg",
  "application/dxf",
  "image/vnd.dxf",
  "application/octet-stream",
]);
const DRAWING_EXTS = new Set(["pdf", "png", "jpg", "jpeg", "dwg", "dxf"]);

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  // No dot (or a trailing dot) → no extension.
  if (i < 0 || i === filename.length - 1) return "";
  return filename.slice(i + 1).toLowerCase();
}

export type AssetValidation = { ok: true } | { ok: false; reason: string };

/**
 * Validate an upload for a given kind by MIME + filename. Pure — the route and
 * the intake UI both call it so client and server agree.
 * `floorplan` is handled by /api/upload, not the asset route, so it's rejected
 * here to avoid a second write path.
 */
export function validateAssetFile(
  kind: AssetKind,
  mime: string,
  filename: string,
): AssetValidation {
  const ext = extOf(filename);
  if (kind === "floorplan") {
    return { ok: false, reason: "Floorplans are uploaded via the plan step." };
  }
  if (kind === "photo" || kind === "reference_image") {
    return IMAGE_MIMES.has(mime)
      ? { ok: true }
      : { ok: false, reason: "Please upload a PNG or JPG." };
  }
  // drawing_* and other: PDF / image / DWG / DXF
  if (DRAWING_MIMES.has(mime) || DRAWING_EXTS.has(ext)) {
    return { ok: true };
  }
  return { ok: false, reason: "Please upload a PDF, DWG, DXF, PNG, or JPG." };
}

/** File extension to store for an asset, MIME-aware with a filename fallback. */
export function assetExtension(mime: string, filename: string): string {
  const fromName = extOf(filename);
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "bin";
}
