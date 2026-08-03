// =============================================================================
// lib/boq/takeoff.ts — deterministic quantity take-off (v0.2).
//
// Pure geometry + the F-xx formulas in rules.ts. No pricing, no LLM, no I/O.
// Every ScopeItem carries its rule ID and a human-readable derivation so the
// QS can audit each quantity back to a formula.
//
// v0.2: room model extended per the real Villa 94 scope — bathrooms tiled full
// height, external terrace (waterproof + screed + tile, no paint/elec),
// office (split AC), corridor/storage, gypsum ceilings + LED cove throughout,
// ducted AC replacement for secondary bedrooms, protection/scaffold/handover
// preliminaries, civil + staircase allowances.
// =============================================================================

import {
  AREA_PER_DOWNLIGHT_M2,
  BATHROOM_TYPES,
  BEDROOM_TYPES,
  CEILING_COVERAGE_FACTOR,
  CONSTANTS,
  COVE_LM_PER_M2,
  EXTERNAL_TYPES,
  HVAC_SERVICE_TYPES,
  PENDANTS_LIVING,
  PLASTER_MAKEGOOD_FACTOR,
  POINTS_PER_M2,
  WARDROBE_LM,
} from "./rules";
import type { EngineRoom, ScopeItem } from "./schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

type RoomGeometry = {
  room: EngineRoom;
  widthM: number;
  depthM: number;
  perimeterM: number;
  isBathroom: boolean;
  isBedroom: boolean;
  isExternal: boolean;
  doorCount: number; // structural door openings into the room
  grossWallM2: number;
  netWallM2: number; // F-01
};

/** Recover real-world width/depth from area + polygon aspect (C-05 fallback). */
function roomGeometry(room: EngineRoom): RoomGeometry {
  let aspect = CONSTANTS.DEFAULT_ROOM_ASPECT;
  const poly = room.polygon;
  if (poly && poly.length >= 3) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of poly) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const [x, y] = p as [number, number];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w > 0 && h > 0) aspect = Math.max(w, h) / Math.min(w, h);
  }

  const depthM = Math.sqrt(room.area_m2 / aspect);
  const widthM = depthM * aspect;
  const perimeterM = 2 * (widthM + depthM);

  const isBathroom = BATHROOM_TYPES.has(room.room_type);
  const isBedroom = BEDROOM_TYPES.has(room.room_type);
  const isExternal = EXTERNAL_TYPES.has(room.room_type);
  const doorCount = 1; // every room in the refit scope has exactly one door

  const grossWallM2 = perimeterM * CONSTANTS.WALL_HEIGHT_M;
  const doorM2 = doorCount * CONSTANTS.DOOR_W_M * CONSTANTS.DOOR_H_M;
  const windowM2 = isBathroom
    ? 0
    : grossWallM2 * CONSTANTS.WINDOW_DEDUCTION_PCT;
  const netWallM2 = Math.max(0, grossWallM2 - doorM2 - windowM2);

  return {
    room,
    widthM,
    depthM,
    perimeterM,
    isBathroom,
    isBedroom,
    isExternal,
    doorCount,
    grossWallM2,
    netWallM2,
  };
}

export type Takeoff = {
  items: ScopeItem[];
  summary: {
    totalAreaM2: number;
    interiorAreaM2: number;
    bedroomCount: number;
    bathroomCount: number;
    netWallM2: number;
    bathWetWallM2: number;
  };
};

export function computeTakeoff(
  rooms: EngineRoom[],
  flooring: "porcelain" | "engineered_wood",
): Takeoff {
  const geos = rooms.map(roomGeometry);
  const external = geos.filter((g) => g.isExternal);
  const interior = geos.filter((g) => !g.isExternal);
  // Stairs are NOT flat floor — handled as a developed tile surface below, so
  // exclude them from the dry-floor pool (they were previously priced as flat
  // floor, and their developed tread/riser surface was invisible).
  const stairs = interior.filter((g) => g.room.room_type === "stairs");
  const dry = interior.filter((g) => !g.isBathroom && g.room.room_type !== "stairs"); // bedrooms, living, corridor, storage, office
  const baths = interior.filter((g) => g.isBathroom);
  const beds = geos.filter((g) => g.isBedroom);
  const secondaryBeds = geos.filter((g) => g.room.room_type === "bedroom");
  const offices = geos.filter((g) => g.room.room_type === "office");
  const fcuServiceRooms = geos.filter((g) =>
    HVAC_SERVICE_TYPES.has(g.room.room_type),
  );

  const totalAreaM2 = round2(geos.reduce((s, g) => s + g.room.area_m2, 0));
  const interiorAreaM2 = round2(
    interior.reduce((s, g) => s + g.room.area_m2, 0),
  );
  const externalAreaM2 = round2(
    external.reduce((s, g) => s + g.room.area_m2, 0),
  );
  const dryFloorM2 = round2(dry.reduce((s, g) => s + g.room.area_m2, 0));
  const bathFloorM2 = round2(baths.reduce((s, g) => s + g.room.area_m2, 0));
  // P8b: staircase developed tile surface = footprint × C-08 (treads + risers).
  const stairsFootprintM2 = round2(stairs.reduce((s, g) => s + g.room.area_m2, 0));
  const stairDevelopedM2 = round2(stairsFootprintM2 * CONSTANTS.STAIR_DEVELOPED_FACTOR);
  const netWallM2 = round2(interior.reduce((s, g) => s + g.netWallM2, 0));

  // F-03: bathroom wet-wall tiling area (FULL HEIGHT per C-04, v0.2)
  const bathWetWallM2 = round2(
    baths.reduce((s, g) => {
      const gross = g.perimeterM * CONSTANTS.BATH_TILE_HEIGHT_M;
      const door = g.doorCount * CONSTANTS.DOOR_W_M * CONSTANTS.BATH_TILE_HEIGHT_M;
      return s + Math.max(0, gross - door);
    }, 0),
  );

  // F-02: paint = dry rooms (net wall + ceiling) + bathroom ceilings
  const paintM2 = round2(
    dry.reduce((s, g) => s + g.netWallM2 + g.room.area_m2, 0) + bathFloorM2,
  );

  // F-04: skirting — dry rooms + external terrace (SoW §3.5 includes terrace)
  const skirtingLm = round2(
    [...dry, ...external].reduce(
      (s, g) => s + Math.max(0, g.perimeterM - g.doorCount * CONSTANTS.DOOR_W_M),
      0,
    ),
  );

  // F-05 (interior walls only)
  const plasterM2 = round2(netWallM2 * PLASTER_MAKEGOOD_FACTOR);

  // F-06 / F-07 — interior rooms only
  const downlights = interior.reduce(
    (s, g) => s + Math.ceil(g.room.area_m2 / AREA_PER_DOWNLIGHT_M2),
    0,
  );
  const points = interior.reduce(
    (s, g) => s + Math.ceil(g.room.area_m2 * POINTS_PER_M2),
    0,
  );

  // F-08
  const wardrobeLm = round2(
    beds.reduce(
      (s, g) =>
        s +
        (g.room.room_type === "master_bedroom"
          ? WARDROBE_LM.master_bedroom
          : WARDROBE_LM.bedroom),
      0,
    ),
  );

  // F-09
  const pendants =
    beds.length +
    (geos.some((g) => g.room.room_type === "living") ? PENDANTS_LIVING : 0);

  // F-10
  const doors = beds.length + baths.length;

  // F-11
  const debrisM3 = totalAreaM2 * CONSTANTS.DEBRIS_M3_PER_M2;
  const skips = Math.ceil(debrisM3 / CONSTANTS.SKIP_CAPACITY_M3);

  // F-12 / F-13 (v0.2)
  const ceilingM2 = round2(interiorAreaM2 * CEILING_COVERAGE_FACTOR);
  const coveLm = round2(dryFloorM2 * COVE_LM_PER_M2);

  const floorLabourKey =
    flooring === "porcelain" ? "floor.porcelain_labour" : "floor.wood_labour";
  const floorMaterialKey =
    flooring === "porcelain" ? "floor.porcelain_material" : "floor.wood_material";
  const floorName =
    flooring === "porcelain" ? "Porcelain floor tiling" : "Engineered wood flooring";
  // Porcelain: everywhere incl. terrace. Wood: dry interior only; porcelain in
  // wet areas + terrace.
  const porcelainExtraM2 = round2(bathFloorM2 + externalAreaM2);
  // Stairs excluded from the main floor (porcelain path counts totalAreaM2,
  // which includes the stair footprint; wood path uses dryFloorM2, already
  // stair-free). The staircase is priced as its own developed tile surface.
  const mainFloorM2 = round2(
    (flooring === "porcelain" ? totalAreaM2 - stairsFootprintM2 : dryFloorM2),
  );

  const items: ScopeItem[] = [
    {
      rule_id: "Q-01",
      work_section: "Demolition",
      item_key: "demo.soft_strip",
      description:
        "Full soft strip — finishes, ceilings, doors, cabinets, sanitary ware (no structural)",
      quantity: totalAreaM2,
      unit: "m2",
      measurement: `total floor area incl. terrace = ${totalAreaM2} m²`,
    },
    {
      rule_id: "Q-02",
      work_section: "Demolition",
      item_key: "demo.floor_removal",
      description: "Existing floor finish removal — all areas incl. terrace",
      quantity: totalAreaM2,
      unit: "m2",
      measurement: `total floor area = ${totalAreaM2} m²`,
    },
    {
      rule_id: "Q-03",
      work_section: "Demolition",
      item_key: "demo.wall_tile_removal",
      description: "Bathroom wall tile removal — full height",
      quantity: bathWetWallM2,
      unit: "m2",
      measurement: `F-03: Σ bath (perimeter × ${CONSTANTS.BATH_TILE_HEIGHT_M} m − door) = ${bathWetWallM2} m²`,
    },
    {
      rule_id: "Q-04",
      work_section: "Plaster",
      item_key: "plaster.make_good",
      description: "Plaster make-good / skim after strip-out",
      quantity: plasterM2,
      unit: "m2",
      measurement: `F-05: interior net wall ${netWallM2} m² × ${PLASTER_MAKEGOOD_FACTOR} = ${plasterM2} m²`,
    },
    {
      rule_id: "Q-05",
      work_section: "Blockwork",
      item_key: "civil.alterations",
      description:
        "Civil alterations — opening closures/openings, new partitions, storage room",
      quantity: 1,
      unit: "project",
      measurement: "allowance pending design layout (R-35)",
    },
    {
      rule_id: "Q-06",
      work_section: "Floor Finishes",
      item_key: "floor.screed_wet",
      description: "Floor screed 50mm incl. falls — wet areas + terrace",
      quantity: round2(bathFloorM2 + externalAreaM2),
      unit: "m2",
      measurement: `bath floors ${bathFloorM2} + terrace ${externalAreaM2} m²`,
    },
    {
      rule_id: "Q-07",
      work_section: "Floor Finishes",
      item_key: "terrace.waterproof",
      description: "Waterproofing membrane — terrace",
      quantity: externalAreaM2,
      unit: "m2",
      measurement: `terrace area = ${externalAreaM2} m²`,
    },
    {
      rule_id: "Q-08",
      work_section: "Floor Finishes",
      item_key: floorLabourKey,
      description: `${floorName} — labour`,
      quantity: mainFloorM2,
      unit: "m2",
      measurement:
        flooring === "porcelain"
          ? `total floor area = ${totalAreaM2} m² (porcelain throughout incl. wet areas + terrace)`
          : `dry interior floor = ${dryFloorM2} m² (wood in dry rooms only)`,
    },
    {
      rule_id: "Q-09",
      work_section: "Floor Finishes",
      item_key: floorMaterialKey,
      description: `${floorName} — material supply`,
      quantity: mainFloorM2,
      unit: "m2",
      measurement: "net laid area; wastage added at pricing per W-01/W-02",
    },
    ...(flooring === "engineered_wood"
      ? [
          {
            rule_id: "Q-09b",
            work_section: "Floor Finishes" as const,
            item_key: "floor.porcelain_labour",
            description: "Porcelain floor tiling — wet areas + terrace, labour",
            quantity: porcelainExtraM2,
            unit: "m2",
            measurement: `bath floors ${bathFloorM2} + terrace ${externalAreaM2} m²`,
          },
          {
            rule_id: "Q-09c",
            work_section: "Floor Finishes" as const,
            item_key: "floor.porcelain_material",
            description:
              "Porcelain floor tile — wet areas + terrace, material supply",
            quantity: porcelainExtraM2,
            unit: "m2",
            measurement: "net laid area; wastage per W-01",
          },
        ]
      : []),
    {
      rule_id: "Q-10",
      work_section: "Floor Finishes",
      item_key: "floor.skirting",
      description: "Skirting — tile-matched, dry rooms + terrace",
      quantity: skirtingLm,
      unit: "lm",
      measurement: `F-04: Σ (dry + terrace) perimeter − door widths = ${skirtingLm} lm`,
    },
    {
      rule_id: "Q-11",
      work_section: "Floor Finishes",
      item_key: "stairs.renovation",
      description: "Staircase renovation — tread tiling + LED nosing (excl. handrail)",
      quantity: 1,
      unit: "project",
      measurement: "allowance (R-36); treads TBC from stair drawing",
    },
    // P8b: staircase tile SUPPLY — developed tread/riser surface, 144×305 slab
    // format. Was invisible (stair footprint priced as flat floor). Only when a
    // stairs room exists.
    ...(stairsFootprintM2 > 0
      ? [
          {
            rule_id: "Q-11b",
            work_section: "Floor Finishes" as const,
            item_key: "floor.stair_tile",
            description: "Staircase tile — developed tread/riser surface (144×305 slab)",
            quantity: stairDevelopedM2,
            unit: "m2",
            measurement: `F-16: stair footprint ${stairsFootprintM2} m² × ${CONSTANTS.STAIR_DEVELOPED_FACTOR} (C-08) = ${stairDevelopedM2} m²`,
          },
        ]
      : []),
    {
      rule_id: "Q-12",
      work_section: "Wall Finishes",
      item_key: "wall.bath_tiling_labour",
      description: "Bathroom wall tiling — full height, labour",
      quantity: bathWetWallM2,
      unit: "m2",
      measurement: `F-03 (as Q-03) = ${bathWetWallM2} m²`,
    },
    {
      rule_id: "Q-13",
      work_section: "Wall Finishes",
      item_key: "wall.bath_tiling_material",
      description: "Bathroom wall tile — material supply",
      quantity: bathWetWallM2,
      unit: "m2",
      measurement: "net tiled area; wastage per W-03",
    },
    {
      rule_id: "Q-14",
      work_section: "Ceilings",
      item_key: "ceiling.gypsum",
      description:
        "Gypsum false ceiling incl. plastering + painting — all interior rooms",
      quantity: ceilingM2,
      unit: "m2",
      measurement: `F-12: interior area ${interiorAreaM2} m² × ${CEILING_COVERAGE_FACTOR} = ${ceilingM2} m²`,
    },
    {
      rule_id: "Q-15",
      work_section: "Ceilings",
      item_key: "ceiling.led_cove",
      description: "Continuous LED cove channel within gypsum ceiling",
      quantity: coveLm,
      unit: "lm",
      measurement: `F-13: dry interior area ${dryFloorM2} m² × ${COVE_LM_PER_M2} = ${coveLm} lm`,
    },
    {
      rule_id: "Q-16",
      work_section: "Decoration & Painting",
      item_key: "paint.full",
      description: "Internal painting — walls + ceilings, 2 coats",
      quantity: paintM2,
      unit: "m2",
      measurement: `F-02: dry (net wall + ceiling) + bath ceilings = ${paintM2} m²`,
    },
    {
      rule_id: "Q-17",
      work_section: "Electrical",
      item_key: "elec.downlight",
      description: "LED downlights — supply and install (interior)",
      quantity: downlights,
      unit: "no",
      measurement: `F-06: Σ interior ceil(area / ${AREA_PER_DOWNLIGHT_M2}) = ${downlights}`,
    },
    {
      rule_id: "Q-18",
      work_section: "Electrical",
      item_key: "elec.point",
      description: "Power sockets and switches — supply and install (interior)",
      quantity: points,
      unit: "no",
      measurement: `F-07: Σ interior ceil(area × ${POINTS_PER_M2}) = ${points}`,
    },
    {
      rule_id: "Q-19",
      work_section: "Plumbing",
      item_key: "plumb.bath_rewire",
      description: "Bathroom plumbing re-pipe (full PPR) — per bathroom",
      quantity: baths.length,
      unit: "no",
      measurement: `bathroom count = ${baths.length}`,
    },
    {
      rule_id: "Q-20",
      work_section: "Plumbing",
      item_key: "plumb.water_heater",
      description: "Concealed water heater — supply and install",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per bathroom × ${baths.length} (Villa 94 retained existing heaters — QS to confirm inclusion)`,
    },
    {
      rule_id: "Q-21",
      work_section: "Plumbing",
      item_key: "plumb.floor_drain",
      description: "Floor / linear shower drain — install",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per bathroom × ${baths.length}`,
    },
    {
      rule_id: "Q-22",
      work_section: "Sanitaryware",
      item_key: "san.wc",
      description: "Wall-hung WC incl. concealed cistern — install",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per bathroom × ${baths.length}`,
    },
    {
      rule_id: "Q-23",
      work_section: "Sanitaryware",
      item_key: "san.basin",
      description: "Vanity basin with mixer — install",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per bathroom × ${baths.length}`,
    },
    {
      rule_id: "Q-24",
      work_section: "Sanitaryware",
      item_key: "san.shower",
      description: "Shower system with concealed thermostatic valve — install",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per bathroom × ${baths.length}`,
    },
    // P8b: sanitary accessory set — one per wet room, priced from the Laspinas
    // lines. (Was missing entirely; only WC/basin/shower were modelled.)
    {
      rule_id: "Q-24a",
      work_section: "Sanitaryware",
      item_key: "san.shattaf",
      description: "Shattaf (health faucet), matt black — supply",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per wet room × ${baths.length} (Laspinas)`,
    },
    {
      rule_id: "Q-24b",
      work_section: "Sanitaryware",
      item_key: "san.paper_holder",
      description: "Paper holder, matt black — supply",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per wet room × ${baths.length} (Laspinas)`,
    },
    {
      rule_id: "Q-24c",
      work_section: "Sanitaryware",
      item_key: "san.towel_rail",
      description: "Towel rail, matt black — supply",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per wet room × ${baths.length} (Laspinas)`,
    },
    {
      rule_id: "Q-24d",
      work_section: "Sanitaryware",
      item_key: "san.actuator",
      description: "WC actuator plate, vertical square — supply",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per wet room × ${baths.length} (Laspinas)`,
    },
    {
      rule_id: "Q-25",
      work_section: "MEP / HVAC",
      item_key: "hvac.ducted_replace",
      description:
        "New ducted AC unit incl. ductwork, grilles, thermostat — secondary bedrooms",
      quantity: secondaryBeds.length,
      unit: "no",
      measurement: `F-15: 1 per secondary bedroom × ${secondaryBeds.length}`,
    },
    {
      rule_id: "Q-26",
      work_section: "MEP / HVAC",
      item_key: "hvac.office_split",
      description: "Split AC unit (2 ton) — office, incl. commissioning",
      quantity: offices.length,
      unit: "no",
      measurement: `F-16: 1 per office × ${offices.length}`,
    },
    {
      rule_id: "Q-27",
      work_section: "MEP / HVAC",
      item_key: "hvac.fcu_service",
      description: "FCU deep service and clean — retained units",
      quantity: fcuServiceRooms.length,
      unit: "no",
      measurement: `rooms retaining existing FCU = ${fcuServiceRooms.length}`,
    },
    {
      rule_id: "Q-28",
      work_section: "Joinery & Carpentry",
      item_key: "join.wardrobe",
      description: "Built-in wardrobes — bedrooms",
      quantity: wardrobeLm,
      unit: "lm",
      measurement: `F-08: master ${WARDROBE_LM.master_bedroom} lm + secondary ${WARDROBE_LM.bedroom} lm each = ${wardrobeLm} lm`,
    },
    {
      rule_id: "Q-29",
      work_section: "Joinery & Carpentry",
      item_key: "join.vanity",
      description: "Bathroom vanity with quartz top",
      quantity: baths.length,
      unit: "no",
      measurement: `1 per bathroom × ${baths.length}`,
    },
    {
      rule_id: "Q-30",
      work_section: "Joinery & Carpentry",
      item_key: "join.door",
      description: "Internal doors — supply and hang",
      quantity: doors,
      unit: "no",
      measurement: `F-10: bedrooms ${beds.length} + bathrooms ${baths.length} = ${doors}`,
    },
    {
      rule_id: "Q-31",
      work_section: "Lighting",
      item_key: "light.pendant",
      description: "Decorative pendants — installation",
      quantity: pendants,
      unit: "no",
      measurement: `F-09: 1 per bedroom (${beds.length}) + ${PENDANTS_LIVING} living = ${pendants}`,
    },
    {
      rule_id: "Q-32",
      work_section: "Preliminaries",
      item_key: "prelim.site_setup",
      description: "Site setup, hoarding, protection, daily clean",
      quantity: 1,
      unit: "project",
      measurement: "lump sum per project",
    },
    {
      rule_id: "Q-33",
      work_section: "Preliminaries",
      item_key: "prelim.permits",
      description: "DM / DEWA permits and fees",
      quantity: 1,
      unit: "project",
      measurement: "lump sum per project",
    },
    {
      rule_id: "Q-34",
      work_section: "Preliminaries",
      item_key: "prelim.skips",
      description: "Skip hire and waste disposal",
      quantity: skips,
      unit: "no",
      measurement: `F-11: ceil(${totalAreaM2} × ${CONSTANTS.DEBRIS_M3_PER_M2} ÷ ${CONSTANTS.SKIP_CAPACITY_M3}) = ${skips} skips`,
    },
    {
      rule_id: "Q-35",
      work_section: "Preliminaries",
      item_key: "prelim.floor_protection",
      description: "Protective floor covering over new tiling until handover",
      quantity: totalAreaM2,
      unit: "m2",
      measurement: `F-14: total floor area = ${totalAreaM2} m²`,
    },
    {
      rule_id: "Q-36",
      work_section: "Preliminaries",
      item_key: "prelim.scaffold",
      description: "Rolling scaffold hire — ceiling + painting works",
      quantity: 1,
      unit: "project",
      measurement: "lump sum per project",
    },
    {
      rule_id: "Q-37",
      work_section: "Preliminaries",
      item_key: "prelim.handover_clean",
      description: "Final clearance + professional handover clean",
      quantity: 1,
      unit: "project",
      measurement: "lump sum per project",
    },
  ].filter((i) => i.quantity > 0) as ScopeItem[];

  return {
    items,
    summary: {
      totalAreaM2,
      interiorAreaM2,
      bedroomCount: beds.length,
      bathroomCount: baths.length,
      netWallM2,
      bathWetWallM2,
    },
  };
}
