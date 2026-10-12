// =============================================================================
// lib/uploads/limits.ts — THE upload limits (H9). One table.
//
// Every upload in the app is one of these kinds, and every size or type check
// — the browser's pre-check, POST /api/uploads/sign, POST /api/uploads/complete
// — reads this file and nothing else (a test greps the app for any other
// byte-size limit). Types are judged by MAGIC BYTES, never by the file name or
// the browser's MIME guess: a .exe renamed .pdf is not a PDF.
//
// Why the limits are real again: since H9 no file passes through a function
// body (Vercel caps a function request / response at ~4.5 MB — measured
// 12 Oct). The browser uploads straight to Storage on a signed URL; these caps
// are the only ones that apply.
//
// Pure and client-safe.
// =============================================================================

export const MiB = 1024 * 1024;

/** A file type we accept, identified by its leading bytes. */
export type FileType = "pdf" | "png" | "jpg" | "dwg" | "dxf" | "xlsx";

export const FILE_TYPES: Record<FileType, { mime: string; ext: string; label: string }> = {
  pdf: { mime: "application/pdf", ext: "pdf", label: "PDF" },
  png: { mime: "image/png", ext: "png", label: "PNG" },
  jpg: { mime: "image/jpeg", ext: "jpg", label: "JPG" },
  dwg: { mime: "image/vnd.dwg", ext: "dwg", label: "DWG" },
  dxf: { mime: "image/vnd.dxf", ext: "dxf", label: "DXF" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx", label: "Excel workbook" },
};

export const UPLOAD_KINDS = ["plan", "project_asset", "room_photo", "quote", "logo"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/**
 * Whose upload it is: an existing project's, a firm's, or the signer's NEW
 * project (an intake plan creates its project when it completes).
 */
export type UploadScope = "project" | "firm" | "new";

export interface UploadLimit {
  maxBytes: number;
  types: readonly FileType[];
  scope: UploadScope;
}

export const UPLOAD_LIMITS: Record<UploadKind, UploadLimit> = {
  plan: { maxBytes: 20 * MiB, types: ["pdf", "png", "jpg"], scope: "new" },
  project_asset: { maxBytes: 25 * MiB, types: ["pdf", "png", "jpg", "dwg", "dxf"], scope: "project" },
  room_photo: { maxBytes: 20 * MiB, types: ["png", "jpg"], scope: "project" },
  quote: { maxBytes: 5 * MiB, types: ["xlsx"], scope: "firm" },
  logo: { maxBytes: 1 * MiB, types: ["png", "jpg"], scope: "firm" },
};

/** The largest upload of any kind — the private `uploads` bucket's own cap (migration 052). */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(UPLOAD_LIMITS).map((l) => l.maxBytes));

/** Project-asset kinds narrow the asset types further (photos are images; drawings may be CAD). */
export const ASSET_KIND_TYPES: Record<string, readonly FileType[]> = {
  photo: ["png", "jpg"],
  reference_image: ["png", "jpg"],
  drawing_mep: ["pdf", "png", "jpg", "dwg", "dxf"],
  drawing_electrical: ["pdf", "png", "jpg", "dwg", "dxf"],
  drawing_hvac: ["pdf", "png", "jpg", "dwg", "dxf"],
  other: ["pdf", "png", "jpg", "dwg", "dxf"],
};

/**
 * A FILE response (a document route) above this is not sent through the
 * function: it is stored and answered with a 302 to a short-lived signed URL.
 * Kept under Vercel's ~4.5 MB response cap with headroom for headers.
 */
export const RESPONSE_INLINE_MAX_BYTES = 4 * MiB;
/** Where such a response is staged in the private `packs` bucket (swept daily with pending uploads). */
export const DOWNLOADS_PREFIX = "downloads";

/** How long a signed upload / download stays valid (seconds). */
export const SIGNED_DOWNLOAD_TTL_S = 300;
/** A pending upload never completed is swept after this (the daily job). */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// --- Magic bytes ----------------------------------------------------------------

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => {
  let s = "";
  for (let i = from; i < Math.min(to, b.length); i++) s += String.fromCharCode(b[i]!);
  return s;
};

/** How many leading bytes `sniffType` needs. */
export const SNIFF_BYTES = 1024;

/** The file's real type from its leading bytes, or null for anything we do not accept. */
export function sniffType(head: Uint8Array): FileType | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return "xlsx"; // a ZIP container; the importer parses the rest
  const text = ascii(head, 0, SNIFF_BYTES);
  // The PDF header may follow a little junk, within the first 1 KB (PDF 1.7 §7.5.2).
  if (text.includes("%PDF-")) return "pdf";
  if (/^AC1\d{3}/.test(text)) return "dwg";
  if (/^\s*0\s*\r?\n\s*SECTION/.test(text) || text.startsWith("AutoCAD Binary DXF")) return "dxf";
  return null;
}

/** The type a client DECLARES (MIME first; the extension for CAD, whose MIME is unreliable). */
export function declaredType(mime: string | null | undefined, filename?: string | null): FileType | null {
  const byMime = (Object.entries(FILE_TYPES) as [FileType, (typeof FILE_TYPES)[FileType]][]).find(([, t]) => t.mime === mime)?.[0];
  if (byMime) return byMime;
  const m = mime ?? "";
  if (m === "application/acad" || m === "application/x-dwg") return "dwg";
  if (m === "application/dxf" || m === "image/x-dxf") return "dxf";
  const ext = (filename ?? "").split(".").pop()?.toLowerCase();
  return (Object.entries(FILE_TYPES) as [FileType, (typeof FILE_TYPES)[FileType]][]).find(([, t]) => t.ext === ext || (ext === "jpeg" && t.ext === "jpg"))?.[0] ?? null;
}

/** The types a kind (and, for project assets, an asset kind) accepts. */
export function allowedTypes(kind: UploadKind, assetKind?: string | null): readonly FileType[] {
  if (kind === "project_asset" && assetKind) return ASSET_KIND_TYPES[assetKind] ?? [];
  return UPLOAD_LIMITS[kind].types;
}

// --- The one error shape ----------------------------------------------------------

export type UploadErrorCode = "payload_too_large" | "unsupported_type" | "upload_failed";

export interface UploadErrorBody {
  code: UploadErrorCode;
  kind: UploadKind;
  /** A plain sentence for today's UIs. Names no number (the K6 intake copy rule). */
  error: string;
}

const SENTENCE: Record<UploadErrorCode, string> = {
  payload_too_large: "This file is too large to upload here.",
  unsupported_type: "This kind of file can't be uploaded here.",
  upload_failed: "The upload didn't complete. Please try again.",
};

export function uploadError(code: UploadErrorCode, kind: UploadKind): UploadErrorBody {
  return { code, kind, error: SENTENCE[code] };
}

export const UPLOAD_ERROR_STATUS: Record<UploadErrorCode, number> = { payload_too_large: 413, unsupported_type: 415, upload_failed: 400 };

/** A size + declared-type check (the browser's and the sign route's). null = fine. */
export function checkDeclared(kind: UploadKind, size: number, type: FileType | null, assetKind?: string | null): UploadErrorCode | null {
  if (!type || !allowedTypes(kind, assetKind).includes(type)) return "unsupported_type";
  if (!Number.isFinite(size) || size <= 0) return "upload_failed";
  if (size > UPLOAD_LIMITS[kind].maxBytes) return "payload_too_large";
  return null;
}
