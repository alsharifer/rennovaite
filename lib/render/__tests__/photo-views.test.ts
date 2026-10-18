import { describe, expect, it } from "vitest";

import { cameraOf, compassWord, headingBetween, insidePolygon, normHeading, photoLabel, photoViewsOf, type RoomPhotoRow } from "../photo-views";

// B2 — every photo of a room is a view, placed on the plan. The pilot's five
// photos and their cameras are the room sheet's §4 (cm from the NW corner, x
// east, y south; headings compass, 0 = N = plan up). The room: 266 × 263, so
// normalised plan space is cm / 266 on both axes.
const n = (x: number, y: number): [number, number] => [x / 266, y / 266];
const ROOM: [number, number][] = [[0, 0], [1, 0], [1, 263 / 266], [0, 263 / 266]];
const SHEET_CAMERAS = [
  { id: "P1", file: "IMG-20261018-WA0009.jpg", at: [35, 60], heading: 155 },
  { id: "P2", file: "IMG-20261018-WA0011.jpg", at: [30, 130], heading: 105 },
  { id: "P3", file: "IMG-20261018-WA0012.jpg", at: [40, 230], heading: 40 },
  { id: "P4", file: "IMG-20261018-WA0014.jpg", at: [235, 235], heading: 300 },
  { id: "P5", file: "IMG-20261018-WA0016.jpg", at: [118, 105], heading: 60 },
] as const;

const row = (id: string, at: string, extra: Partial<RoomPhotoRow> = {}): RoomPhotoRow => ({ id, room_id: "bath", public_url: `https://x/${id}.jpg`, storage_path: `p/${id}.jpg`, created_at: at, ...extra });

describe("B2 — photo views", () => {
  it("every photo of the room is listed, oldest first, as Photo N · your photo — not just the latest", () => {
    const views = photoViewsOf([row("c", "2026-10-18T10:03:00Z"), row("a", "2026-10-18T10:01:00Z"), row("b", "2026-10-18T10:02:00Z"), { ...row("x", "2026-10-18T10:00:00Z"), room_id: "other" }], "bath");
    expect(views.map((v) => [v.id, v.label])).toEqual([
      ["a", "Photo 1 · your photo"],
      ["b", "Photo 2 · your photo"],
      ["c", "Photo 3 · your photo"],
    ]);
    expect(photoLabel(5)).toBe("Photo 5 · your photo");
  });

  it("the same file assigned twice is one view (the first row, with its camera)", () => {
    const views = photoViewsOf([row("a", "2026-10-18T10:01:00Z", { camera_position: n(30, 130), camera_heading_deg: 105 }), { ...row("a2", "2026-10-18T10:05:00Z"), storage_path: "p/a.jpg" }], "bath");
    expect(views).toHaveLength(1);
    expect(views[0]!.camera?.heading_deg).toBe(105);
  });

  it("a camera is a point in the room and a compass heading; anything else is 'not placed'", () => {
    expect(cameraOf({ camera_position: n(35, 60), camera_heading_deg: "155" })).toEqual({ position: n(35, 60), heading_deg: 155 });
    expect(cameraOf({ camera_position: null, camera_heading_deg: 155 })).toBeNull();
    expect(cameraOf({ camera_position: [0.1], camera_heading_deg: 155 })).toBeNull();
    expect(normHeading(-60)).toBe(300);
    expect(normHeading(720.04)).toBe(0);
  });

  it("the sheet's five cameras stand in the room, and a drag toward what each photo shows gives its heading (§4)", () => {
    // What each photo is described as covering, taken as the point it looks at.
    const LOOKS_AT: Record<string, [number, number]> = { P1: [161.5, 263], P2: [239, 219.5], P3: [195.5, 45.5], P4: [0, 50.5], P5: [266, 43] };
    for (const c of SHEET_CAMERAS) {
      expect(insidePolygon(n(c.at[0], c.at[1]), ROOM)).toBe(true);
      const look = LOOKS_AT[c.id]!;
      const h = headingBetween(n(c.at[0], c.at[1]), n(look[0], look[1]));
      // The sheet's headings are "~" — read off the photos; within 20° of the subject.
      const off = Math.abs(((h - c.heading + 540) % 360) - 180);
      expect(off, `${c.id}: drag gives ${h}°, the sheet says ~${c.heading}°`).toBeLessThanOrEqual(20);
    }
    expect(compassWord(155)).toBe("SSE");
    expect(compassWord(105)).toBe("ESE");
    expect(compassWord(300)).toBe("WNW");
    expect(insidePolygon(n(300, 100), ROOM)).toBe(false);
    expect(insidePolygon(n(0, 100), ROOM)).toBe(true); // against the wall counts
  });
});
