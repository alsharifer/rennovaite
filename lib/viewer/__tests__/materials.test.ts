import { describe, expect, it } from "vitest";

import {
  buildFinishPlan,
  floorFinishForRoom,
  isUnscopedRoom,
  isWetRoom,
  wallFinishForRoom,
} from "../materials";

// The viewer's promise is that clay means "nobody has chosen this yet". Every
// test here defends one of the three mapping rules that keeps that true.

describe("floorFinishForRoom / wallFinishForRoom", () => {
  it("returns null for every surface when no style is locked", () => {
    for (const type of ["bedroom", "bathroom", "living", null]) {
      expect(floorFinishForRoom(null, type)).toBeNull();
      expect(wallFinishForRoom(undefined, type)).toBeNull();
    }
  });

  it("returns null for an unknown style key rather than guessing", () => {
    expect(floorFinishForRoom("not-a-style", "bedroom")).toBeNull();
    expect(wallFinishForRoom("not-a-style", "bedroom")).toBeNull();
  });

  it("keeps unscoped rooms clay even under a locked style", () => {
    for (const type of ["terrace", "balcony", "stairs", "parking"]) {
      expect(isUnscopedRoom(type)).toBe(true);
      expect(floorFinishForRoom("luxe-minimal", type)).toBeNull();
      expect(wallFinishForRoom("luxe-minimal", type)).toBeNull();
    }
  });

  it("applies the locked style to a scoped dry room", () => {
    const floor = floorFinishForRoom("modern-hijazi", "bedroom");
    const wall = wallFinishForRoom("modern-hijazi", "bedroom");
    expect(floor?.family).toBe("wood");
    expect(wall?.family).toBe("plaster");
    expect(floor?.label).toMatch(/mahogany/i);
  });

  it("tiles wet rooms whatever the style says", () => {
    // modern-hijazi floors are mahogany and walls are Tadelakt plaster. A
    // bathroom must still be tiled, because that is what the BoQ prices.
    for (const type of ["bathroom", "ensuite", "powder", "kitchen"]) {
      expect(isWetRoom(type)).toBe(true);
      expect(floorFinishForRoom("modern-hijazi", type)?.family).toBe("tile");
      expect(wallFinishForRoom("modern-hijazi", type)?.family).toBe("tile");
    }
    // ...and a dry room under the same style is NOT tiled, so the override is
    // doing the work rather than a blanket default.
    expect(wallFinishForRoom("modern-hijazi", "bedroom")?.family).not.toBe("tile");
  });

  it("labels wet surfaces as wet-area so the inspector does not claim the style finish", () => {
    expect(wallFinishForRoom("luxe-minimal", "bathroom")?.label).toMatch(/wet area/i);
  });

  it("covers every style in the library with both surfaces", async () => {
    const { STYLES } = await import("@/lib/styles");
    for (const style of STYLES) {
      expect(floorFinishForRoom(style.key, "living"), style.key).not.toBeNull();
      expect(wallFinishForRoom(style.key, "living"), style.key).not.toBeNull();
    }
  });
});

describe("buildFinishPlan", () => {
  const rooms = [
    { id: "r-bed", type: "bedroom" },
    { id: "r-bath", type: "bathroom" },
    { id: "r-terrace", type: "terrace" },
  ];

  it("maps each room and reports the ones left clay", () => {
    const plan = buildFinishPlan("luxe-minimal", rooms);
    expect(plan.floorByRoom["r-bed"]?.family).toBe("stone");
    expect(plan.wallByRoom["r-bath"]?.family).toBe("tile");
    expect(plan.floorByRoom["r-terrace"]).toBeNull();
    expect(plan.unfinishedRoomIds).toEqual(["r-terrace"]);
  });

  it("leaves every room clay when nothing is locked", () => {
    const plan = buildFinishPlan(null, rooms);
    expect(plan.unfinishedRoomIds).toHaveLength(rooms.length);
    expect(Object.values(plan.floorByRoom).every((f) => f === null)).toBe(true);
  });
});
