import { describe, expect, it } from "vitest";

import {
  ACCEPT_ATTR,
  compressImage,
  fitWithin,
  isHeic,
  MAX_LONG_EDGE,
  OUTPUT_TYPE,
  PASSTHROUGH_MAX_BYTES,
  planImageProcessing,
  TARGET_QUALITY,
} from "@/lib/image/compress";

describe("fitWithin", () => {
  it("downscales the long edge to the cap, preserving aspect ratio", () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  it("never upscales images already within the cap", () => {
    expect(fitWithin(1200, 800, 2048)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(2048, 1000, 2048)).toEqual({ width: 2048, height: 1000 });
  });

  it("rounds to whole pixels with a floor of 1", () => {
    const r = fitWithin(2049, 1, 2048);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(Number.isInteger(r.height)).toBe(true);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it("handles degenerate zero dimensions without dividing by zero", () => {
    expect(fitWithin(0, 0, 2048)).toEqual({ width: 1, height: 1 });
  });
});

describe("isHeic", () => {
  it("detects HEIC/HEIF by MIME type", () => {
    expect(isHeic("image/heic", "x.jpg")).toBe(true);
    expect(isHeic("image/heif", "x")).toBe(true);
    expect(isHeic("IMAGE/HEIC", "x")).toBe(true);
  });

  it("detects HEIC/HEIF by extension when the MIME type is empty", () => {
    expect(isHeic("", "IMG_1234.HEIC")).toBe(true);
    expect(isHeic(null, "photo.heif")).toBe(true);
  });

  it("is false for normal images", () => {
    expect(isHeic("image/jpeg", "photo.jpg")).toBe(false);
    expect(isHeic("image/png", "photo.png")).toBe(false);
  });
});

describe("planImageProcessing", () => {
  // REGRESSION: a small existing JPEG/PNG within dimensions must pass through
  // untouched so its bytes are uploaded verbatim.
  it("passes through a small in-dimension JPEG unchanged", () => {
    const plan = planImageProcessing({
      width: 1600,
      height: 1200,
      sizeBytes: 500_000,
      type: "image/jpeg",
    });
    expect(plan.action).toBe("passthrough");
  });

  it("passes through a small PNG unchanged", () => {
    const plan = planImageProcessing({
      width: 1024,
      height: 768,
      sizeBytes: 200_000,
      type: "image/png",
    });
    expect(plan.action).toBe("passthrough");
  });

  it("compresses (downscales) a large-dimension photo", () => {
    const plan = planImageProcessing({
      width: 4032,
      height: 3024,
      sizeBytes: 12_000_000,
      type: "image/jpeg",
    });
    expect(plan).toMatchObject({
      action: "compress",
      targetWidth: 2048,
      targetHeight: 1536,
      outputType: OUTPUT_TYPE,
      quality: TARGET_QUALITY,
    });
  });

  it("compresses an in-dimension image that is over the byte threshold", () => {
    const plan = planImageProcessing({
      width: 2000,
      height: 1500,
      sizeBytes: PASSTHROUGH_MAX_BYTES + 1,
      type: "image/jpeg",
    });
    expect(plan.action).toBe("compress");
    if (plan.action === "compress") {
      // Within dimensions → no downscale, just re-encode.
      expect(plan.targetWidth).toBe(2000);
      expect(plan.targetHeight).toBe(1500);
    }
  });

  it("re-encodes non-passthrough types (webp) to JPEG even when small", () => {
    const plan = planImageProcessing({
      width: 800,
      height: 600,
      sizeBytes: 100_000,
      type: "image/webp",
    });
    expect(plan).toMatchObject({ action: "compress", outputType: "image/jpeg" });
  });

  it("rejects non-image files", () => {
    expect(planImageProcessing({ width: 0, height: 0, sizeBytes: 10, type: "application/pdf" }).action).toBe("reject");
  });

  it("keeps the long edge at the cap for exactly-at-limit dimensions", () => {
    const plan = planImageProcessing({
      width: MAX_LONG_EDGE,
      height: 1000,
      sizeBytes: 400_000,
      type: "image/jpeg",
    });
    expect(plan.action).toBe("passthrough");
  });
});

describe("compressImage — byte-identical passthrough", () => {
  // In the Node test environment there is no `createImageBitmap`/`document`, so
  // the wrapper takes its guarded passthrough branch and returns the ORIGINAL
  // File instance — the same guarantee the browser passthrough plan gives for
  // small existing uploads.
  it("returns the original File unchanged when image APIs are unavailable", async () => {
    const original = new File([new Uint8Array([1, 2, 3, 4, 5])], "small.jpg", {
      type: "image/jpeg",
    });
    const result = await compressImage(original);
    expect(result.changed).toBe(false);
    expect(result.file).toBe(original);
    const bytes = new Uint8Array(await result.file.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("constants", () => {
  it("exposes an accept attribute covering JPG/PNG/WebP/HEIC", () => {
    expect(ACCEPT_ATTR).toContain("image/jpeg");
    expect(ACCEPT_ATTR).toContain("image/png");
    expect(ACCEPT_ATTR).toContain(".heic");
  });
});
