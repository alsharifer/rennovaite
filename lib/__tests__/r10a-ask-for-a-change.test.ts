import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { STRUCTURAL_MESSAGE, classifyChangeRequest, planOpeningsHref } from "@/lib/render/change-request";
import { UNCHANGED_MESSAGE, compareImages, isUnchangedEdit } from "@/lib/render/similarity";
import { buildEditPrompt, buildOffplanBasePrompt, roomTypeFromDb } from "@/lib/render-prompts";

// R10a (spec §7.5) — "Ask for a change": an edit that returns the same image is
// not a version; a structural request is answered by the plan; dining, kitchen
// and majlis have their own prompts.

describe("which requests belong on the plan", () => {
  const structural = [
    "Move the kitchen to the left side of the room and the windows to the right side", // the walkthrough's own words
    "Move the kitchen to the right side of the room and the windows to the left.",
    "add a window on the back wall",
    "remove the wall between the kitchen and dining",
    "make the windows floor-to-ceiling",
    "bigger windows",
    "open up the kitchen",
    "put the kitchen on the left",
    "kitchen on the left please",
  ];
  const finish = [
    "darker floor",
    "add curtains to the window",
    "make the room warmer",
    "replace the door with a walnut one",
    "make the window frames black",
    "add window shutters",
    "change the kitchen cabinets to walnut",
    "more sun from the window",
    "swap the rug for a jute one",
    "remove the door handles",
    "add a pendant over the table",
  ];
  for (const t of structural) it(`structural: "${t}"`, () => expect(classifyChangeRequest(t).kind).toBe("structural"));
  for (const t of finish) it(`finish: "${t}"`, () => expect(classifyChangeRequest(t)).toEqual({ kind: "finish", matched: null }));
  it("the answer and the link", () => {
    expect(STRUCTURAL_MESSAGE).toBe("Walls and windows come from your plan — adjust them there");
    expect(planOpeningsHref("p1")).toBe("/project/p1/plan?layer=openings");
  });
});

describe("an edit that came back the same", () => {
  it("the walkthrough's scores: the first tweak was unchanged, the second was not", () => {
    expect(isUnchangedEdit({ ssim: 0.992, changedPct: 0.0, meanDiffPct: 0.5 })).toBe(true);
    expect(isUnchangedEdit({ ssim: 0.937, changedPct: 4.4, meanDiffPct: 1.8 })).toBe(false);
    // A small, real local change moves pixels even when the structure barely moves.
    expect(isUnchangedEdit({ ssim: 0.99, changedPct: 1.2, meanDiffPct: 0.6 })).toBe(false);
    expect(UNCHANGED_MESSAGE).toBe("That change didn’t come through — the image is the same. Try being more specific.");
  });

  it("measured on real image bytes: a re-encode is unchanged; a new object is a change", async () => {
    const W = 400;
    const H = 300;
    const base = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 230, g: 225, b: 215 } } })
      .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}"><rect x="40" y="60" width="120" height="160" fill="#555"/><rect x="250" y="200" width="100" height="60" fill="#8a6"/></svg>`), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();
    const reencoded = await sharp(base).jpeg({ quality: 80 }).toBuffer();
    const edited = await sharp(base)
      .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}"><rect x="200" y="40" width="160" height="120" fill="#222"/></svg>`), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();
    expect(isUnchangedEdit(await compareImages(base, reencoded))).toBe(true);
    const changed = await compareImages(base, edited);
    expect(isUnchangedEdit(changed)).toBe(false);
    expect(changed.changedPct).toBeGreaterThan(5);
  });
});

describe("dining, kitchen and majlis are their own rooms", () => {
  it("no more dining → living; kitchens can be rendered at all", () => {
    expect(roomTypeFromDb("dining")).toBe("dining");
    expect(roomTypeFromDb("majlis")).toBe("majlis");
    expect(roomTypeFromDb("kitchen")).toBe("kitchen");
    expect(roomTypeFromDb("living")).toBe("living");
  });
  it("their prompts name the room; the living room's prompt is unchanged (it is the render cache key)", () => {
    const dining = buildEditPrompt({ styleKey: "luxe-minimal" as never, roomType: "dining" });
    expect(dining).toMatch(/^Renovate this exact dining room in /);
    expect(dining).toMatch(/dining table/);
    expect(dining).not.toMatch(/modular sofa facing the camera/);
    expect(buildEditPrompt({ styleKey: "luxe-minimal" as never, roomType: "kitchen" })).toMatch(/exact kitchen in .*cabinetry/);
    expect(buildEditPrompt({ styleKey: "luxe-minimal" as never, roomType: "majlis" })).toMatch(/exact majlis in .*majlis seating/);
    // The four existing rooms gain nothing: no cue, the legacy sentence shape (their prompt is the render cache key).
    for (const roomType of ["living", "master-bedroom", "secondary-bedroom", "bathroom"] as const) {
      const p = buildEditPrompt({ styleKey: "luxe-minimal" as never, roomType });
      expect(p).not.toMatch(/Furnish it as/);
      expect(p).toMatch(/ Keep the room's architecture, wall positions, window and door locations, and camera angle exactly the same. Photorealistic interior photography, magazine quality.$/);
    }
    expect(buildOffplanBasePrompt({ roomType: "dining", widthM: 3, depthM: 6 })).toBe("Empty unfurnished dining room, 3.0m wide by 6.0m deep, ceiling 2.9m, a single window on one side wall, screed floor, white primed walls, photorealistic, eye-level 24mm.");
  });
});

describe("the wiring (static)", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

  it("a structural request is refused before any model call; an unchanged edit is never a version", () => {
    const iterate = read("app/api/render-iterate/route.ts");
    const cls = iterate.indexOf("classifyChangeRequest(tweak)");
    expect(cls).toBeGreaterThan(0);
    expect(cls).toBeLessThan(iterate.indexOf("createRenderPrediction("));
    expect(cls).toBeLessThan(iterate.indexOf("const { data: parent"));
    const status = read("app/api/render/status/route.ts");
    const unchanged = status.indexOf(`status: "unchanged", qa:`);
    expect(unchanged).toBeGreaterThan(0);
    expect(unchanged).toBeLessThan(status.indexOf("await rehostImage("));
    expect(read("app/project/[id]/render/page.tsx")).toMatch(/status !== "unchanged"/);
    expect(read("components/blueprint/renders/RendersStudio.tsx")).toMatch(/err instanceof RenderNotice/);
  });
});
