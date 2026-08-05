import { describe, expect, it } from "vitest";

import {
  ASSET_KINDS,
  assetExtension,
  DRAWING_KINDS,
  groupAssetsForHub,
  isAssetKind,
  isAssetSource,
  validateAssetFile,
  type AssetLite,
} from "@/lib/assets/types";

describe("isAssetKind / isAssetSource", () => {
  it("accepts every declared kind and rejects junk", () => {
    for (const k of ASSET_KINDS) expect(isAssetKind(k)).toBe(true);
    expect(isAssetKind("floorplans")).toBe(false);
    expect(isAssetKind(null)).toBe(false);
  });
  it("validates sources", () => {
    expect(isAssetSource("intake")).toBe(true);
    expect(isAssetSource("render")).toBe(true);
    expect(isAssetSource("moodboard")).toBe(true);
    expect(isAssetSource("import")).toBe(false);
  });
});

describe("validateAssetFile", () => {
  it("accepts PNG/JPG for photos and reference images, rejects PDF", () => {
    expect(validateAssetFile("photo", "image/jpeg", "a.jpg").ok).toBe(true);
    expect(validateAssetFile("photo", "image/png", "a.png").ok).toBe(true);
    expect(validateAssetFile("reference_image", "image/jpeg", "r.jpg").ok).toBe(true);
    expect(validateAssetFile("photo", "application/pdf", "a.pdf").ok).toBe(false);
  });

  it("accepts PDF/DWG/DXF/images for drawings", () => {
    for (const kind of DRAWING_KINDS) {
      expect(validateAssetFile(kind, "application/pdf", "d.pdf").ok).toBe(true);
      expect(validateAssetFile(kind, "image/png", "d.png").ok).toBe(true);
      // DWG with no reliable MIME → validated by extension.
      expect(validateAssetFile(kind, "", "plan.dwg").ok).toBe(true);
      expect(validateAssetFile(kind, "application/octet-stream", "plan.dxf").ok).toBe(true);
      // A random type with no known extension is rejected.
      expect(validateAssetFile(kind, "text/plain", "notes.txt").ok).toBe(false);
    }
  });

  it("rejects floorplan (handled by /api/upload, not the asset route)", () => {
    expect(validateAssetFile("floorplan", "application/pdf", "plan.pdf").ok).toBe(false);
  });
});

describe("assetExtension", () => {
  it("prefers the filename extension", () => {
    expect(assetExtension("application/pdf", "IMG.HEIC")).toBe("heic");
    expect(assetExtension("image/jpeg", "photo.JPG")).toBe("jpg");
  });
  it("falls back to the MIME type when the name has none", () => {
    expect(assetExtension("application/pdf", "noext")).toBe("pdf");
    expect(assetExtension("image/png", "noext")).toBe("png");
    expect(assetExtension("", "noext")).toBe("bin");
  });
});

describe("groupAssetsForHub", () => {
  const mk = (id: string, kind: AssetLite["kind"]): AssetLite => ({
    id,
    url: `https://x/${id}`,
    kind,
    room_id: null,
    filename: `${id}.f`,
    bytes: 1,
  });

  it("orders groups and drops empty ones", () => {
    const groups = groupAssetsForHub([
      mk("1", "photo"),
      mk("2", "floorplan"),
      mk("3", "drawing_hvac"),
    ]);
    expect(groups.map((g) => g.title)).toEqual([
      "Floorplan & CAD",
      "Existing drawings",
      "Site photos",
    ]);
  });

  it("returns nothing for an empty library", () => {
    expect(groupAssetsForHub([])).toEqual([]);
  });

  it("buckets all three drawing kinds into one group", () => {
    const groups = groupAssetsForHub([
      mk("1", "drawing_mep"),
      mk("2", "drawing_electrical"),
      mk("3", "drawing_hvac"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.assets).toHaveLength(3);
  });
});
