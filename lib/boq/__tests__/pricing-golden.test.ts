import { describe, expect, it } from "vitest";

import { generateDeterministicBoq } from "../engine";
import { appendJoineryAluminumSections } from "../joinery-aluminum";
import { buildGardenSections } from "../garden-boq-feed";
import { MUDON_FIRST_FLOOR } from "../fixtures/mudon-first-floor";
import { VILLA94_GARDEN } from "../../ground-truth/villa94-garden-plan";
import { LABOUR_RATES_FIXTURE } from "./labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "./pricing-skus.fixture";
import { referenceGardenBook } from "./reference-books";

// =============================================================================
// GOLDEN: the priced BoQ must not move when the rate plumbing moves.
//
// Captured on master @ 64b07ff, BEFORE T1.0 moved garden rates into the database
// and before L1 added firm overlays. Mudon at four tiers (the three styles that
// map to value / mid / premium, plus no style) through the engine + the
// ground-truth Joinery / Aluminum sections, and Villa 94's traced garden
// through the landscape take-off.
//
// `engine.generated_at` is a timestamp and is dropped. `rate_tier` is the one
// field L1 ADDS to every resolved line; it is stripped here so this file proves
// the numbers and every pre-existing field are byte-identical, and the tier
// labels are asserted separately (lib/rates/__tests__). Nothing else may be
// stripped: if a figure moves, this test fails, and the snapshot is only ever
// re-recorded by a change whose whole point is to move a price.
// =============================================================================

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "generated_at" || k === "rate_tier") continue;
      out[k] = strip(x);
    }
    return out;
  }
  return v;
}

const MUDON_ROOMS = MUDON_FIRST_FLOOR.map((r) => ({ ...r, name_en: r.name }));

function mudon(styleKey: string | null) {
  const { boq } = generateDeterministicBoq({
    rooms: MUDON_FIRST_FLOOR,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    labourRates: LABOUR_RATES_FIXTURE as any,
    skus: PRICING_SKUS_FIXTURE,
    styleKey,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return appendJoineryAluminumSections(boq, MUDON_ROOMS as any);
}

describe("pricing golden — nothing moves when the rate plumbing moves", () => {
  it("Mudon interior BoQ at every tier", async () => {
    const out = {
      value: strip(mudon("scandi-arabic")),
      mid: strip(mudon("contemporary-majlis")),
      premium: strip(mudon("luxe-minimal")),
      none: strip(mudon(null)),
    };
    await expect(JSON.stringify(out, null, 2)).toMatchFileSnapshot("./__snapshots__/mudon-boq.golden.json");
  });

  it("Villa 94 garden sections at the reference book", async () => {
    const built = buildGardenSections(VILLA94_GARDEN, referenceGardenBook());
    await expect(
      JSON.stringify(strip({ sections: built.sections, total_aed: built.total_aed }), null, 2),
    ).toMatchFileSnapshot("./__snapshots__/villa94-garden.golden.json");
  });
});
