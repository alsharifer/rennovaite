import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GARDEN_STYLES,
  gardenStyleFor,
  interiorStyleFor,
  isGardenStyleKey,
} from "@/lib/garden-styles";
import {
  RENDERABLE_DB_ROOM_TYPES,
  buildEditPrompt,
  buildOffplanBasePrompt,
  isExteriorRoomType,
  roomTypeFromDb,
} from "@/lib/render-prompts";
import { OUTDOOR_ROOM_TYPES } from "@/lib/plan/zones";
import { STYLES } from "@/lib/styles";

describe("exterior room classification (G1b)", () => {
  it("renders every outdoor zone type instead of refusing it", () => {
    // The whole point: before G1b these were a bare 400 with a sentence about
    // the first-floor scope, so a garden could not be rendered at all.
    for (const t of OUTDOOR_ROOM_TYPES) {
      const mapped = roomTypeFromDb(t);
      expect(mapped, `room_type ${t}`).not.toBeNull();
      expect(isExteriorRoomType(mapped)).toBe(true);
    }
    expect(roomTypeFromDb("structure")).toBe("outdoor-structure");
    expect(roomTypeFromDb("artificial_grass")).toBe("garden-zone");
  });

  it("stops refusing terraces and balconies", () => {
    expect(roomTypeFromDb("terrace")).toBe("garden-zone");
    expect(roomTypeFromDb("balcony")).toBe("garden-zone");
  });

  it("leaves the four interior mappings exactly as they were", () => {
    expect(roomTypeFromDb("master_bedroom")).toBe("master-bedroom");
    expect(roomTypeFromDb("bedroom")).toBe("secondary-bedroom");
    expect(roomTypeFromDb("bathroom")).toBe("bathroom");
    expect(roomTypeFromDb("ensuite")).toBe("bathroom");
    expect(roomTypeFromDb("powder")).toBe("bathroom");
    expect(roomTypeFromDb("living")).toBe("living");
    expect(roomTypeFromDb("majlis")).toBe("living");
    expect(roomTypeFromDb("dining")).toBe("living");
    for (const t of ["master-bedroom", "secondary-bedroom", "bathroom", "living"]) {
      expect(isExteriorRoomType(t)).toBe(false);
    }
  });

  it("still declines what genuinely has nothing to photograph, and says what does", () => {
    // A refusal is fine; a bare 400 with no way forward is not. The route turns
    // this null into a 422 naming the type and listing what IS renderable.
    expect(roomTypeFromDb("stairs")).toBeNull();
    expect(roomTypeFromDb("closet")).toBeNull();
    expect(roomTypeFromDb(null)).toBeNull();
    expect(RENDERABLE_DB_ROOM_TYPES).toContain("paving");
    expect(RENDERABLE_DB_ROOM_TYPES).toContain("living");
    expect(RENDERABLE_DB_ROOM_TYPES).not.toContain("stairs");
  });
});

describe("exterior prompts", () => {
  it("asks the model to keep the site, not a room's walls and ceiling", () => {
    const p = buildEditPrompt({ styleKey: "desert-modern", roomType: "garden-zone" });
    expect(p).toContain("Desert Modern");
    expect(p).toContain("boundary wall positions");
    expect(p).toContain("landscape photography");
    // An outdoor scene has no ceiling and no back wall to preserve.
    expect(p).not.toContain("window and door locations");
    expect(p).not.toContain("interior photography");
  });

  it("synthesises a flat ground plane for an off-plan garden, not a room shell", () => {
    const p = buildOffplanBasePrompt({ roomType: "garden-zone", widthM: 12, depthM: 8 });
    expect(p).toContain("flat level ground");
    expect(p).toContain("boundary wall");
    expect(p).toContain("12.0m wide by 8.0m deep");
    expect(p).toContain("open sky");
    // The interior shell's giveaways must be absent — a ceiling and primed
    // walls are exactly what the edit model kept when a garden was built on a
    // room shell.
    expect(p).not.toContain("ceiling 2.9m");
    expect(p).not.toContain("white primed walls");
  });

  it("gives a structure a base slab rather than bare sand", () => {
    const p = buildOffplanBasePrompt({ roomType: "outdoor-structure", widthM: 4, depthM: 3 });
    expect(p).toContain("base slab");
    expect(p).not.toContain("compacted sand");
  });

  it("leaves the interior prompts byte-identical", () => {
    // Pinned verbatim: these strings are the render cache key, so a change here
    // silently invalidates every cached interior render.
    expect(buildOffplanBasePrompt({ roomType: "living", widthM: 5, depthM: 6 })).toBe(
      "Empty unfurnished living room, 5.0m wide by 6.0m deep, ceiling 2.9m, a single window on one side wall, screed floor, white primed walls, photorealistic, eye-level 24mm.",
    );
    expect(
      buildEditPrompt({ styleKey: "luxe-minimal", roomType: "master-bedroom" }),
    ).toBe(
      "Renovate this exact bedroom in Luxe Minimal style: honed calacatta stone surfaces, smoked oak veneer cabinetry, brushed champagne brass, integrated concealed lighting, soft graphite tonal palette, Palette anchors: #F5F2ED, #4A3F35, #C9A66B, #2A2826. Keep the room's architecture, wall positions, window and door locations, and camera angle exactly the same. Photorealistic interior photography, magazine quality.",
    );
  });
});

describe("style pairing", () => {
  it("keeps the six interior directions out of the garden set and vice versa", () => {
    expect(GARDEN_STYLES).toHaveLength(2);
    for (const s of STYLES) expect(isGardenStyleKey(s.key)).toBe(false);
    for (const g of GARDEN_STYLES) expect(STYLES.some((s) => s.key === g.key)).toBe(false);
  });

  it("gives every interior direction an exterior companion", () => {
    for (const s of STYLES) {
      const g = gardenStyleFor(s.key);
      expect(isGardenStyleKey(g), `companion for ${s.key}`).toBe(true);
    }
    expect(gardenStyleFor("andalusian-heritage")).toBe("courtyard-majlis");
    expect(gardenStyleFor("luxe-minimal")).toBe("desert-modern");
    // A garden direction is already exterior — it is not remapped.
    expect(gardenStyleFor("desert-modern")).toBe("desert-modern");
    // Unknown falls to the quieter of the two rather than throwing.
    expect(gardenStyleFor("not-a-style")).toBe("desert-modern");
  });

  it("maps back for an interior room on a garden-led project", () => {
    expect(interiorStyleFor("courtyard-majlis")).toBe("modern-hijazi");
    expect(interiorStyleFor("desert-modern")).toBe("luxe-minimal");
    // An interior key passes straight through, so the render route can call it
    // unconditionally.
    expect(interiorStyleFor("coastal-emirati")).toBe("coastal-emirati");
    expect(interiorStyleFor(null)).toBeNull();
  });
});

describe("exterior moodboard art", () => {
  it("ships all four boards at the same path and naming as the interior 24", () => {
    for (const style of GARDEN_STYLES) {
      for (const rel of style.reference_images) {
        expect(rel.startsWith("/moodboards/")).toBe(true);
        const file = join(process.cwd(), "public", rel.replace(/^\//, ""));
        expect(existsSync(file), rel).toBe(true);
      }
    }
  });
});
