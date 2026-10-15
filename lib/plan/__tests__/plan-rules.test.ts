// The plan editor's guardrails (15 Oct): one test per rule, plus the two Jumeirah
// Parks cases — the window drawn across its wall and the door left on a garden edge.

import { describe, expect, it } from "vitest";

import fixture from "../__fixtures__/jumeirah-parks-plan-15oct.json";
import { deriveWallSegments } from "../geometry";
import { abbreviations, fitRoomLabel, labelInside } from "../label-fit";
import { reanchorOpenings } from "../opening-anchor";
import { planRuleIssues } from "../plan-issues";
import {
  checkPlan,
  hardProblemFor,
  metresPerUnit,
  ON_WALL_TOL_M,
  openingsOnWalls,
  placeOpening,
  snapVertexSquare,
  wallAt,
  type RuleOpening,
  type RuleRoom,
  type Violation,
} from "../plan-rules";
import type { Pt } from "../polygon";
import { labelLanguageMismatch } from "../room-names";

// Synthetic plans are drawn in metres (1 unit = 1 m).
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const room = (id: string, poly: Pt[], extra: Partial<RuleRoom> = {}): RuleRoom => ({ id, name_en: id[0]!.toUpperCase() + id.slice(1), room_type: "bedroom", polygon: poly, ...extra });
const op = (id: string, kind: string, x: number, y: number, w = 900, extra: Partial<RuleOpening> = {}): RuleOpening => ({ id, kind, width_mm: w, height_mm: kind === "window" ? 1200 : 2100, sill_mm: kind === "window" ? 900 : 0, position: [x, y], ...extra });
const rules = (vs: Violation[], id?: string) => vs.filter((v) => !id || v.opening_id === id || v.room_id === id).map((v) => v.rule);

// Two 4 × 4 rooms side by side (a party wall at x = 4) with a hall below; a door between them.
const bed = room("bed", rect(0, 0, 4, 4));
const study = room("study", rect(4, 0, 4, 4));
const hall = room("hall", rect(0, 4, 8, 2), { room_type: "foyer" });
const base = [bed, study, hall];
const doors = [op("d-bed", "door", 2, 4), op("d-study", "door", 6, 4)];

describe("plan rules — hard", () => {
  it("1 · an opening sits on a wall; one in the middle of a room needs a wall (and leaves the BoQ and renders)", () => {
    const floating = op("float", "door", 2, 2);
    const r = checkPlan({ rooms: base, openings: [...doors, floating], mPerU: 1 });
    expect(rules(r.violations, "float")).toEqual(["on_wall"]);
    expect(r.needsWall.has("float")).toBe(true);
    expect(openingsOnWalls([...doors, floating], base, 1).map((o) => o.id)).toEqual(["d-bed", "d-study"]);
    expect(hardProblemFor(floating, doors, base, 1)?.rule).toBe("on_wall");
    // On the wall (within 0.15 m) is fine.
    expect(placeOpening(op("near", "door", 2, 4 + ON_WALL_TOL_M * 0.9), base, 1)).not.toBeNull();
  });

  it("2 · a wall shorter than the opening: Needs a wall", () => {
    const wide = op("wide", "archway", 4, 2, 5000); // a 5 m archway on the 4 m party wall
    const r = checkPlan({ rooms: base, openings: [...doors, wide], mPerU: 1 });
    expect(rules(r.violations, "wide")).toContain("wall_short");
    expect(r.needsWall.has("wide")).toBe(true);
  });

  it("3 · fit: 0.1 m clear at each end, no overlap on one wall, heights under the ceiling", () => {
    expect(hardProblemFor(op("end", "door", 0.4, 4), doors, base, 1)?.rule).toBe("fit"); // 0.9 m door centred 0.4 m from the corner
    expect(hardProblemFor(op("ok", "door", 0.6, 4), [], base, 1)).toBeNull();
    expect(hardProblemFor(op("lap", "door", 2.5, 4), doors, base, 1)?.rule).toBe("overlap");
    expect(hardProblemFor(op("tall", "door", 2, 4, 900, { height_mm: 3100 }), [], base, 1)?.rule).toBe("height");
    expect(hardProblemFor(op("win", "window", 2, 0, 1200, { sill_mm: 1900, height_mm: 1200 }), [], base, 1)?.rule).toBe("height");
    const r = checkPlan({ rooms: base, openings: [...doors, op("lap", "door", 2.5, 4)], mPerU: 1 });
    expect(r.violations.some((v) => v.rule === "overlap")).toBe(true);
  });

  it("4 · an archway joins two rooms; an outside door or window has nothing (or a terrace / garden) beyond", () => {
    expect(hardProblemFor(op("arch-out", "archway", 2, 0, 1500), [], base, 1)?.rule).toBe("archway_shared");
    expect(hardProblemFor(op("arch-in", "archway", 4, 2, 1500), [], base, 1)).toBeNull();
    const outsideDoor = op("ext", "door", 4, 2, 900, { detection: { opens_to: "outside" } });
    expect(hardProblemFor(outsideDoor, [], base, 1)?.rule).toBe("exterior_wall");
    const terrace = room("terrace", rect(0, -2, 4, 2), { room_type: "terrace" });
    expect(hardProblemFor(op("ext2", "door", 2, 0, 900, { detection: { opens_to: "outside" } }), [], [...base, terrace], 1)).toBeNull();
    // An archway onto a terrace is between two rooms; onto a lawn it is not.
    expect(hardProblemFor(op("arch-t", "archway", 2, 0, 1500), [], [...base, terrace], 1)).toBeNull();
    const lawn = room("lawn", rect(0, -2, 4, 2), { room_type: "artificial_grass", unroofed: true });
    expect(hardProblemFor(op("arch-g", "archway", 2, 0, 1500), [], [...base, lawn], 1)?.rule).toBe("archway_shared");
  });
});

describe("plan rules — soft (listed, can be kept)", () => {
  it("5 · an archway, or no door, into a wet room", () => {
    const bath = room("bath", rect(8, 0, 2, 4), { room_type: "bathroom", name_en: "Bath" });
    const withArch = checkPlan({ rooms: [...base, bath], openings: [...doors, op("a", "archway", 8, 2, 1000)], mPerU: 1 });
    expect(withArch.violations.find((v) => v.room_id === "bath")?.message).toBe("Archway into Bath — bathrooms normally have a door.");
    const none = checkPlan({ rooms: [...base, bath], openings: doors, mPerU: 1 });
    expect(none.violations.find((v) => v.room_id === "bath")?.message).toBe("No door into Bath — bathrooms normally have a door.");
    const ok = checkPlan({ rooms: [...base, bath], openings: [...doors, op("d", "door", 8, 2, 800)], mPerU: 1 });
    expect(ok.violations.some((v) => v.rule === "wet_room_door")).toBe(false);
  });

  it("6 · a window on an interior wall", () => {
    const r = checkPlan({ rooms: base, openings: [...doors, op("w", "window", 4, 2, 1000)], mPerU: 1 });
    expect(r.violations.find((v) => v.opening_id === "w")?.message).toBe("Window between Bed and Study — is this right?");
  });

  it("7 · a room with no door or archway", () => {
    const r = checkPlan({ rooms: base, openings: [doors[0]!], mPerU: 1 });
    expect(r.violations.filter((v) => v.rule === "no_way_in").map((v) => v.message)).toEqual(["No way into Study."]);
  });

  it("8 · unusual sizes: inside door outside 0.7–1.2 m, window over 80% of its wall, archway under 0.9 m", () => {
    const r = checkPlan({ rooms: base, openings: [op("narrow", "door", 2, 4, 600), op("d-study", "door", 6, 4), op("big", "window", 2, 0, 3500), op("slim", "archway", 4, 2, 800)], mPerU: 1 });
    expect(rules(r.violations, "narrow")).toContain("size");
    expect(rules(r.violations, "big")).toContain("size");
    expect(rules(r.violations, "slim")).toContain("size");
  });

  it("9 · edges snap to 90° within 5° in the editor; edges further off are flagged", () => {
    expect(snapVertexSquare([0, 0], [4, 0.2], [4, 4])).toEqual([4, 0]); // 2.9° → square
    expect(snapVertexSquare([0, 0], [4, 1], [4, 4])).toEqual([4, 1]); // 14° → left as drawn
    const skew = room("skew", [[0, 0], [4, 0.6], [4, 4], [0, 4]]); // one edge 8.5° off
    const r = checkPlan({ rooms: [skew], openings: [], mPerU: 1 });
    expect(r.violations.find((v) => v.rule === "skew")?.message).toMatch(/1 edge is off square \(up to 8\.5°\)/);
  });

  it("10 · an in-scope room still called \"New room\" blocks regenerate; out of scope it does not", () => {
    const r = checkPlan({ rooms: [room("x", rect(0, 0, 3, 3), { name_en: "New room" })], openings: [], mPerU: 1 });
    expect(r.violations.find((v) => v.rule === "unnamed")?.severity).toBe("blocks");
    const out = checkPlan({ rooms: [room("x", rect(0, 0, 3, 3), { name_en: "New room", in_scope: false })], openings: [], mPerU: 1 });
    expect(out.violations.some((v) => v.rule === "unnamed")).toBe(false);
  });

  it("11 · renaming one language flags the other (the Hall still reading غرفة الطعام)", () => {
    expect(labelLanguageMismatch("Hall", "غرفة الطعام")).toBe('"dining room"');
    expect(labelLanguageMismatch("Dining Room", "غرفة الطعام")).toBeNull();
    expect(labelLanguageMismatch("Family Room", "غرفة المعيشة")).toBeNull(); // near enough
    expect(labelLanguageMismatch("Gym", "غرفة الطعام")).toBeNull(); // unknown English: never guessed
    const r = checkPlan({ rooms: [room("hall", rect(0, 0, 3, 3), { name_en: "Hall", name_ar: "غرفة الطعام" })], openings: [], mPerU: 1 });
    expect(r.violations.find((v) => v.rule === "label_lang")?.message).toContain("update it");
  });

  it("12 · labels stay inside small outlines: shrink, abbreviate, then drop lines", () => {
    expect(abbreviations("Powder Room / WD")).toEqual(["Powder Room", "Pwdr Rm"]);
    const tiny = fitRoomLabel({ name: "Powder Room / WD", nameAr: "دورة مياه", longMeta: "1.85 × 2.33 m · 6 m²", area: "6 m²", widthPx: 70, heightPx: 90 });
    expect(labelInside(tiny, 70, 90)).toBe(true);
    expect(tiny.shortened).toBe(true);
    const roomy = fitRoomLabel({ name: "Living Room", nameAr: "غرفة المعيشة", longMeta: "6.20 × 6.05 m · 38 m²", area: "38 m²", widthPx: 260, heightPx: 220 });
    expect(roomy.lines.map((l) => l.text)).toEqual(["Living Room", "غرفة المعيشة", "6.20 × 6.05 m · 38 m²"]);
  });

  it("a kept soft rule is not an issue; hard rules cannot be kept", () => {
    const keptRooms = base.map((r) => (r.id === "study" ? { ...r, spec: { kept_rules: ["no_way_in"] } } : r));
    const r = checkPlan({ rooms: keptRooms, openings: [doors[0]!], mPerU: 1 });
    expect(r.violations.find((v) => v.rule === "no_way_in")?.kept).toBe(true);
    expect(planRuleIssues(r.violations).count).toBe(0);
    const hard = checkPlan({ rooms: base, openings: [...doors, op("float", "door", 2, 2, 900, { spec: { kept_rules: ["on_wall"] } })], mPerU: 1 });
    expect(hard.violations.find((v) => v.rule === "on_wall")?.kept).toBeUndefined();
    expect(planRuleIssues(hard.violations).groups.map((g) => g.key)).toEqual(["plan_hard"]);
  });
});

describe("rule 2 — openings move with their wall", () => {
  it("a wall dragged out carries its door at the same fraction along it", () => {
    const before = [bed, study, hall];
    const after = [room("bed", [[0, 0], [4, 0], [4, 5], [0, 5]]), study, room("hall", rect(0, 5, 8, 1))];
    const moves = reanchorOpenings(before, after, [op("d-bed", "door", 2, 4, 900, { room_id: "bed" })], 1);
    expect(moves).toEqual([{ id: "d-bed", position: [2, 5], t: 0.5, reason: "wall_moved" }]);
  });

  it("a save that re-fits the whole plan carries every opening with it", () => {
    const k = 2, dx = 10, dy = 5;
    const scaled = base.map((r) => ({ ...r, polygon: (r.polygon as Pt[]).map(([x, y]) => [x * k + dx, y * k + dy] as Pt) }));
    const moves = reanchorOpenings(base, scaled, doors.map((d) => ({ ...d, room_id: d.id === "d-bed" ? "bed" : "study" })), 1);
    expect(moves.map((m) => m.position)).toEqual([[14, 13], [22, 13]]);
  });

  it("a deleted room's opening is left off every wall: Needs a wall", () => {
    const moves = reanchorOpenings(base, [study, hall], [op("w", "window", 0, 2, 1000, { room_id: "bed" })], 1);
    expect(moves).toEqual([]); // nothing moved it…
    const r = checkPlan({ rooms: [study, hall], openings: [op("w", "window", 0, 2, 1000)], mPerU: 1 });
    expect(r.needsWall.has("w")).toBe(true); // …and nothing holds it up
  });
});

describe("Jumeirah Parks (prod, 15 Oct)", () => {
  const rooms = fixture.rooms as RuleRoom[];
  const openings = fixture.openings as (RuleOpening & { wall_ref: string })[];
  const mPerU = metresPerUnit(rooms, fixture.total_area_m2)!;
  const walls = deriveWallSegments(rooms);
  const angle = (w: { a: Pt; b: Pt }) => Math.abs((Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]) * 180) / Math.PI) % 180;
  const between = (p: number, q: number) => Math.min(Math.abs(p - q), 180 - Math.abs(p - q));

  it("the window drawn across its wall: its stored wall_ref names a perpendicular wall 2.3 m away; it is drawn on the wall it sits on", () => {
    const win = openings.find((o) => o.id.startsWith("dedba9b8"))!;
    const stale = walls.find((w) => w.id === win.wall_ref)!;
    const drawn = wallAt(walls, win.position as Pt, ON_WALL_TOL_M / mPerU)!;
    const host = placeOpening(win, rooms, mPerU)!;
    expect(between(angle(stale), angle(host))).toBeGreaterThan(80); // the old editor drew it across
    expect(between(angle(drawn), angle(host))).toBeLessThan(1); // now: along its own wall
    // Every opening on a wall is drawn along it (the garden-edge door is on none — next test).
    for (const o of openings.filter((x) => !x.id.startsWith("7df86cda"))) {
      const w = wallAt(walls, o.position as Pt, ON_WALL_TOL_M / mPerU);
      const pl = placeOpening(o, rooms, mPerU);
      expect(w, o.id).not.toBeNull();
      expect(between(angle(w!), angle({ a: pl!.a, b: pl!.b })), o.id).toBeLessThan(5); // along it (across would be ~90°)
    }
  });

  it("the door left on the garden edge (the old powder-room door): not a wall — Needs a wall, drawn as such", () => {
    const door = openings.find((o) => o.id.startsWith("7df86cda"))!;
    const r = checkPlan({ rooms, openings, mPerU });
    expect(r.placements.get(door.id)!.sides.map((id) => rooms.find((x) => x.id === id)?.name_en ?? null)).toEqual(["Grass", null]);
    expect(rules(r.violations, door.id)).toEqual(["on_wall"]);
    expect(r.needsWall.has(door.id)).toBe(true);
    expect(wallAt(walls, door.position as Pt, ON_WALL_TOL_M / mPerU)).toBeNull(); // the editor agrees: no wall there
    expect(hardProblemFor(door, [], rooms, mPerU)?.rule).toBe("exterior_wall"); // and refuses a drop there
  });

  it("the audit: what the rules list on the plan as left", () => {
    const r = checkPlan({ rooms, openings, mPerU });
    // Every opening but the garden-edge door is on its wall — the drawing was wrong, not the data.
    expect([...r.needsWall].map((id) => id.slice(0, 8))).toEqual(["7df86cda"]);
    expect(r.violations.filter((v) => v.rule === "unnamed")).toHaveLength(2);
    expect(r.violations.find((v) => v.rule === "label_lang")?.room_id).toBe(rooms.find((x) => x.name_en === "Hall")!.id);
    const skewed = r.violations.filter((v) => v.rule === "skew").map((v) => rooms.find((x) => x.id === v.room_id)!.name_en);
    expect(skewed).toEqual(expect.arrayContaining(["Entrance Foyer", "Kitchen", "Powder Room / WD"]));
  });

  it("rule 12 on its small rooms: Maid Room, Bath and Stairs keep their labels inside", () => {
    for (const name of ["Maid Room", "Bath", "Stairs", "Powder Room / WD"]) {
      const poly = rooms.find((x) => x.name_en === name)!.polygon as Pt[];
      const w = Math.max(...poly.map((p) => p[0])) - Math.min(...poly.map((p) => p[0]));
      const h = Math.max(...poly.map((p) => p[1])) - Math.min(...poly.map((p) => p[1]));
      const fit = fitRoomLabel({ name, nameAr: rooms.find((x) => x.name_en === name)!.name_ar, longMeta: "0.00 × 0.00 m · 0 m²", area: "9 m²", widthPx: w, heightPx: h });
      expect(labelInside(fit, w, h), name).toBe(true);
    }
  });
});

describe("rule 12 on the read-only layers", () => {
  it("a one-line name: full when it fits, shorter when not, nothing when nothing fits", async () => {
    const { fitNameLabel, textWidthPx } = await import("../label-fit");
    expect(fitNameLabel("Living Room", 200, 100)).toEqual({ text: "Living Room", fontPx: 12 });
    const pw = fitNameLabel("Powder Room / WD", 75, 40)!;
    expect(pw.text).not.toBe("Powder Room / WD");
    expect(textWidthPx(pw.text, pw.fontPx, "en")).toBeLessThanOrEqual(75 - 12);
    expect(fitNameLabel("Stairs", 8, 8)).toBeNull();
  });
});
