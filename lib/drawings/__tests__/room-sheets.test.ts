// B6 — the room's drawings: every printed dimension against the graph, to the mm.
import { describe, expect, it } from "vitest";

import { mirrorIsRound, roomSheets, roomWalls, settingOut, wallTileFrom, type RoomFixtureIn } from "@/lib/drawings/room-sheets";
import { buildPlanGraph, type RawOpening } from "@/lib/plan/geometry";
import { roomFromDimensions } from "@/lib/plan/room-intake";

const Lw = 2.66;
const n = (xCm: number, yCm: number): [number, number] => [xCm / 100 / Lw, yCm / 100 / Lw];
const ROOM = roomFromDimensions({ room_type: "bathroom", length_m: 2.66, width_m: 2.63, height_m: 2.8 });
const RAW = { id: "bath", name_en: "Bathroom", name_ar: null, room_type: "bathroom", area_m2: ROOM.area_m2, polygon: ROOM.polygon, unroofed: false, ceiling_h_m: 2.8, ceiling_h_source: "measured" };
const DOOR: RawOpening = { id: "door", room_id: "bath", type: "door", width_mm: 870, height_mm: 2100, sill_mm: 0, position: n((118 + 205) / 2, 263), derived: false, spec: { hinge: "W" } } as RawOpening;
const WINDOW: RawOpening = { id: "window", room_id: "bath", type: "window", width_mm: 450, height_mm: 600, sill_mm: 1500, position: n(0, (28 + 73) / 2), derived: false };
const graph = buildPlanGraph({ projectId: "pilot", planId: "plan", scale: null, total_area_m2: ROOM.area_m2, rooms: [RAW as never], openings: [DOOR, WINDOW], unit_to_m: Lw, plot: { width_m: 2.66, depth_m: 2.63 }, source: "user_drawn" });
const FIXTURES: RoomFixtureIn[] = [
  { id: "wc", type: "wc_point", position: n(33, 121), spec: { width_mm: 420, depth_mm: 660, rotation_deg: 90, footprint: "entered" } },
  { id: "bidet", type: "bidet_point", position: n(28, 212), spec: { width_mm: 360, depth_mm: 480, rotation_deg: 90, footprint: "entered", wall_gap_mm: 40 } },
  { id: "vanity", type: "basin_point", position: n(239, 219.5), spec: { width_mm: 870, depth_mm: 540, rotation_deg: 270, footprint: "entered" } },
  { id: "shower", type: "shower_mixer", position: n(195.5, 45.5), spec: { width_mm: 1410, depth_mm: 910, rotation_deg: 180, footprint: "entered", column_wall: "E", niche_wall: "N" } },
  { id: "drain", type: "floor_drain", position: n(120, 110), spec: null },
  { id: "heater", type: "water_heater", position: n(170, 5), spec: { height_mm: 2100 } },
];
const META = { projectNameEn: "Bathroom pilot", community: "Dubai", level: "first_floor", scale: "1:20", dateISO: "2026-10-19", rev: "3" };
const sheets = roomSheets({ graph, roomId: "bath", fixtures: FIXTURES, tile: wallTileFrom(null), meta: META });
const dims = (svg: string) => [...svg.matchAll(/data-dim="([^"]+)" data-mm="(-?\d+)" data-src="([^"]+)"/g)].map((m) => ({ key: m[1]!, mm: Number(m[2]), src: m[3]! }));

describe("B6 — R-101 the dimensioned plan", () => {
  const plan = sheets[0]!.svg;
  it("draws the door with its leaf and swing on the hinge the opening states (W), and the window", () => {
    expect(plan).toContain('data-opening="door" data-opening-type="door" data-hinge="W"');
    expect(plan).toContain('data-opening="window" data-opening-type="window"');
    expect(plan).toContain("Door: hinge W, opens in.");
  });
  it("every wall's chain closes on its length; the door's jambs are where the sheet has them", () => {
    const d = dims(plan);
    const south = d.filter((x) => x.src.startsWith("South:") && !x.key.startsWith("wall:"));
    // Seen from inside, the south wall runs east → west: 266 − 205, the door, 118.
    expect(south.map((x) => x.mm)).toEqual([610, 870, 1180]);
    expect(south.reduce((s, x) => s + x.mm, 0)).toBe(2660);
    const west = d.filter((x) => x.src.startsWith("West:") && !x.key.startsWith("wall:"));
    // Seen from inside, the west wall runs south → north: 263 − 73, the window, 28.
    expect(west.map((x) => x.mm)).toEqual([1900, 450, 280]);
    expect(d.find((x) => x.key === "wall:South")!.mm).toBe(2660);
    expect(d.find((x) => x.key === "wall:West")!.mm).toBe(2630);
  });
  it("dimensions each fixture's centre from its nearest corner", () => {
    const d = dims(plan);
    expect(d.find((x) => x.src.startsWith("fixture:wc:"))!.mm).toBe(1210);
    expect(d.find((x) => x.src.startsWith("fixture:bidet:"))!.mm).toBe(510); // 263 − 212
  });
});

describe("B6 — R-201… the wall elevations", () => {
  const elev = sheets.slice(1);
  it("one elevation per wall, each at the graph's length × the ceiling", () => {
    expect(elev.map((s) => s.number)).toEqual(["R-201", "R-202", "R-203", "R-204"]);
    const walls = roomWalls(graph.rooms[0]!);
    for (const s of elev) {
      const d = dims(s.svg);
      const side = /data-elevation="(\w+)"/.exec(s.svg)![1]!;
      expect(d.find((x) => x.key === `wall:${side}`)!.mm).toBe(Math.round(walls.find((w) => w.side === side)!.length_m * 1000));
      expect(d.find((x) => x.key === "ceiling")!.mm).toBe(2800);
    }
  });
  it("the setting-out adds up to the wall: cut + full tiles + cut", () => {
    for (const s of elev) {
      const d = dims(s.svg);
      const side = /data-elevation="(\w+)"/.exec(s.svg)![1]!;
      const len = d.find((x) => x.key === `wall:${side}`)!.mm;
      const left = d.find((x) => x.key === `cut-left:${side}`)!.mm, right = d.find((x) => x.key === `cut-right:${side}`)!.mm;
      expect(left).toBe(right);
      const full = (len - left - right) / 600;
      expect(Number.isInteger(Math.round(full * 1000) / 1000)).toBe(true);
    }
    // A joint on the centreline would leave 130 mm cuts; a centred tile leaves 430 — the larger wins.
    expect(settingOut(2660, 600)).toEqual({ joints: [430, 1030, 1630, 2230], cut: 430, centred: "tile" });
  });
  it("prints the window's sill and head and the door's height from the graph", () => {
    const west = elev.find((s) => s.svg.includes('data-elevation="West"'))!.svg;
    const d = dims(west);
    expect(d.find((x) => x.src === "window.sill_mm")!.mm).toBe(1500);
    expect(d.find((x) => x.src === "window.height_mm")!.mm).toBe(600);
    expect(d.find((x) => x.src === "window.width_mm")!.mm).toBe(450);
    const south = elev.find((s) => s.svg.includes('data-elevation="South"'))!.svg;
    expect(dims(south).find((x) => x.src === "door.height_mm")!.mm).toBe(2100);
  });
  it("puts each fixture on its own wall, at standard heights printed with ≈", () => {
    const by = (side: string) => elev.find((s) => s.svg.includes(`data-elevation="${side}"`))!.svg;
    expect(by("West")).toContain('data-fixture="wc"');
    expect(by("West")).toContain('data-fixture="bidet"');
    expect(by("East")).toContain('data-fixture="vanity"');
    expect(by("East")).toContain('data-fixture="shower:valve"'); // the column on the E wall
    expect(by("North")).toContain('data-fixture="shower:niche"'); // the niche on the N wall
    expect(by("North")).toContain('data-fixture="heater"');
    expect(dims(by("West")).filter((x) => x.src.startsWith("standard:")).length).toBeGreaterThan(0);
    expect(by("West")).toContain('data-approx="true"');
  });
  it("draws a fixture face-on only on the wall its back is against — on a side wall it is a profile", () => {
    const by = (side: string) => elev.find((s) => s.svg.includes(`data-elevation="${side}"`))!.svg;
    // The vanity's back is on the east wall; it touches the south wall by its side.
    expect(by("East")).toContain('data-fixture="vanity:mirror"');
    expect(by("South")).toContain('data-fixture="vanity:side"');
    expect(by("South")).not.toContain('data-fixture="vanity:mirror"');
    expect(by("South")).not.toContain('data-fixture="vanity:shaver"');
  });
  it("the tiler's chain runs joint to joint and closes on the wall", () => {
    for (const s of elev) {
      const d = dims(s.svg);
      const side = /data-elevation="(\w+)"/.exec(s.svg)![1]!;
      const chain = d.filter((x) => x.key.startsWith(`cut-left:${side}`) || x.key.startsWith(`tile:${side}:`) || x.key.startsWith(`cut-right:${side}`));
      expect(chain.reduce((a, x) => a + x.mm, 0)).toBe(d.find((x) => x.key === `wall:${side}`)!.mm);
    }
  });
  it("the mirror's shape follows the design: round only when it says so", () => {
    expect(mirrorIsRound("Rectangular, frameless, integrated perimeter LED backlight")).toBe(false);
    expect(mirrorIsRound("Backlit round mirror")).toBe(true);
    expect(mirrorIsRound(null)).toBe(false);
    const east = roomSheets({ graph, roomId: "bath", fixtures: FIXTURES, tile: wallTileFrom(null), mirror: "Rectangular, frameless", meta: META })[2]!.svg;
    expect(east).toMatch(/<rect [^>]*data-fixture="vanity:mirror"/);
  });
  it("names the tile it set out, and whether it is the design's or assumed", () => {
    expect(wallTileFrom("Large-format beige travertine porcelain, 600 × 1200, tight grout")).toEqual({ w_mm: 600, h_mm: 1200, source: "design" });
    expect(sheets[1]!.svg).toContain("(assumed —");
  });
});
