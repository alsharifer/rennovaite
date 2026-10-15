// =============================================================================
// Mudon alignment — the acceptance test for the reading's x/y alignment (15 Oct).
//
// The fixture is the Mudon Al Naseem first-floor sheet's OWN data (its printed
// room tags with their positions and "WxD" sizes, the plan region, the 1:100
// scale off the text layer) plus ONE raw model reading of the cropped region,
// captured read-only on 15 Oct before reconcile renamed anything.
//
// What that reading shows (scripts output in the 15 Oct report): the model's
// top edge is grid A, but its left edge starts in the bubble / dimension strip
// 2.8 m left of grid 19, and its y is stretched ~1.57× from the top — the
// bottom lands 6.7 m past grid N. One x/y scale + offset fits the 13 tags with
// R² 0.985 (x) / 0.919 (y).
//
// The two `it.fails` below are the acceptance criteria. They FAIL today (which
// `it.fails` records as a pass) and must be flipped to `it` by the fix — at
// which point `postModel` calls the alignment step before reconcile.
// Terrace accuracy waits for the alignment (ruled 15 Oct): terraces and
// balconies print no size, so only their tag is checked.
// =============================================================================

import { describe, expect, it } from "vitest";

import fixture from "../__fixtures__/mudon-sheet-reading.json";
import { reconcileWithSheet } from "../reconcile";
import { pointToRegionNorm } from "../sheet/region";
import type { Region, SheetRoomLabel, SheetScale } from "../sheet/types";
import type { RawParsedRoom } from "../providers/types";
import { polygonArea } from "../../plan/polygon";

type Pt = [number, number];
const region = fixture.region as Region;
const labels = fixture.labels as SheetRoomLabel[];
const scale = fixture.scale as SheetScale;
const vision = (fixture.vision_rooms as unknown as RawParsedRoom[]).map((r) => ({ ...r, area_source: "estimated" as const }));

/** Everything the parse does AFTER the model, today: reconcile with the sheet's labels. */
function postModel(rooms: RawParsedRoom[]): RawParsedRoom[] {
  return reconcileWithSheet(rooms, labels, region, scale).rooms;
}

/** m² on the SHEET (region size × the printed 1:100 scale) — not the plan's area-derived factor. */
const sheetM2 = (poly: Pt[]) =>
  polygonArea(poly) * (region[2] - region[0]) * (region[3] - region[1]) * scale.mm_per_pt! * scale.mm_per_pt! / 1e6;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const inside = (a: Pt, p: Pt[]) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!, [xj, yj] = p[j]!;
    if (yi > a[1] !== yj > a[1] && a[0] < ((xj - xi) * (a[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** Per printed label: is its tag inside a room carrying its name, and that room's size on the sheet. */
function audit(rooms: RawParsedRoom[]) {
  return labels.map((l) => {
    const tag = pointToRegionNorm(l.anchor_pt, region);
    const named = rooms.filter((r) => norm(r.name_en) === norm(l.name ?? l.tag));
    const own = named.find((r) => inside(tag, r.polygon)) ?? null;
    const m2 = own ? sheetM2(own.polygon) : null;
    return { tag: l.tag, name: l.name, tagInside: own !== null, printed_m2: l.area_m2, m2, off: m2 !== null && l.area_m2 ? m2 / l.area_m2 - 1 : null };
  });
}

describe("Mudon sheet: the reading against the sheet's own data", () => {
  it("the fixture is the sheet: 13 tags, 8 printed sizes, 1:100 off the text layer", () => {
    expect(labels).toHaveLength(13);
    expect(labels.filter((l) => l.area_m2 !== null)).toHaveLength(8);
    expect(scale).toMatchObject({ scale: "1:100", source: "text-layer" });
    const byName = Object.fromEntries(labels.filter((l) => l.dim_mm).map((l) => [`${l.tag} ${l.name}`, l.dim_mm]));
    expect(byName["F02 MASTER BEDROOM"]).toEqual([3985, 5000]);
    expect(byName["F03 DRESS"]).toEqual([2585, 1800]);
    expect(byName["F10 BEDROOM-4"]).toEqual([4000, 4800]);
  });

  it("today: 3 of 13 tags inside their own room, 0 of 8 printed sizes within 10% (the failure the fix must clear)", () => {
    const a = audit(postModel(vision));
    expect(a.filter((r) => r.tagInside).map((r) => r.tag)).toEqual(["F02", "F07", "F13"]);
    expect(a.filter((r) => r.off !== null && Math.abs(r.off) <= 0.1)).toHaveLength(0);
  });

  // ACCEPTANCE — flip to `it` with the fix.
  it.fails("every printed room tag falls inside its own room's outline", () => {
    for (const r of audit(postModel(vision))) expect(r.tagInside, `${r.tag} ${r.name}`).toBe(true);
  });

  // ACCEPTANCE — flip to `it` with the fix (e.g. Master Bedroom 3985×5000, Dress 2585×1800, Bedroom-4 4000×4800).
  it.fails("every room the sheet sizes is within 10% of its printed size", () => {
    for (const r of audit(postModel(vision)).filter((x) => x.printed_m2 !== null)) {
      expect(r.off, `${r.tag} ${r.name}: outline ${r.m2?.toFixed(1)} m² vs printed ${r.printed_m2}`).not.toBeNull();
      expect(Math.abs(r.off!), `${r.tag} ${r.name}: outline ${r.m2?.toFixed(1)} m² vs printed ${r.printed_m2}`).toBeLessThanOrEqual(0.1);
    }
  });
});
