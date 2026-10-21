// C5 #2 — "DESIGN CHECK · PASSED" is itemised: geometry · openings · fixtures ·
// finishes follow anchor · products match BoQ, each ✓ / ✗ with its reason, the
// same rows in the studio and the room pack. A row nothing checked never reads ✓.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT } from "@/lib/__tests__/helpers/import-graph";
import { designKey } from "@/lib/documents/render-consistency";

import { designCheckHead, designCheckLine, photoViewCheckRows, roomRenderCheckRows } from "../design-check-items";
import type { CheckItem } from "../photo-check";

const item = (ref: string, kind: CheckItem["kind"], short: string) => ({ ref, kind, short, plan_id: ref, description: short }) as CheckItem;
const ITEMS = [item("D1", "door", "door"), item("W1", "window", "window"), item("F1", "wc", "WC"), item("F2", "vanity", "vanity"), item("F3", "shower", "shower glass")];
const FIX = [{ type: "wc_point", spec: null }, { type: "basin_point", spec: null }, { type: "shower_mixer", spec: null }];
const CHOICES = { shower_screen: "fixed_panel", vanity: "ready_made" };
const KEY = designKey(FIX, CHOICES);
const gate = (failures: { ref: string; short: string; reason: string; message: string }[] = [], over: Record<string, unknown> = {}) => ({ outcome: failures.length ? ("failed" as const) : ("passed" as const), items: ITEMS, checked: ITEMS.map((i) => i.ref), attempts: [{ failures }], design_key: KEY, ...over });
const states = (rows: ReturnType<typeof photoViewCheckRows>) => Object.fromEntries(rows.map((r) => [r.key, r.state]));

describe("a photo view", () => {
  it("passed, following the anchor, with today's products: five ✓", () => {
    const rows = photoViewCheckRows({ gate: gate(), follows: "follows", anchorLabel: "Photo 2", designNow: KEY });
    expect(states(rows)).toEqual({ geometry: "pass", openings: "pass", fixtures: "pass", finishes: "pass", products: "pass" });
    expect(designCheckHead(rows)).toBe("DESIGN CHECK · 5 OF 5 PASSED");
    expect(rows.find((r) => r.key === "fixtures")!.reason).toBe("WC, vanity, shower glass — each once, in place");
    expect(rows.find((r) => r.key === "finishes")!.reason).toBe("Finishes follow Photo 2 (locked)");
  });

  it("each failure lands on its row — a moved vanity is Fixtures, a shrunk WC Geometry, a moved door Openings", () => {
    const rows = photoViewCheckRows({
      gate: gate([
        { ref: "F2", short: "vanity", reason: "moved", message: "the render moved the vanity" },
        { ref: "F1", short: "WC", reason: "resized", message: "the render shrank the WC (−40% of its area)" },
        { ref: "D1", short: "door", reason: "moved", message: "the render moved the door" },
      ]),
      follows: null,
      anchorLabel: null,
      designNow: KEY,
    });
    expect(states(rows)).toMatchObject({ geometry: "fail", openings: "fail", fixtures: "fail" });
    expect(rows.find((r) => r.key === "fixtures")!.reason).toBe("the render moved the vanity");
    expect(designCheckHead(rows)).toBe("DESIGN CHECK · 1 OF 5 PASSED · 3 FAILED");
  });

  it("what nothing checked says so — never a ✓ it did not earn", () => {
    const rows = photoViewCheckRows({ gate: gate([], { design_key: undefined, items: ITEMS.slice(2), checked: ["F1", "F2", "F3"] }), follows: null, anchorLabel: null, designNow: KEY, styleLine: "Style follows your references ✓" });
    expect(states(rows)).toEqual({ geometry: "pass", openings: "unchecked", fixtures: "pass", finishes: "unchecked", products: "unchecked" });
    expect(designCheckLine(rows[1]!)).toBe("✗ Openings — not checked — this photo shows no door or window");
    expect(rows[3]!.reason).toBe("not checked — no view of this room is locked yet (style follows your references)");
    expect(designCheckHead(rows)).toBe("DESIGN CHECK · 2 OF 5 PASSED");
  });

  it("products moved after the render: ✗ Products match BoQ, saying what moved", () => {
    const rows = photoViewCheckRows({ gate: gate(), follows: "anchor", anchorLabel: "Photo 2", designNow: designKey(FIX, { ...CHOICES, shower_screen: "enclosure" }) });
    expect(rows.find((r) => r.key === "products")).toMatchObject({ state: "fail", reason: "rendered before shower screen was fixed_panel, now enclosure" });
  });
});

describe("a room render (interior QA) and a garden scene render", () => {
  it("the interior QA judged walls, openings and camera — fixtures, finishes and products were not checked", () => {
    const rows = roomRenderCheckRows({ qa: { passed: true, structure_preserved: true, artifacts: false, photorealistic: true, reason: "ok" }, scene: null })!;
    expect(states(rows)).toEqual({ geometry: "pass", openings: "pass", fixtures: "unchecked", finishes: "unchecked", products: "unchecked" });
    expect(designCheckHead(rows)).toBe("DESIGN CHECK · 2 OF 5 PASSED");
    const bad = roomRenderCheckRows({ qa: { passed: false, structure_preserved: false, artifacts: false, photorealistic: true, reason: "The window moved to the other wall." }, scene: null })!;
    expect(states(bad)).toMatchObject({ geometry: "fail", openings: "fail" });
    expect(bad[0]!.reason).toBe("The window moved to the other wall.");
    expect(roomRenderCheckRows({ qa: null, scene: null })).toBeNull();
  });
  it("a passed garden scene render: geometry and placement ✓, consistency where it ran", () => {
    const rows = roomRenderCheckRows({ qa: null, scene: { outcome: "passed", attempts: [{ passed: true, placement_checked: true }], consistency: { passed: false, failures: ["pergola design differs"], status: "ran" } } })!;
    expect(states(rows)).toEqual({ geometry: "pass", openings: "unchecked", fixtures: "pass", finishes: "fail", products: "unchecked" });
  });
});

describe("one check, every surface", () => {
  it("the studio, the room-render panel and the room pack print the same rows; no bare 'DESIGN CHECK · PASSED' is left", () => {
    const studio = readFileSync(path.join(ROOT, "components/blueprint/renders/PhotoViewStudio.tsx"), "utf8");
    const rooms = readFileSync(path.join(ROOT, "components/blueprint/renders/RendersStudio.tsx"), "utf8");
    const pack = readFileSync(path.join(ROOT, "lib/documents/room-pack-pdf.ts"), "utf8");
    expect(studio).toMatch(/photoViewCheckRows/);
    expect(pack).toMatch(/photoViewCheckRows/);
    expect(rooms).toMatch(/roomRenderCheckRows/);
    for (const src of [studio, rooms]) expect(src).not.toMatch(/DESIGN CHECK · PASSED|MATCHES YOUR PHOTO/);
  });
});

describe("C5 gap: a view with no product record is never vouched for", () => {
  it("✗ Products match BoQ — not checked — rendered before product tracking; the studio flags the locked view", () => {
    const rows = photoViewCheckRows({ gate: gate([], { design_key: undefined }), follows: "anchor", anchorLabel: "Photo 2", designNow: KEY });
    expect(designCheckLine(rows.find((r) => r.key === "products")!)).toBe("✗ Products match BoQ — not checked — rendered before product tracking");
    const studio = readFileSync(path.join(ROOT, "components/blueprint/renders/PhotoViewStudio.tsx"), "utf8");
    expect(studio).toMatch(/LOCKED · PRODUCTS NOT CHECKED/);
    expect(studio).toMatch(/data-view-untracked/);
  });
});
