import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// K10 #7 — the Specification's options: three EQUAL cells down to 1100 px,
// then one column (never two-up with the third option alone on a row).
// Measured live by scripts/k10-spec-grid-shots.mjs (1440 / 1280 / 1100 / 1099 / 390).
const src = readFileSync(path.resolve(__dirname, "../../components/blueprint/spec/Specification.tsx"), "utf8");

describe("Specification option grid", () => {
  it("is one column, then three equal cells from 1100 px", () => {
    const ul = /<ul className="([^"]*)" data-spec-options>/.exec(src)?.[1] ?? "";
    expect(ul.split(" ").sort()).toEqual(["gap-3", "grid", "grid-cols-1", "min-[1100px]:grid-cols-3", "mt-3"].sort());
    expect(ul).not.toMatch(/grid-cols-2/);
  });
  it("cells fill their track (equal height and width)", () => {
    expect(src).toMatch(/className=\{`relative flex h-full w-full flex-col/);
  });
});
