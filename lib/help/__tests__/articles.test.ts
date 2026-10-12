import { describe, expect, it } from "vitest";

import { FIRM_STEPS, OWNER_STEPS } from "@/lib/journey";

import { HELP_ARTICLES, articlesFor, searchArticles } from "../articles";

describe("help articles", () => {
  it("every journey step has at least one article of its own", () => {
    for (const s of [...OWNER_STEPS, ...FIRM_STEPS]) {
      expect(HELP_ARTICLES.some((a) => a.areas.includes(s.key)), s.key).toBe(true);
    }
  });
  it("a page shows its own articles first, at most five", () => {
    const list = articlesFor("timeline");
    expect(list[0]!.id).toBe("timeline-range");
    expect(list.length).toBeLessThanOrEqual(5);
  });
  it("search matches every word across all pages", () => {
    expect(searchArticles("overlap fix").map((a) => a.id)).toContain("overlaps");
    expect(searchArticles("   ")).toEqual([]);
  });
  it("makes no promise the product does not keep", () => {
    const text = HELP_ARTICLES.flatMap((a) => [a.title, ...a.body]).join(" ");
    expect(text).not.toMatch(/working day|within \d+ (hours|days)|guarantee/i);
  });
});
