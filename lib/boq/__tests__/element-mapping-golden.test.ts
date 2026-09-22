import { describe, expect, it } from "vitest";

import { applyElementMapping } from "../element-map";
import { roomRollup } from "../elements";
import { mudonEngineBoq, mudonTakeoff } from "./p4.fixture";

// =============================================================================
// GOLDEN: the P4 element-mapped BoQ (the path the viewer flag turns on).
//
// Recorded BEFORE T3b routed the six element sections (Demolition, Plaster,
// Floor / Wall Finishes, Ceilings, Painting) through the rate resolver. With no
// firm book the output must stay byte-identical — the resolver may only change
// a figure when a project's firm has a rate for it.
// =============================================================================

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "generated_at") continue;
      out[k] = strip(x);
    }
    return out;
  }
  return v;
}

describe("P4 element mapping golden", () => {
  it("mapped BoQ + room rollup, no firm book", async () => {
    const items = mudonTakeoff();
    const mapped = applyElementMapping(mudonEngineBoq(), items);
    await expect(JSON.stringify(strip({ mapped, rooms: roomRollup(items) }), null, 2)).toMatchFileSnapshot(
      "./__snapshots__/element-mapping.golden.json",
    );
  });
});
