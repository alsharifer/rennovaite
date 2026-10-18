import { describe, expect, it } from "vitest";

import { checkItemsFor, expectedInView, failureLine, judgePhotoPlacement, LAYOUT_OK_LINE, normaliseLocated, type CheckItem, type Located } from "../photo-check";
import { restylePrompt, retryLine, styleTextFor, whereInFrame, type StyleBrief } from "../photo-restyle";

// B2 — "Layout follows your photo": the pair check's pass rule (pure; the
// vision model only reports boxes), the retry's wording, and the style a view
// is prompted with. The room is the room sheet's bathroom (cm / 266).
const n = (x: number, y: number): [number, number] => [x / 266, y / 266];
const PLAN = {
  openings: [
    { id: "door", kind: "door", position: n(161.5, 263), width_mm: 870 },
    { id: "win", kind: "window", position: n(0, 50.5), width_mm: 450 },
  ],
  fixtures: [
    { id: "wc", type: "wc_point", position: n(33, 121), spec: { width_mm: 420, depth_mm: 660 } },
    { id: "bidet", type: "bidet_point", position: n(28, 212), spec: { width_mm: 360, depth_mm: 480 } },
    { id: "vanity", type: "basin_point", position: n(239, 219.5), spec: { width_mm: 870, depth_mm: 540 } },
    { id: "shower", type: "shower_mixer", position: n(195.5, 45.5), spec: { width_mm: 1410, depth_mm: 910 } },
    { id: "drain", type: "floor_drain", position: n(120, 110), spec: null },
  ],
};
const ITEMS: CheckItem[] = checkItemsFor(PLAN);
const at = (ref: string, box: [number, number, number, number] | null, instances = box ? 1 : 0): Located => ({ ref, present: !!box, box, instances });

describe("B2 — the placement check", () => {
  it("the room's doors, windows and sanitary fixtures are the check items (a floor drain is not)", () => {
    expect(ITEMS.map((i) => `${i.ref}:${i.short}`)).toEqual(["D1:door", "W1:window", "F1:WC", "F2:bidet", "F3:vanity", "F4:shower glass"]);
  });

  it("which items a placed camera should see — the sheet's P2 (W wall by the WC, ESE) sees the vanity, the door and the shower glass", () => {
    const seen = expectedInView({ position: n(30, 130), heading_deg: 105 }, PLAN, ITEMS, 2.66);
    for (const r of ["D1", "F3", "F4"]) expect(seen.has(r), r).toBe(true);
    expect(seen.has("W1")).toBe(false); // the window is behind it
  });

  const BEFORE = { items: [at("D1", [55, 30, 80, 66]), at("F3", [25, 48, 52, 58]), at("F4", [0, 15, 25, 80]), at("F1", [70, 80, 100, 100]), at("W1", null), at("F2", [85, 70, 100, 85])] };

  it("passes when every item the photo shows is in place, once — whatever its new design", () => {
    const after = { items: [at("D1", [57, 31, 82, 67]), at("F3", [22, 46, 55, 60]), at("F4", [0, 14, 27, 82]), at("F1", [68, 78, 100, 100]), at("W1", null), at("F2", [84, 71, 100, 86])] };
    const v = judgePhotoPlacement(ITEMS, BEFORE, after);
    expect(v.passed).toBe(true);
    expect(v.checked.sort()).toEqual(["D1", "F1", "F2", "F3", "F4"]);
    expect(v.line).toBe(LAYOUT_OK_LINE);
  });

  it("fails, plainly, when the render moves, removes, repeats or adds a fixture", () => {
    const moved = judgePhotoPlacement(ITEMS, BEFORE, { items: [...BEFORE.items.filter((i) => i.ref !== "F3"), at("F3", [60, 48, 90, 58])] });
    expect(moved.passed).toBe(false);
    expect(moved.failures.map((f) => f.message)).toContain("the render moved the vanity");
    expect(moved.line).toMatch(/^The render moved the vanity.* — see what differs\.$/);

    const removed = judgePhotoPlacement(ITEMS, BEFORE, { items: BEFORE.items.filter((i) => i.ref !== "F1") });
    expect(removed.failures[0]!.message).toBe("the render removed the WC");

    const twice = judgePhotoPlacement(ITEMS, BEFORE, { items: [...BEFORE.items.filter((i) => i.ref !== "F2"), at("F2", [84, 71, 100, 86], 2)] });
    expect(twice.failures[0]!.message).toBe("the render added a second bidet");

    // The photo has no window (W1 absent): one appearing is an invented feature.
    const added = judgePhotoPlacement(ITEMS, BEFORE, { items: [...BEFORE.items.filter((i) => i.ref !== "W1"), at("W1", [10, 20, 30, 40])] });
    expect(added.failures[0]!.message).toBe("the render added a window");
    // …but a speck of a box (under 4% of the frame) is noise, not a window.
    expect(judgePhotoPlacement(ITEMS, BEFORE, { items: [...BEFORE.items.filter((i) => i.ref !== "W1"), at("W1", [10, 20, 11, 22])] }).passed).toBe(true);
  });

  it("fails when two fixtures clearly apart in the photo swap sides", () => {
    const before = { items: [at("F1", [5, 60, 30, 95]), at("F2", [60, 60, 85, 95])] };
    const after = { items: [at("F1", [62, 60, 87, 95]), at("F2", [3, 60, 28, 95])] };
    const v = judgePhotoPlacement(ITEMS, before, after);
    expect(v.passed).toBe(false);
    expect(v.failures.some((f) => f.reason === "moved" || f.reason === "swapped")).toBe(true);
  });

  it("reads boxes given in pixels or fractions as % of the frame (the G5d lesson)", () => {
    const px = normaliseLocated([at("F1", [473, 1638, 946, 2048])], { width: 946, height: 2048 });
    expect(px[0]!.box).toEqual([50, 80, 100, 100]);
    expect(normaliseLocated([at("F1", [0.5, 0.8, 1, 1])], null)[0]!.box).toEqual([50, 80, 100, 100]);
  });

  it("the honest failure names the first thing and counts the rest", () => {
    expect(failureLine([{ ref: "F3", short: "vanity", reason: "moved", message: "the render moved the vanity" }, { ref: "F1", short: "WC", reason: "removed", message: "the render removed the WC" }])).toBe("The render moved the vanity (and 1 more) — see what differs.");
  });
});

describe("B2 — what the restyle is told", () => {
  const STYLE: StyleBrief = {
    text: "everything",
    source: "references",
    line: "Style follows your references",
    elements: [
      { element: "floor", finish: "warm travertine-look large format" },
      { element: "vanity", finish: "floating oak, stone top" },
      { element: "mirror", finish: "backlit round" },
      { element: "shower", finish: "frameless clear glass, lit niche" },
      { element: "lighting", finish: "cove LED 2700 K" },
      { element: "accents", finish: "plants, towels" },
    ],
  };

  it("a view's style names only what the photo shows — no vanity in a view of the window wall", () => {
    const wallView = styleTextFor(STYLE, new Set(["window", "wc", "shower"] as const));
    expect(wallView).toMatch(/floor: warm travertine/);
    expect(wallView).toMatch(/shower: frameless/);
    expect(wallView).not.toMatch(/vanity|mirror|plants/);
    expect(styleTextFor(STYLE, new Set(["vanity"] as const))).toMatch(/vanity: floating oak, stone top; mirror: backlit round/);
  });

  it("the prompt lists what is in the frame and what is not; a retry says what to put back or leave out", () => {
    const p = restylePrompt("edit", STYLE, [{ item: ITEMS[2]!, box: [70, 80, 100, 100] }], [ITEMS[4]!]);
    expect(p).toMatch(/the WC \(bottom right of the frame\)/);
    expect(p).toMatch(/This photo shows no vanity — do not add any\./);
    expect(retryLine([{ ref: "F3", short: "vanity", reason: "added", message: "" }, { ref: "F1", short: "WC", reason: "moved", message: "" }])).toBe("The last attempt failed the layout check: there is no vanity in this photo — do not add one; keep the WC exactly where the photo has it.");
    expect(whereInFrame([40, 40, 60, 60])).toBe("in the centre");
    expect(whereInFrame([0, 0, 20, 20])).toBe("top left");
  });
});

describe("B2 — the style line and the render cap", () => {
  it("style passes at 0.75; the line says which elements fall short, and says when style was not checked", async () => {
    const { judgeStyle, styleLine, STYLE_PASS } = await import("../photo-check");
    expect(STYLE_PASS).toBe(0.75);
    const v = { elements: [{ element: "floor", verdict: "yes" as const, note: "" }, { element: "walls", verdict: "partly" as const, note: "" }, { element: "lighting", verdict: "no" as const, note: "" }] };
    expect(judgeStyle(v.elements)).toEqual({ score: 0.5, passed: false });
    expect(styleLine({ ...judgeStyle(v.elements), elements: v.elements }, "references")).toBe("Style only partly follows your references — walls, lighting");
    expect(styleLine({ passed: true, elements: [] }, "references")).toBe("Style follows your references ✓");
    expect(styleLine(null, "references")).toBe("Style not checked — the layout check comes first");
    expect(styleLine(null, "preset")).toMatch(/your chosen direction/);
  });

  it("PHOTO_VIEW_MAX_ATTEMPTS caps renders per view at 1; anything else keeps the re-render once", async () => {
    const { photoViewMaxAttempts } = await import("../photo-view-run");
    expect(photoViewMaxAttempts({})).toBe(2);
    expect(photoViewMaxAttempts({ PHOTO_VIEW_MAX_ATTEMPTS: "1" })).toBe(1);
    expect(photoViewMaxAttempts({ PHOTO_VIEW_MAX_ATTEMPTS: "5" })).toBe(2);
    expect(photoViewMaxAttempts({ PHOTO_VIEW_MAX_ATTEMPTS: "x" })).toBe(2);
  });
});
