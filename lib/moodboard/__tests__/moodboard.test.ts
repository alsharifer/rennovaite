import { describe, expect, it } from "vitest";

import {
  buildReferenceClause,
  descriptorFor,
  isStyleRoom,
  reorder,
  sortItems,
  styleDescriptor,
  styleImageCatalog,
  styleImagePath,
  STYLE_ROOMS,
  type MoodboardItem,
} from "@/lib/moodboard/types";
import { STYLES } from "@/lib/styles";

function item(over: Partial<MoodboardItem> = {}): MoodboardItem {
  return {
    id: "i1",
    project_id: "p",
    kind: "style",
    asset_id: null,
    render_id: null,
    style_key: "luxe-minimal",
    style_room: "living",
    image_url: "/moodboards/luxe-minimal-living.png",
    descriptor: null,
    position: 0,
    ...over,
  };
}

describe("style image catalogue", () => {
  it("covers every style × room and matches the on-disk naming", () => {
    const cat = styleImageCatalog(STYLES);
    expect(cat).toHaveLength(STYLES.length * STYLE_ROOMS.length);
    expect(cat[0]!.image_url).toBe(
      styleImagePath(cat[0]!.style_key, cat[0]!.room),
    );
    // The style library's own reference_images use the same paths.
    for (const s of STYLES) {
      for (const src of s.reference_images) {
        expect(cat.some((c) => c.image_url === src)).toBe(true);
      }
    }
  });

  it("validates room buckets", () => {
    expect(isStyleRoom("living")).toBe(true);
    expect(isStyleRoom("kitchen")).toBe(false);
    expect(isStyleRoom(null)).toBe(false);
  });
});

describe("descriptors", () => {
  it("derives a style descriptor deterministically from the style system", () => {
    const a = styleDescriptor("luxe-minimal", "living");
    const b = styleDescriptor("luxe-minimal", "living");
    expect(a).toBe(b);
    expect(a).toContain("Luxe Minimal");
    expect(a).toContain("Palette");
  });

  it("returns null for an unknown style", () => {
    expect(styleDescriptor("not-a-style", "living")).toBeNull();
  });

  it("prefers a stored descriptor over the derived one", () => {
    expect(descriptorFor(item({ descriptor: "  brushed brass, deep walnut " }))).toBe(
      "brushed brass, deep walnut",
    );
  });

  it("has no descriptor for an unlabelled upload", () => {
    expect(descriptorFor(item({ kind: "asset", style_key: null, style_room: null, asset_id: "a" }))).toBeNull();
  });
});

describe("buildReferenceClause", () => {
  it("is empty when nothing carries a descriptor", () => {
    expect(buildReferenceClause([])).toBe("");
    expect(
      buildReferenceClause([item({ kind: "asset", style_key: null, asset_id: "a" })]),
    ).toBe("");
  });

  it("describes style only — no quantities, dimensions or geometry", () => {
    const clause = buildReferenceClause([
      item({ id: "a", style_key: "luxe-minimal" }),
      item({ id: "b", style_key: "contemporary-majlis", style_room: "bedroom" }),
    ]);
    expect(clause).toContain("palette, materials and mood");
    // The guardrail: nothing numeric-with-units, and no layout instruction.
    expect(clause).not.toMatch(/\b\d+\s?(m2|m²|mm|cm|m)\b/i);
    expect(clause).toMatch(/Do not copy their layout/i);
  });

  it("de-duplicates identical descriptors", () => {
    const clause = buildReferenceClause([
      item({ id: "a", descriptor: "warm walnut" }),
      item({ id: "b", descriptor: "Warm Walnut" }),
      item({ id: "c", descriptor: "pale oak" }),
    ]);
    expect(clause.match(/walnut/gi)).toHaveLength(1);
    expect(clause).toContain("pale oak");
  });

  it("caps how much of a large board reaches the prompt", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      item({ id: `i${i}`, descriptor: `descriptor number ${i}` }),
    );
    const clause = buildReferenceClause(many, 4);
    expect(clause).toContain("descriptor number 3");
    expect(clause).not.toContain("descriptor number 4");
  });
});

describe("ordering", () => {
  const board = [
    item({ id: "a", position: 0 }),
    item({ id: "b", position: 1 }),
    item({ id: "c", position: 2 }),
    item({ id: "d", position: 3 }),
  ];

  it("sorts by position then insertion time", () => {
    const shuffled = [board[2]!, board[0]!, board[3]!, board[1]!];
    expect(sortItems(shuffled).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("breaks equal positions by created_at", () => {
    const tied = [
      item({ id: "x", position: 0, created_at: "2026-01-02" }),
      item({ id: "y", position: 0, created_at: "2026-01-01" }),
    ];
    expect(sortItems(tied).map((i) => i.id)).toEqual(["y", "x"]);
  });

  it("moves an item forward and renumbers densely", () => {
    const updates = reorder(board, "a", 2);
    const next = new Map(updates.map((u) => [u.id, u.position]));
    // a → index 2; b and c shift back one.
    expect(next.get("a")).toBe(2);
    expect(next.get("b")).toBe(0);
    expect(next.get("c")).toBe(1);
    expect(next.has("d")).toBe(false); // unchanged, so not written
  });

  it("moves an item backward", () => {
    const updates = reorder(board, "d", 0);
    const next = new Map(updates.map((u) => [u.id, u.position]));
    expect(next.get("d")).toBe(0);
    expect(next.get("a")).toBe(1);
    expect(next.get("c")).toBe(3);
  });

  it("writes nothing for a no-op move", () => {
    expect(reorder(board, "b", 1)).toEqual([]);
  });

  it("clamps an out-of-range index instead of throwing", () => {
    expect(reorder(board, "a", 99).find((u) => u.id === "a")?.position).toBe(3);
    expect(reorder(board, "d", -5).find((u) => u.id === "d")?.position).toBe(0);
  });

  it("ignores an unknown id", () => {
    expect(reorder(board, "ghost", 0)).toEqual([]);
  });
});
