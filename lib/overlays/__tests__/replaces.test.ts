import { describe, expect, it } from "vitest";

import { buildOverlaySections } from "@/lib/overlays/boq";
import { replacedIds, withoutReplaced } from "@/lib/overlays/replaces";

const FX = [
  { id: "wc", type: "wc_point" as const, spec: null },
  { id: "bd", type: "bidet_point" as const, spec: null },
  { id: "cab", type: "storage_cabinet" as const, spec: { replaces_fixture_id: "bd", replaces: "bidet_point" } },
];

describe("B7 3 — replaced fixtures leave the design", () => {
  it("the cabinet names the bidet; the bidet is the one replaced", () => {
    expect([...replacedIds(FX)]).toEqual(["bd"]);
    expect(withoutReplaced(FX).map((f) => f.id)).toEqual(["wc", "cab"]);
  });
  it("no bidet point line once it is replaced, and the cabinet has none of its own", () => {
    const lines = buildOverlaySections(withoutReplaced(FX)).flatMap((s) => s.lines).map((l) => l.rule_id);
    expect(lines).toEqual(["P2/overlay/wc_point"]);
  });
  it("a reference to a fixture that is gone, or to itself, replaces nothing", () => {
    expect(replacedIds([{ id: "a", spec: { replaces_fixture_id: "zzz" } }, { id: "b", spec: { replaces_fixture_id: "b" } }]).size).toBe(0);
  });
});
