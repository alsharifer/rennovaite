import { describe, expect, it } from "vitest";

import {
  ASSET_KINDS,
  DRAWING_KINDS,
  groupAssetsForHub,
  isAssetKind,
  isAssetSource,
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
