import { describe, expect, it } from "vitest";

import { STYLE_KEYS } from "@/lib/render-prompts";
import {
  STAGING_SETS,
  STAGING_ROOM_TYPES,
  getStagingSet,
  stagingRoomTypeFromDb,
  type FurnitureKey,
} from "../sets";
import { FURNITURE_PRICES, tierForStyle, priceFor } from "../prices";
import { buildStagingBlock } from "../prompt";
import {
  buildFurnitureSection,
  FURNITURE_SECTION_NAME,
  type OptedRoom,
} from "../furniture-boq";

describe("staging sets — vocabulary completeness", () => {
  it("covers all 6 styles × 6 room types", () => {
    for (const style of STYLE_KEYS) {
      for (const room of STAGING_ROOM_TYPES) {
        expect(getStagingSet(style, room), `${style}/${room}`).not.toBeNull();
      }
    }
  });

  it("keeps every set to 4–6 items", () => {
    for (const style of STYLE_KEYS) {
      for (const room of STAGING_ROOM_TYPES) {
        const set = getStagingSet(style, room)!;
        expect(set.length, `${style}/${room}`).toBeGreaterThanOrEqual(4);
        expect(set.length, `${style}/${room}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it("gives traditional majlis floor seating, contemporary majlis raised sofas", () => {
    const floorKeys = STAGING_SETS["contemporary-majlis"].majlis.map((x) => x.key);
    expect(floorKeys).toContain("majlis-floor-seating");
    const raisedKeys = STAGING_SETS["luxe-minimal"].majlis.map((x) => x.key);
    expect(raisedKeys).toContain("majlis-sofa");
  });

  it("maps db room types to staging types (and skips wet/circulation rooms)", () => {
    expect(stagingRoomTypeFromDb("living")).toBe("living");
    expect(stagingRoomTypeFromDb("master_bedroom")).toBe("master-bed");
    expect(stagingRoomTypeFromDb("bedroom")).toBe("kids-bed");
    expect(stagingRoomTypeFromDb("bathroom")).toBeNull();
    expect(stagingRoomTypeFromDb("terrace")).toBeNull();
    expect(stagingRoomTypeFromDb(null)).toBeNull();
  });
});

describe("furniture prices — every staged key is priceable", () => {
  it("has a price row for every FurnitureKey used across all sets", () => {
    const used = new Set<FurnitureKey>();
    for (const style of STYLE_KEYS) {
      for (const room of STAGING_ROOM_TYPES) {
        for (const item of getStagingSet(style, room)!) used.add(item.key);
      }
    }
    for (const key of used) {
      expect(FURNITURE_PRICES[key], key).toBeDefined();
      expect(FURNITURE_PRICES[key].premium, key).toBeGreaterThan(0);
    }
  });

  it("orders tiers value ≤ mid ≤ premium for every key", () => {
    for (const key of Object.keys(FURNITURE_PRICES) as FurnitureKey[]) {
      const p = FURNITURE_PRICES[key];
      expect(p.value, key).toBeLessThanOrEqual(p.mid);
      expect(p.mid, key).toBeLessThanOrEqual(p.premium);
    }
  });

  it("maps each style to a retail tier", () => {
    expect(tierForStyle("coastal-emirati")).toBe("value");
    expect(tierForStyle("luxe-minimal")).toBe("premium");
  });
});

describe("render prompt STAGING block", () => {
  it("lists set items and pins architecture for a real style/room", () => {
    const b = buildStagingBlock("coastal-emirati", "living");
    expect(b).not.toBeNull();
    expect(b!.block).toContain("STAGING:");
    expect(b!.block.toLowerCase()).toContain("sectional");
    // Fixed elements stay authoritative — architecture is explicitly preserved.
    expect(b!.block).toMatch(/architecture|wall positions|fixed/i);
    expect(b!.set.length).toBeGreaterThanOrEqual(4);
  });

  it("returns null when no set applies", () => {
    expect(buildStagingBlock("not-a-style", "living")).toBeNull();
  });
});

describe("Furniture (optional) BoQ section", () => {
  const mudonLiving: OptedRoom = {
    roomId: "room-living",
    roomName: "Family Area",
    styleKey: "coastal-emirati",
    set: getStagingSet("coastal-emirati", "living")!,
  };

  it("builds one section priced from the book, totals summing exactly", () => {
    const section = buildFurnitureSection([mudonLiving], FURNITURE_PRICES)!;
    expect(section.work_section).toBe(FURNITURE_SECTION_NAME);
    expect(section.lines.length).toBeGreaterThan(0);
    // Every line is indicative and out-of-contractor-scope.
    for (const l of section.lines) {
      expect(l.rate_status).toBe("indicative");
      expect(l.total_aed).toBe(l.rate_aed * l.quantity);
    }
    const sum = section.lines.reduce((s, l) => s + l.total_aed, 0);
    expect(section.section_total_aed).toBe(sum);
  });

  it("prices coastal-emirati at the value tier", () => {
    const section = buildFurnitureSection([mudonLiving], FURNITURE_PRICES)!;
    const sectionalLine = section.lines.find((l) =>
      l.description.includes("sectional"),
    )!;
    expect(sectionalLine.rate_aed).toBe(
      priceFor(FURNITURE_PRICES, "sectional", "coastal-emirati"),
    );
    expect(sectionalLine.rate_aed).toBe(FURNITURE_PRICES.sectional.value);
    expect(sectionalLine.vendor_or_source).toContain("IKEA");
  });

  it("multiplies quantity>1 items (e.g. paired accent chairs)", () => {
    const section = buildFurnitureSection([mudonLiving], FURNITURE_PRICES)!;
    // coastal living stages a pair of rattan-wrapped lounge chairs (qty 2).
    const chairs = section.lines.find((l) => l.quantity === 2)!;
    expect(chairs).toBeDefined();
    expect(chairs.description).toContain("lounge chairs");
    expect(chairs.total_aed).toBe(chairs.rate_aed * 2);
  });

  it("returns null with no opted rooms (calm/empty state)", () => {
    expect(buildFurnitureSection([], FURNITURE_PRICES)).toBeNull();
  });
});
