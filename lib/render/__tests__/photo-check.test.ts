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
    const after = { items: [at("D1", [57, 31, 82, 67]), at("F3", [24, 47, 53, 58.5]), at("F4", [0, 14, 27, 82]), at("F1", [68, 78, 100, 100]), at("W1", null), at("F2", [84, 71, 100, 86])] };
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

describe("B2b — size, and the pro frame pinned back to the photo", () => {
  it("a fixture whose box grows or shrinks beyond the measured tolerance (B8: ×1.27) fails as resized", async () => {
    const { judgePhotoPlacement: judge, SIZE_TOLERANCE } = await import("../photo-check");
    expect(SIZE_TOLERANCE).toBe(0.27);
    const before = { items: [at("W1", [20, 30, 40, 50])] }; // 400
    expect(judge(ITEMS, before, { items: [at("W1", [21, 31, 39, 49])] }).passed).toBe(true); // 324 = −19%
    const small = judge(ITEMS, before, { items: [at("W1", [22, 33, 38, 47])] }); // 224 = −44%
    expect(small.failures[0]).toMatchObject({ reason: "resized", message: "the render shrank the window (-44% of its area)" });
    expect(judge(ITEMS, before, { items: [at("W1", [18, 28, 43, 53])] }).failures[0]!.message).toMatch(/enlarged the window/);
  });

  it("the photo is padded to 9 : 16 at its sides; the output maps back by that geometry", async () => {
    const { padPlan, geometricMap, frameRect, toPhotoBoxes } = await import("../frame-pin");
    const plan = padPlan(946, 2048);
    expect(plan).toEqual({ w: 946, h: 2048, W: 1152, H: 2048, padL: 103, padT: 0 });
    const out = { width: 1536, height: 2752 };
    const geo = geometricMap(plan, out);
    const rect = frameRect(geo, { width: 946, height: 2048 }, out);
    expect(rect.left).toBe(Math.round(103 * (1536 / 1152)));
    expect(rect.width / rect.height).toBeCloseTo(946 / 2048, 2);
    // A box read in the output's frame lands back where the photo had it.
    const inOut = [{ ref: "F1", present: true, box: [((103 + 0.7 * 946) / 1152) * 100, 80, ((103 + 946) / 1152) * 100, 100] as [number, number, number, number], instances: 1 }];
    const back = toPhotoBoxes(inOut, geo, { width: 946, height: 2048 }, out)[0]!.box!;
    expect(back[0]).toBeCloseTo(70, 0);
    expect(back[2]).toBeCloseTo(100, 0);
  });

  it("fixtures refine the crop — but a recomposition is never fitted away", async () => {
    const { padPlan, geometricMap, fitMap } = await import("../frame-pin");
    const photo = { width: 946, height: 2048 }, out = { width: 1536, height: 2752 };
    const geo = geometricMap(padPlan(946, 2048), out);
    const before = [at("F1", [70, 80, 100, 100]), at("F3", [25, 48, 52, 58]), at("D1", [55, 30, 80, 66])];
    // The model shifted everything 20 px right: the fit finds it.
    const shift = (b: [number, number, number, number]): [number, number, number, number] => [
      ((geo.ox + (b[0] / 100) * photo.width * geo.k + 20) / out.width) * 100, ((geo.oy + (b[1] / 100) * photo.height * geo.k) / out.height) * 100,
      ((geo.ox + (b[2] / 100) * photo.width * geo.k + 20) / out.width) * 100, ((geo.oy + (b[3] / 100) * photo.height * geo.k) / out.height) * 100,
    ];
    const fitted = fitMap(before, before.map((l) => ({ ...l, box: shift(l.box!) })), photo, out, geo);
    expect(fitted.source).toBe("fixtures");
    expect(fitted.ox - geo.ox).toBeCloseTo(20, 0);
    // The model zoomed in 1.6× (the B2 recomposition): out of bounds — the geometry stands and the check judges it.
    const zoom = (b: [number, number, number, number]): [number, number, number, number] => [b[0] * 1.6 - 30, b[1] * 1.6 - 30, b[2] * 1.6 - 30, b[3] * 1.6 - 30];
    expect(fitMap(before, before.map((l) => ({ ...l, box: zoom(l.box!) })), photo, out, geo).source).toBe("geometry");
    // One item in common is not enough to fit.
    expect(fitMap(before.slice(0, 1), before.slice(0, 1), photo, out, geo).source).toBe("geometry");
  });

  it("PHOTO_VIEW_MODEL picks the model; the other is the fallback", async () => {
    const { photoViewArm, PHOTO_VIEW_DEFAULT_MODEL } = await import("../photo-restyle");
    expect(photoViewArm({ PHOTO_VIEW_MODEL: "pro" })).toBe("edit_pro");
    expect(photoViewArm({ PHOTO_VIEW_MODEL: "edit" })).toBe("edit");
    expect(photoViewArm({})).toBe(PHOTO_VIEW_DEFAULT_MODEL === "pro" ? "edit_pro" : "edit");
  });
});

describe("B8 — read twice, measured tolerances, height", () => {
  it("two readings that agree average their boxes; a disagreement on presence or count is flagged for a third", async () => {
    const { agreeReadings, readingsDisagree } = await import("../photo-check");
    const r1 = [at("F1", [10, 60, 30, 90]), at("W1", null)];
    const r2 = [at("F1", [12, 62, 32, 92]), at("W1", null)];
    expect(readingsDisagree(r1, r2)).toBe(false);
    expect(agreeReadings([r1, r2]).find((x) => x.ref === "F1")).toMatchObject({ present: true, box: [11, 61, 31, 91], instances: 1 });
    const r3 = [at("F1", [11, 61, 31, 91], 2), at("W1", [20, 30, 40, 50])];
    expect(readingsDisagree(r1, r3)).toBe(true);
    // Three readings: the majority decides presence and count.
    const agreed = agreeReadings([r1, r2, r3]);
    expect(agreed.find((x) => x.ref === "W1")!.present).toBe(false);
    expect(agreed.find((x) => x.ref === "F1")!.instances).toBe(1);
  });

  it("the spread between two readings is what the tolerances are measured from", async () => {
    const { readingSpread } = await import("../photo-check");
    const [s] = readingSpread([at("F3", [20, 40, 60, 60])], [at("F3", [20, 40, 60, 65])]);
    expect(s!.ln_area).toBeCloseTo(Math.log(1.25), 6);
    expect(s!.ln_height).toBeCloseTo(Math.log(1.25), 6);
    expect(s!.centre).toBeCloseTo(2.5, 6);
  });

  it("size is symmetric in log terms: ×1.27 and ÷1.27 are the same change", async () => {
    const { judgePhotoPlacement: judge } = await import("../photo-check");
    const before = { items: [at("W1", [20, 30, 40, 50])] }; // 400
    // Width alone, so the height rule stays out of it.
    expect(judge(ITEMS, before, { items: [at("W1", [20, 30, 45, 50])] }).passed).toBe(true); // ×1.25
    expect(judge(ITEMS, before, { items: [at("W1", [20, 30, 36, 50])] }).passed).toBe(true); // ÷1.25
    expect(judge(ITEMS, before, { items: [at("W1", [20, 30, 47, 50])] }).failures[0]!.message).toBe("the render enlarged the window (35% of its area)");
    expect(judge(ITEMS, before, { items: [at("W1", [20, 30, 34.8, 50])] }).failures[0]!.message).toBe("the render shrank the window (-26% of its area)"); // ÷1.35
  });

  it("a fixture that keeps its area but grows tall fails on height (×1.19)", async () => {
    const { judgePhotoPlacement: judge } = await import("../photo-check");
    const before = { items: [at("F1", [40, 60, 60, 80])] }; // 20 × 20
    const tall = judge(ITEMS, before, { items: [at("F1", [42, 55, 58, 80])] }); // 16 × 25: area 400 → 400, height ×1.25
    expect(tall.failures[0]).toMatchObject({ reason: "resized", message: "the render made the WC taller (25% of its height)" });
  });

  it("a replacement with a stated height is held to it against the wall: a 1.2 m cabinet drawn 2 m tall fails", () => {
    const plan = { ...PLAN, ceiling_h_m: 2.8, fixtures: [...PLAN.fixtures, { id: "cab", type: "storage_cabinet", position: n(28, 212), spec: { replaces: "bidet_point", height_mm: 1200 } }] };
    const items = checkItemsFor(plan);
    const cab = items.find((i) => i.kind === "cabinet")!;
    expect(cab).toMatchObject({ top_share: 0.43, height_mm: 1200 });
    const before = { items: items.map((i) => (i.ref === cab.ref ? { ...at(i.ref, [80, 70, 95, 85]), top: 0.15 } : at(i.ref, null))) };
    const ok = { items: items.map((i) => (i.ref === cab.ref ? { ...at(i.ref, [80, 50, 95, 85]), top: 0.46 } : at(i.ref, null))) };
    const tall = { items: items.map((i) => (i.ref === cab.ref ? { ...at(i.ref, [80, 30, 95, 85]), top: 0.71 } : at(i.ref, null))) };
    expect(judgePhotoPlacement(items, before, ok).passed).toBe(true);
    const v = judgePhotoPlacement(items, before, tall);
    expect(v.failures[0]).toMatchObject({ reason: "resized", message: "the render made the storage cabinet too tall (about 2.0 m; 1.2 m planned)" });
  });
});
