import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compositeInside, MASK_MODEL, MASKED_ARM_MODEL, maskedArm, maskPng, padBox, PASTE_MODEL, raiseBox, raiseToTop } from "../masked-edit";
import { capAllows, SpendCap, SpendCapReached } from "../spend-cap";

// B10 — masked per-fixture edits, and the session's hard spend cap.
const solid = (w: number, h: number, rgb: [number, number, number]) => sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).jpeg({ quality: 100 }).toBuffer();

describe("B10 — a masked edit changes nothing outside its mask, by construction", () => {
  it("pastes the original back pixel for pixel outside the box; the edit shows inside it", async () => {
    const W = 200, H = 400;
    const original = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
    const edited = await solid(180, 360, [250, 10, 10]); // another size: the model's output is resized to the frame
    const mask = await maskPng({ width: W, height: H }, [[25, 50, 75, 75]]);
    const out = await sharp(await compositeInside(new Uint8Array(original), new Uint8Array(edited), mask, 3)).raw().toBuffer();
    const px = (x: number, y: number) => [...out.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];
    // Outside the box: the original (JPEG of the result → within a few levels).
    for (const [x, y] of [[5, 5], [195, 395], [40, 190], [160, 310]]) {
      const [r, g, b] = px(x!, y!);
      expect(Math.abs(r! - 30) + Math.abs(g! - 120) + Math.abs(b! - 200), `${x},${y}`).toBeLessThan(12);
    }
    // Inside: the edit.
    const [r, g, b] = px(100, 250);
    expect(r).toBeGreaterThan(200);
    expect(g! + b!).toBeLessThan(80);
  });

  it("the boxes: padded and clamped; a replacement raised to its new height from the old one's floor line", () => {
    expect(padBox([2, 10, 99, 50], 2)).toEqual([0, 8, 100, 52]);
    expect(raiseBox([80, 70, 100, 85], 3)).toEqual([80, 40, 100, 85]);
    expect(raiseBox([80, 70, 100, 85], 0.5)).toEqual([80, 70, 100, 85]); // never shrunk
    // From the check's own reading: a bidet box 15 % of the frame tall reaching 0.15 of its wall puts the
    // wall at 100 % of the frame; a 1.2 m cabinet on a 2.8 m ceiling (0.43) tops out at 85 − 43 = 42.
    expect(raiseToTop([80, 70, 100, 85], 0.15, 0.43)).toEqual([80, 42, 100, 85]);
    expect(raiseToTop([80, 70, 100, 85], null, 0.43)).toEqual([80, 70, 100, 85]);
  });
});

describe("B10 — the masked change's model (measured 20 Oct)", () => {
  it("pastes nano-banana's whole-image edit back inside the box by default; flux-fill stays an option", () => {
    expect(maskedArm({})).toBe("paste");
    expect(maskedArm({ MASKED_CHANGE_MODEL: "paste" })).toBe("paste");
    expect(maskedArm({ MASKED_CHANGE_MODEL: "fill" })).toBe("fill");
    expect(maskedArm({ MASKED_CHANGE_MODEL: "something-else" })).toBe("paste");
    expect(MASKED_ARM_MODEL).toEqual({ paste: PASTE_MODEL, fill: MASK_MODEL });
    expect(PASTE_MODEL).toBe("google/nano-banana");
  });
});

describe("B10 — the hard spend cap", () => {
  it("allows a call only while spent + reserved + its worst case stays at or under the cap", () => {
    expect(capAllows(4.6, 0, 0.3, 5)).toBe(true);
    expect(capAllows(4.6, 0.15, 0.3, 5)).toBe(false);
    expect(capAllows(4.95, 0, 0.05, 5)).toBe(true);
  });

  it("refuses a call that would cross the cap before anything is spent, and counts what it records", async () => {
    const inserted: unknown[] = [];
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: async () => ({ data: [{ cost_usd: 4.7 }], error: null }) }) }),
        insert: async (rows: unknown[]) => (inserted.push(...rows), { error: null }),
      }),
    };
    const cap = new SpendCap(db as never, "p", "b10", 5);
    let ran = false;
    await expect(cap.run("a pro render", 0.15, async () => ((ran = true), { value: 1, spend: [] }))).resolves.toBe(1);
    await expect(cap.run("an agreed reading", 0.31, async () => ((ran = true), { value: 1, spend: [] }))).rejects.toBeInstanceOf(SpendCapReached);
    ran = false;
    await cap.run("a fill", 0.05, async () => ({ value: 1, spend: [{ project_id: "p", purpose: "eval", model: "m", cost_usd: 0.05 }] }));
    expect(await cap.spent()).toBeCloseTo(4.75, 6);
    expect((inserted[0] as { detail: { session_ref: string } }).detail.session_ref).toBe("b10");
    await expect(cap.run("a pro render", 0.26, async () => ((ran = true), { value: 1, spend: [] }))).rejects.toThrow(/past its US\$5\.00 cap/);
    expect(ran).toBe(false);
  });
});
