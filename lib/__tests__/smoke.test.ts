import { describe, expect, it } from "vitest";

// Smoke test — proves the Vitest runner + tsconfig path alias resolve. Real
// coverage lives alongside each module (e.g. lib/drawings/__tests__).
describe("vitest smoke", () => {
  it("runs arithmetic", () => {
    expect(1 + 1).toBe(2);
  });
});
