import { describe, expect, it } from "vitest";

import { PRODUCTION_REF, isProduction, refFromUrl } from "../../scripts/_target-guard.mjs";

// The guard's whole job is to answer "which database am I about to write to?".
// Its first version answered "dev / non-production" whenever it could not parse
// the URL — so a placeholder, a typo or an empty value all read as SAFE. That is
// the one answer a guard must never give when it does not know.
describe("target guard — project ref parsing", () => {
  it("reads a normal project URL", () => {
    expect(refFromUrl("https://abcdefghijklmnop.supabase.co")).toBe("abcdefghijklmnop");
  });

  it("tolerates quotes and trailing whitespace from a .env line", () => {
    expect(refFromUrl('"https://abcdefghijklmnop.supabase.co"  ')).toBe("abcdefghijklmnop");
  });

  it("accepts hyphens, which are legal in a project ref", () => {
    expect(refFromUrl("https://my-dev-project.supabase.co")).toBe("my-dev-project");
  });

  it("returns null — never a ref — for anything it cannot parse", () => {
    // resolveTarget turns each of these into a hard refusal.
    for (const bad of [
      "https://<new-ref>.supabase.co", // the doc's placeholder, pasted verbatim
      "",
      "not a url",
      "https://example.com",
      undefined,
      null,
    ]) {
      expect(refFromUrl(bad as string), String(bad)).toBeNull();
    }
  });

  it("identifies production and nothing else as production", () => {
    expect(isProduction(`https://${PRODUCTION_REF}.supabase.co`)).toBe(true);
    expect(isProduction("https://some-dev-project.supabase.co")).toBe(false);
    // An unparseable URL is NOT production — but it is not safe either, which is
    // why resolveTarget refuses on a null ref rather than trusting this.
    expect(isProduction("https://<new-ref>.supabase.co")).toBe(false);
  });
});
