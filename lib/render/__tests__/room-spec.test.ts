import { describe, expect, it } from "vitest";

import { restylePrompt, type StyleBrief } from "../photo-restyle";
import { changePrompt } from "../photo-view-change";
import { changeLine, followsLine, followsStateOf, judgeFollows, specElements, specFieldsChanged, viewsToRender, type RoomDesignSpec } from "../room-spec-vocab";

const SPEC: RoomDesignSpec = {
  floor_tile: "warm beige travertine-look porcelain, 600 × 1200, tight grout",
  wall_tile: "same travertine-look porcelain",
  tiled_height: "full height",
  vanity: "floating oak-veneer vanity, stone top, open shelf",
  mirror: "round backlit LED mirror",
  wc: null,
  shower_screen: "frameless clear glass, brushed-brass hinges",
  fittings_finish: "brushed brass",
  palette: "beige, warm oak, brass, white",
};

describe("B4 room design spec", () => {
  it("lists the spec as style elements, nulls dropped, tiled height joined to the walls", () => {
    const els = specElements(SPEC);
    expect(els.map((e) => e.element)).toEqual(["floor", "walls", "vanity", "mirror", "shower screen", "fittings", "palette"]);
    expect(els.find((e) => e.element === "walls")!.finish).toBe("same travertine-look porcelain, tiled full height");
  });

  it("judges follows over the elements the render shows", () => {
    const j = judgeFollows([
      { element: "floor", verdict: "same", note: "" },
      { element: "vanity", verdict: "same", note: "" },
      { element: "mirror", verdict: "partly", note: "" },
      { element: "shower screen", verdict: "not_visible", note: "" },
    ]);
    expect(j.score).toBe(0.83);
    expect(j.passed).toBe(true);
    expect(j.not_visible).toEqual(["shower screen"]);
    expect(judgeFollows([{ element: "floor", verdict: "different", note: "" }, { element: "vanity", verdict: "same", note: "" }]).passed).toBe(false);
    expect(judgeFollows([{ element: "floor", verdict: "not_visible", note: "" }]).passed).toBe(false);
  });

  it("names where a view stands against the anchor", () => {
    const anchor = { room_photo_id: "p2", render_id: "r2" };
    expect(followsStateOf({ viewPhotoId: "p2", anchor, renderAnchorId: null, followsPassed: null })).toBe("anchor");
    expect(followsStateOf({ viewPhotoId: "p1", anchor, renderAnchorId: "r2", followsPassed: true })).toBe("follows");
    expect(followsStateOf({ viewPhotoId: "p1", anchor, renderAnchorId: "r2", followsPassed: false })).toBe("differs");
    // The anchor was changed after this view followed it.
    expect(followsStateOf({ viewPhotoId: "p1", anchor, renderAnchorId: "r2-old", followsPassed: true })).toBe("stale");
    expect(followsStateOf({ viewPhotoId: "p1", anchor, renderAnchorId: null, followsPassed: null })).toBe("unchecked");
    expect(followsStateOf({ viewPhotoId: "p1", anchor, renderAnchorId: "r2", followsPassed: true, changedSpec: ["floor_tile"] })).toBe("changed");
    expect(followsStateOf({ viewPhotoId: "p1", anchor: null, renderAnchorId: null, followsPassed: null })).toBeNull();
    expect(followsLine("follows", "Photo 2")).toBe("Finishes follow Photo 2 (locked) ✓");
    expect(followsLine("differs", "Photo 2", ["vanity", "floor"])).toBe("Finishes differ from Photo 2 (locked) — vanity, floor");
    expect(followsLine("stale", "Photo 2")).toContain("Photo 2 changed after this view was rendered");
  });

  it("writes the change line and which spec fields a change touched", () => {
    expect(changeLine("lighter oak floor", 2, ["floor finish"])).toBe("Last change: “lighter oak floor” → version 2 · changed: floor finish");
    expect(specFieldsChanged(["floor finish", "lighting"])).toEqual(["floor_tile"]);
    expect(specFieldsChanged(["vanity", "colour palette", "WC"])).toEqual(["vanity", "palette", "wc"]);
  });

  it("renders remaining = positioned, unlocked views not rendered against the current anchor", () => {
    const anchor = { room_photo_id: "p2", render_id: "r2" };
    const views = [
      { id: "p1", positioned: true, locked: false, latestAnchorId: null }, // rendered before the anchor
      { id: "p2", positioned: true, locked: true, latestAnchorId: null }, // the anchor
      { id: "p3", positioned: true, locked: false, latestAnchorId: "r2" }, // follows already
      { id: "p4", positioned: true, locked: false, latestAnchorId: undefined }, // never rendered
      { id: "p5", positioned: false, locked: false, latestAnchorId: undefined }, // not placed — never in bulk
      { id: "p6", positioned: true, locked: true, latestAnchorId: "r1" }, // locked — kept
    ];
    expect(viewsToRender(views, anchor)).toEqual(["p1", "p4"]);
    expect(viewsToRender(views, null)).toEqual(["p4"]);
  });

  it("puts the anchor line in the restyle prompt only when anchored", () => {
    const style: StyleBrief = { text: "x", source: "anchor", line: "", elements: specElements(SPEC) };
    const withAnchor = restylePrompt("edit_pro", style, [], [], [], { label: "Photo 2" });
    expect(withAnchor).toContain("The SECOND image is another view of this same room");
    expect(withAnchor).toContain("Photo 2, locked");
    expect(restylePrompt("edit_pro", style, [], [], [])).not.toContain("SECOND image");
  });

  it("asks the edit model to change only what was asked", () => {
    expect(changePrompt("lighter oak floor")).toMatch(/^Edit this photo of a renovated bathroom: lighter oak floor\. Change ONLY that\./);
  });
});

describe("B4 spec carries no mounting", () => {
  it("drops how the WC is mounted — that is the plan's, not the anchor's", async () => {
    const { specElements: els, withoutMounting } = await import("../room-spec-vocab");
    expect(withoutMounting("White ceramic wall-hung WC with matching wall-hung bidet")).toBe("White ceramic WC with matching bidet");
    expect(withoutMounting("Floor-standing close-coupled rimless WC, white gloss")).toBe("rimless WC, white gloss");
    const wc = els({ ...SPEC, wc: "White ceramic wall-hung WC" }).find((e) => e.element === "WC")!;
    expect(wc.finish).toBe("White ceramic WC");
  });
});
