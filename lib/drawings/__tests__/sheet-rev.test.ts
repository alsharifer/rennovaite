import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderSheet, sheetRev } from "../sheet";

// K9 (K8 review): a drawing sheet's REV is the BoQ revision the set was
// generated from — never "—".
describe("sheet REV", () => {
  it("is the BoQ revision number (rev N = the N-th BoQ); before the first BoQ it is 0", () => {
    expect(sheetRev(46)).toBe("46");
    expect(sheetRev(1)).toBe("1");
    expect(sheetRev(0)).toBe("0");
    expect(sheetRev(-3)).toBe("0");
  });

  it("the title block prints it, and nothing prints a dash in its place", () => {
    const svg = renderSheet({
      meta: { projectNameEn: "P", community: "Dubai", level: "ground", scale: "1:100", dateISO: "2026-10-13", rev: sheetRev(7) },
      sheetNumber: "A-101",
      title: "As-Built Plan",
      body: "",
    });
    expect(svg).toMatch(/>REV</);
    expect(svg).toMatch(/>7</);
    const src = readFileSync(path.resolve(__dirname, "../sheet.ts"), "utf8");
    expect(src).not.toMatch(/meta\.rev[^;\n]*"—"/);
  });

  it("the drawing set takes it from the project's BoQ revisions", () => {
    const src = readFileSync(path.resolve(__dirname, "../export.ts"), "utf8");
    expect(src).toMatch(/from\("boqs"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("project_id", projectId\)/);
    expect(src).toMatch(/rev: sheetRev\(project\.boqRevisions\)/);
  });
});
