import { describe, expect, it } from "vitest";

import { checkItemsFor, type Located } from "../photo-check";
import { MASK_PAD, maskedChangePrompt, maskedChangeTarget, maskedVerdict } from "../masked-change";

// Ruled 20 Oct (after B10): "Ask for a change" takes the masked path for a
// request that names ONE item — that item's box is the mask — and today's edit
// is the fallback. The pilot bathroom: door, window, WC, vanity, shower glass,
// and a 1.2 m cabinet where the bidet was (ceiling 2.8 m).
const n = (x: number, y: number): [number, number] => [x / 266, y / 266];
const PLAN = {
  ceiling_h_m: 2.8,
  openings: [
    { id: "door", kind: "door", position: n(161.5, 263), width_mm: 870 },
    { id: "win", kind: "window", position: n(0, 50.5), width_mm: 450 },
  ],
  fixtures: [
    { id: "wc", type: "wc_point", position: n(33, 121), spec: null },
    { id: "vanity", type: "basin_point", position: n(239, 219.5), spec: null },
    { id: "shower", type: "shower_mixer", position: n(195.5, 45.5), spec: null },
    { id: "cab", type: "storage_cabinet", position: n(28, 212), spec: { replaces: "bidet_point", height_mm: 1200 } },
  ],
};
const ITEMS = checkItemsFor(PLAN);
const ref = (kind: string) => ITEMS.find((i) => i.kind === kind && !i.gone)!.ref;
const at = (r: string, box: [number, number, number, number] | null, top: number | null = null): Located => ({ ref: r, present: !!box, box, instances: box ? 1 : 0, top });
const SEEN: Located[] = [at(ref("door"), [52, 30, 85, 69]), at(ref("wc"), [68, 81, 100, 100]), at(ref("vanity"), [7, 50, 52, 67]), at(ref("shower"), [0, 12, 28, 93]), at(ref("cabinet"), [84, 66, 100, 88], 0.42)];

describe("masked changes — which requests take the masked path", () => {
  it("a request that names one item is edited inside that item's box, padded", () => {
    const t = maskedChangeTarget("Change the vanity counter to a white ceramic top with an integrated basin", ITEMS, SEEN)!;
    expect(t.item.kind).toBe("vanity");
    expect(t.box).toEqual([7 - MASK_PAD, 50 - MASK_PAD, 52 + MASK_PAD, 67 + MASK_PAD]);
    expect(maskedChangeTarget("Make the shower glass one fixed frameless panel", ITEMS, SEEN)!.item.kind).toBe("shower");
  });

  it("a replacement named with what it replaces is still ONE item (the bidet is gone), raised no higher than its stated height", () => {
    const t = maskedChangeTarget("Replace the bidet with a white cabinet, about 1.2 m tall", ITEMS, SEEN)!;
    expect(t.item.kind).toBe("cabinet");
    // Read at 0.42 of the wall, stated 0.43 (1.2 m of 2.8 m): the box reaches the stated top and no higher —
    // the wall is 22 / 0.42 = 52.4 % of the frame, so the top sits at 88 − 52.4 × 0.43.
    expect(t.box[1]).toBeCloseTo(88 - (22 / 0.42) * 0.43 - MASK_PAD, 6);
    expect(t.box[3]).toBeCloseTo(88 + MASK_PAD, 6);
  });

  it("today's edit when no item, several items, or an item not in this view is named", () => {
    expect(maskedChangeTarget("Make the lighting warmer", ITEMS, SEEN)).toBeNull();
    expect(maskedChangeTarget("Swap the WC and the vanity finishes", ITEMS, SEEN)).toBeNull();
    expect(maskedChangeTarget("Change the vanity to oak", ITEMS, SEEN.filter((l) => l.ref !== ref("vanity")))).toBeNull();
    // A shattaf is not a check item: no box to mask, so today's edit.
    expect(maskedChangeTarget("Remove the hand spray beside the door", ITEMS, SEEN)).toBeNull();
  });

  it("the fill prompt says what belongs in the region and quotes the request safely", () => {
    const p = maskedChangePrompt(ITEMS.find((i) => i.kind === "vanity")!, 'a "white" ceramic top');
    expect(p).toContain("shows the vanity");
    expect(p).toContain("\"a 'white' ceramic top\"");
    expect(p).toMatch(/no window, door or opening/);
    expect(p).toContain("every other part of the vanity keeps exactly its colour, material, size and design");
  });
});

describe("masked changes — kept, or today's edit instead", () => {
  const ok = { passed: true, line: "Layout follows your photo ✓" };
  it("kept when the layout holds and the request was done, or partly done", () => {
    expect(maskedVerdict({ unchanged: false, layout: ok, requestDone: "yes" })).toEqual({ keep: true });
    expect(maskedVerdict({ unchanged: false, layout: ok, requestDone: "partly" })).toEqual({ keep: true });
  });
  it("falls back, saying why, when the image is the same, the layout fails, or the request was not done", () => {
    expect(maskedVerdict({ unchanged: true, layout: ok })).toEqual({ keep: false, why: "the image came back the same" });
    expect(maskedVerdict({ unchanged: false, layout: { passed: false, line: "The render added a window — see what differs." } })).toEqual({ keep: false, why: "The render added a window — see what differs." });
    expect(maskedVerdict({ unchanged: false, layout: ok, requestDone: "no", summary: "a hinged door with a handle" })).toEqual({ keep: false, why: "not done — a hinged door with a handle" });
  });
});
