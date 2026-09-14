import { describe, expect, it } from "vitest";

import { villa94PlanRecords } from "@/lib/ground-truth/villa94-garden-geometry";
import {
  exteriorStyleDescriptor,
  gardenPresetItems,
  descriptorFor,
  buildReferenceClause,
  styleImageCatalog,
  type MoodboardItem,
} from "@/lib/moodboard/types";
import {
  buildEveningPrompt,
  currentDayRender,
  lightingByZone,
  planBatch,
  type BatchRender,
  type BatchRoom,
} from "@/lib/render-batch/plan";
import { STYLES } from "@/lib/styles";

const rec = villa94PlanRecords();
const rooms: BatchRoom[] = rec.rooms.map((r) => ({
  id: r.id,
  name_en: r.name_en,
  room_type: r.room_type,
  polygon: r.polygon,
}));
const NOW = Date.parse("2026-09-13T12:00:00Z");
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();

const render = (over: Partial<BatchRender> & { id: string; room_id: string }): BatchRender => ({
  status: "succeeded",
  image_url: `https://img/${over.id}.png`,
  parent_render_id: null,
  view: null,
  created_at: at(30),
  ...over,
});

describe("lighting by zone — Villa 94", () => {
  const lights = lightingByZone(rooms, rec.fixtures);
  const total = (id: string) => (lights.get(id) ?? []).reduce((s, l) => s + l.count, 0);

  it("assigns every one of the 37 designed points to exactly one zone", () => {
    const all = [...lights.values()].flat().reduce((s, l) => s + l.count, 0);
    expect(all).toBe(37);
  });

  it("puts nothing in the pergola — its downlights are part of the structure", () => {
    expect(total("z-pergola")).toBe(0);
  });

  it("carries boundary lights to the zone whose edge they sit on", () => {
    const west = lights.get("z-planting-west") ?? [];
    expect(west.find((l) => l.code === "BL")?.count).toBe(3);
  });
});

describe("planBatch", () => {
  it("queues a day view for every zone and an evening view only where lighting exists", () => {
    const jobs = planBatch({ rooms, renders: [], fixtures: rec.fixtures, now: NOW });
    const days = jobs.filter((j) => j.view === "day");
    const evenings = jobs.filter((j) => j.view === "evening");
    expect(days).toHaveLength(12);
    expect(days.every((j) => j.status === "queued")).toBe(true);
    // Lit zones + the pergola (structure). The unlit pergola court paving has none.
    const lit = new Set(evenings.map((j) => j.room_id));
    expect(lit.has("z-pergola")).toBe(true);
    expect(lit.has("z-lawn-back")).toBe(true);
    // Without a day render, an evening job is blocked, never queued.
    expect(evenings.every((j) => j.status === "blocked")).toBe(true);
    for (const id of lit) expect(rooms.find((r) => r.id === id)).toBeTruthy();
  });

  it("skips what is done, so pressing the button twice costs nothing", () => {
    const renders = rooms.map((r) => render({ id: `d-${r.id}`, room_id: r.id }));
    const first = planBatch({ rooms, renders, fixtures: rec.fixtures, now: NOW });
    expect(first.filter((j) => j.view === "day").every((j) => j.status === "done")).toBe(true);
    const evenings = first.filter((j) => j.view === "evening");
    expect(evenings.every((j) => j.status === "queued" && j.parent_render_id === `d-${j.room_id}`)).toBe(true);

    const withEvenings = [
      ...renders,
      ...evenings.map((j) => render({ id: `e-${j.room_id}`, room_id: j.room_id, view: "evening", parent_render_id: j.parent_render_id, created_at: at(5) })),
    ];
    const second = planBatch({ rooms, renders: withEvenings, fixtures: rec.fixtures, now: NOW });
    expect(second.every((j) => j.status === "done")).toBe(true);
  });

  it("treats an evening as stale once its day view is tweaked", () => {
    const lawn = "z-lawn-back";
    const renders = [
      render({ id: "d1", room_id: lawn, created_at: at(60) }),
      render({ id: "e1", room_id: lawn, view: "evening", parent_render_id: "d1", created_at: at(50) }),
      render({ id: "d2", room_id: lawn, parent_render_id: "d1", created_at: at(40) }), // a tweak of the day
    ];
    expect(currentDayRender(renders, lawn)?.id).toBe("d2");
    const job = planBatch({ rooms, renders, fixtures: rec.fixtures, now: NOW }).find((j) => j.room_id === lawn && j.view === "evening")!;
    expect(job.status).toBe("queued");
    expect(job.parent_render_id).toBe("d2");
    expect(job.reason).toMatch(/day view changed/);
  });

  it("never counts an evening render as the zone's day view", () => {
    const lawn = "z-lawn-back";
    const renders = [
      render({ id: "d1", room_id: lawn, created_at: at(60) }),
      render({ id: "e1", room_id: lawn, view: "evening", parent_render_id: "d1", created_at: at(10) }),
    ];
    expect(currentDayRender(renders, lawn)?.id).toBe("d1");
  });

  it("reports a recent pending render as in flight and ignores a stale one", () => {
    const lawn = "z-lawn-back";
    const fresh = planBatch({ rooms, renders: [render({ id: "p", room_id: lawn, status: "pending", image_url: null, created_at: at(2) })], fixtures: [], now: NOW });
    expect(fresh.find((j) => j.room_id === lawn)!.status).toBe("in_flight");
    const stale = planBatch({ rooms, renders: [render({ id: "p", room_id: lawn, status: "pending", image_url: null, created_at: at(30) })], fixtures: [], now: NOW });
    expect(stale.find((j) => j.room_id === lawn)!.status).toBe("queued");
  });

  it("gives interior rooms a day view and no evening view", () => {
    const jobs = planBatch({
      rooms: [{ id: "bed", name_en: "Bedroom", room_type: "bedroom", polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
      renders: [],
      fixtures: [{ type: "garden_light", room_id: "bed", position: [0.5, 0.5] }],
      now: NOW,
    });
    expect(jobs.map((j) => j.view)).toEqual(["day"]);
  });
});

describe("evening prompt", () => {
  it("is deterministic and names only the designed lighting", () => {
    const lights = lightingByZone(rooms, rec.fixtures).get("z-lawn-back")!;
    const a = buildEveningPrompt({ roomType: "artificial_grass", lights });
    expect(a).toBe(buildEveningPrompt({ roomType: "artificial_grass", lights }));
    expect(a).toContain("6 × spike light 8.5 w");
    expect(a).toContain("Add no light fittings that are not listed");
    expect(buildEveningPrompt({ roomType: "structure", lights: [] })).toContain("integral warm-white downlights");
  });
});

describe("garden style preset", () => {
  it("seeds a garden direction's garden and structure art, style descriptions only", () => {
    const items = gardenPresetItems("desert-modern")!;
    expect(items.map((i) => i.style_room)).toEqual(["garden", "structure"]);
    for (const i of items) {
      expect(i.descriptor).toBe(exteriorStyleDescriptor("desert-modern", i.style_room));
      expect(i.descriptor).not.toMatch(/\d+(\.\d+)?\s?(m|mm|m²)\b/);
    }
    expect(gardenPresetItems("scandi-minimal")).toBeNull();
  });

  it("describes a preset item through the exterior style, not the interior fallback", () => {
    const item: MoodboardItem = {
      id: "x",
      project_id: "p",
      kind: "style",
      asset_id: null,
      render_id: null,
      style_key: "courtyard-majlis",
      style_room: "structure",
      image_url: "/moodboards/courtyard-majlis-structure.png",
      descriptor: null,
      position: 0,
    };
    expect(descriptorFor(item)).toMatch(/^outdoor structure: Courtyard Majlis/);
    expect(buildReferenceClause([item])).toContain("Courtyard Majlis");
  });

  it("leaves the interior style-library catalogue exactly as it was", () => {
    const cat = styleImageCatalog(STYLES);
    expect(cat).toHaveLength(STYLES.length * 4);
    expect(cat.some((c) => /garden|structure/.test(c.image_url))).toBe(false);
  });
});
