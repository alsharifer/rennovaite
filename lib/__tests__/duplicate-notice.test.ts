import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Notices } from "@/components/blueprint/boq/Notices";

// K10 #10 — the BoQ's duplicate-component notice: the owner reads "N items may
// be counted twice — we'll confirm before tender" (no mechanism, no QS ruling);
// the firm's copy is unchanged.
const duplicates = [
  { label: "Bathroom mirror", detail: "priced by R-31 and by the accessory selection" },
  { label: "Vanity counter slab", detail: "in the joinery lump and the R-44 line" },
];
const model = (persona: "owner" | "firm", d = duplicates) =>
  ({ persona, projectId: "p1", notices: { draft: null, reference: null, duplicates: d, garden: null } }) as never;
const html = (persona: "owner" | "firm", d = duplicates) => renderToStaticMarkup(createElement(Notices, { model: model(persona, d), permits: null }));

describe("duplicate-component notice", () => {
  it("owner: N items may be counted twice — we'll confirm before tender; item names only", () => {
    const out = html("owner");
    expect(out).toContain("2 items may be counted twice");
    expect(out).toContain("We’ll confirm before tender");
    expect(out).toContain("Bathroom mirror");
    expect(out).not.toMatch(/R-31|R-44|mechanism|QS scope ruling|priced twice/);
    expect(html("owner", duplicates.slice(0, 1))).toContain("1 item may be counted twice");
  });

  it("firm: unchanged — components priced twice, the mechanism and the QS ruling", () => {
    const out = html("firm");
    expect(out).toContain("2 components priced twice");
    expect(out).toContain("Charged by two mechanisms — nothing removed automatically; which line survives is a QS scope ruling.");
    expect(out).toContain("priced by R-31 and by the accessory selection");
    expect(out).not.toContain("may be counted twice");
  });

  it("no finding, no notice", () => {
    expect(html("owner", [])).not.toContain("counted twice");
  });
});
