// =============================================================================
// lib/image/compress.ts — client-side image downscale/compression for uploads.
//
// The render flow used to POST the raw camera file (a modern phone photo is
// 8–15 MB / 12 MP). That put every upload at the mercy of the smallest body cap
// in the chain — a hosting/reverse-proxy request-body limit that rejects with a
// raw HTTP 413 *before* the request ever reaches our route handler and its own
// size check. The fix is to never send those bytes: downscale to a sane render
// input (long edge ≤ 2048 px) and re-encode as JPEG ~0.85 so a typical upload is
// ~0.5–2 MB, comfortably under any reasonable cap.
//
// SPLIT: the decision logic (`fitWithin`, `planImageProcessing`, `isHeic`) is
// pure and unit-tested in a Node environment. The browser-only `compressImage`
// wrapper does the actual decode/canvas work and is guarded so it degrades to a
// byte-identical passthrough anywhere the image APIs are absent.
// =============================================================================

/** Longest edge (px) we keep. Renders don't benefit from 12 MP inputs. */
export const MAX_LONG_EDGE = 2048;
/** JPEG quality for the re-encode. */
export const TARGET_QUALITY = 0.85;
/** JPEG/PNG originals at or under this size (and within dimensions) upload
 *  untouched — small existing uploads stay byte-identical. */
export const PASSTHROUGH_MAX_BYTES = 1_000_000; // 1 MB
/** Everything that isn't passed through is re-encoded to this type, so the
 *  server's PNG/JPEG contract always holds. */
export const OUTPUT_TYPE = "image/jpeg" as const;

/** MIME types the file picker offers and `compressImage` will attempt. */
export const ACCEPTED_INPUT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** `accept` attribute value for the <input type="file">. Includes the HEIC/HEIF
 *  extensions because some browsers report an empty MIME type for them. */
export const ACCEPT_ATTR =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

// Only these upload unchanged; anything else decodable is re-encoded to JPEG.
const PASSTHROUGH_TYPES = new Set(["image/jpeg", "image/png"]);

export type CompressPlan =
  | { action: "passthrough"; reason: string }
  | {
      action: "compress";
      targetWidth: number;
      targetHeight: number;
      outputType: typeof OUTPUT_TYPE;
      quality: number;
      reason: string;
    }
  | { action: "reject"; reason: string };

/** True if the file is (or looks like) HEIC/HEIF, by MIME type or extension. */
export function isHeic(type: string | null | undefined, name: string | null | undefined): boolean {
  const t = (type ?? "").toLowerCase();
  if (t === "image/heic" || t === "image/heif") return true;
  return /\.(heic|heif)$/i.test(name ?? "");
}

/**
 * Scale (width, height) so the longer edge is ≤ maxEdge, preserving aspect
 * ratio. Never upscales; rounds to whole pixels with a floor of 1.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge || longEdge <= 0) {
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
  }
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decide what to do with an image given its decoded dimensions, byte size, and
 * MIME type. Pure — no DOM, no I/O — so it is fully unit-testable.
 */
export function planImageProcessing(input: {
  width: number;
  height: number;
  sizeBytes: number;
  type: string;
}): CompressPlan {
  const type = (input.type ?? "").toLowerCase();
  if (!type.startsWith("image/")) {
    return {
      action: "reject",
      reason: `Unsupported file type${type ? ` (${type})` : ""}.`,
    };
  }

  const longEdge = Math.max(input.width, input.height);
  const withinDimensions = longEdge <= MAX_LONG_EDGE;
  const smallEnough = input.sizeBytes <= PASSTHROUGH_MAX_BYTES;

  if (PASSTHROUGH_TYPES.has(type) && withinDimensions && smallEnough) {
    return {
      action: "passthrough",
      reason: "Already small and within dimensions — uploaded unchanged.",
    };
  }

  const target = fitWithin(input.width, input.height, MAX_LONG_EDGE);
  return {
    action: "compress",
    targetWidth: target.width,
    targetHeight: target.height,
    outputType: OUTPUT_TYPE,
    quality: TARGET_QUALITY,
    reason: withinDimensions
      ? "Re-encoded to reduce file size."
      : `Downscaled to ${target.width}×${target.height} and re-encoded.`,
  };
}

export type ImageProcessingErrorCode =
  | "unsupported_heic"
  | "decode_failed"
  | "unsupported_type";

/** Typed, user-safe error thrown by `compressImage`. `message` is friendly. */
export class ImageProcessingError extends Error {
  code: ImageProcessingErrorCode;
  constructor(code: ImageProcessingErrorCode, message: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.code = code;
  }
}

export type CompressResult = {
  /** The file to upload — the original (passthrough) or a re-encoded JPEG. */
  file: File;
  /** Whether the bytes changed (false = byte-identical original). */
  changed: boolean;
  plan: CompressPlan;
};

/**
 * Browser-only: decode `file` (applying EXIF orientation), then passthrough,
 * re-encode, or reject per `planImageProcessing`. Throws `ImageProcessingError`
 * with a friendly message for HEIC the browser can't decode, or unreadable
 * files. Degrades to a byte-identical passthrough where the image APIs are
 * unavailable (SSR / older runtimes).
 */
export async function compressImage(file: File): Promise<CompressResult> {
  const passthrough = (reason: string): CompressResult => ({
    file,
    changed: false,
    plan: { action: "passthrough", reason },
  });

  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return passthrough("Image APIs unavailable — uploaded unchanged.");
  }

  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: "from-image"` bakes EXIF rotation into the pixels so
    // the re-encoded JPEG (which carries no EXIF) is upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (isHeic(file.type, file.name)) {
      throw new ImageProcessingError(
        "unsupported_heic",
        "This looks like a HEIC photo your browser can’t open here. Please upload a JPG or PNG.",
      );
    }
    throw new ImageProcessingError(
      "decode_failed",
      "We couldn’t read that image. Please try a different JPG or PNG.",
    );
  }

  try {
    const plan = planImageProcessing({
      width: bitmap.width,
      height: bitmap.height,
      sizeBytes: file.size,
      type: file.type,
    });

    if (plan.action === "reject") {
      throw new ImageProcessingError("unsupported_type", "Please upload a JPG or PNG.");
    }
    if (plan.action === "passthrough") {
      return passthrough(plan.reason);
    }

    const canvas = document.createElement("canvas");
    canvas.width = plan.targetWidth;
    canvas.height = plan.targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return passthrough("No 2D canvas context — uploaded unchanged.");
    ctx.drawImage(bitmap, 0, 0, plan.targetWidth, plan.targetHeight);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, plan.outputType, plan.quality),
    );
    if (!blob) {
      throw new ImageProcessingError(
        "decode_failed",
        "We couldn’t process that image. Please try a JPG or PNG.",
      );
    }

    // If the re-encode didn't actually shrink an already-optimised JPEG/PNG,
    // keep the original bytes.
    if (blob.size >= file.size && PASSTHROUGH_TYPES.has((file.type ?? "").toLowerCase())) {
      return passthrough("Re-encode was not smaller — kept original.");
    }

    const baseName = file.name.replace(/\.[^./\\]+$/, "") || "room-photo";
    const out = new File([blob], `${baseName}.jpg`, {
      type: plan.outputType,
      lastModified: file.lastModified,
    });
    return { file: out, changed: true, plan };
  } finally {
    bitmap.close?.();
  }
}
