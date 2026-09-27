import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// =============================================================================
// U2 — the rate-book pages never fetch another firm's data.
//
// Static half: every fetch() in the page components targets /api/firms (the
// caller's firms), /api/firms/${firmId}/… (this book) or /api/rate-vocabulary,
// and the firm id in those URLs is the one the page was opened for — no other
// id variable is interpolated into a URL. The live half is
// scripts/firm-book-page-check.mjs, which records every request a signed-in
// member's browser makes and asserts the same.
// =============================================================================

const ROOT = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("the firm book editor", () => {
  const src = read("app/firms/[firmId]/_components/firm-book-editor.tsx");
  const urls = [...src.matchAll(/fetch\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g)].map((m) => m[1]!.slice(1, -1));

  it("makes requests", () => {
    expect(urls.length).toBeGreaterThan(3);
  });

  it("only to this firm's routes and the vocabulary", () => {
    for (const u of urls) {
      expect(u, u).toMatch(/^\/api\/firms\/\$\{firmId\}(\/rates(\/\$\{e\.id\})?)?$|^\/api\/rate-vocabulary$/);
    }
  });

  it("firmId is the page's, taken from the firm it was opened with", () => {
    expect(src).toMatch(/const firmId = initialFirm\.id;/);
    // No URL is built from anything but firmId and an entry's own id.
    for (const u of urls) expect(u.match(/\$\{[^}]+\}/g) ?? []).toEqual(expect.arrayContaining([]));
    const vars = urls.flatMap((u) => u.match(/\$\{([^}]+)\}/g) ?? []);
    expect(new Set(vars)).toEqual(new Set(["${firmId}", "${e.id}"].filter((v) => vars.includes(v))));
  });
});

describe("the firm list", () => {
  const src = read("app/firms/_components/firm-list.tsx");
  it("only calls /api/firms (which answers with the caller's firms)", () => {
    const urls = [...src.matchAll(/fetch\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g)].map((m) => m[1]!.slice(1, -1));
    expect(urls).toEqual(["/api/firms"]);
  });
});

describe("the server pages read through the store with the caller", () => {
  it("the book page uses getCaller + getFirmSummary/listEntries and renders a 403 card, never the book", () => {
    const src = read("app/firms/[firmId]/page.tsx");
    expect(src).toMatch(/await getCaller\(\)/);
    expect(src).toMatch(/getFirmSummary\(db, firmId, caller\)/);
    expect(src).toMatch(/listEntries\(db, firmId, caller\)/);
    expect(src).toMatch(/e\.status === 403/);
    expect(src).not.toMatch(/from\("firm_rate_entries"\)/);
  });
  it("the firms page lists the caller's firms only", () => {
    const src = read("app/firms/page.tsx");
    expect(src).toMatch(/listFirms\([\s\S]*?,\s*caller\)/);
    expect(src).not.toMatch(/from\("firms"\)/);
  });
});
