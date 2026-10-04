import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PUBLIC_API_PATHS,
  PUBLIC_PAGE_PATHS,
  PUBLIC_ROUTE_FILES,
  routeKind,
  safeNextPath,
  signInPath,
  unauthenticated,
  unauthenticatedBody,
} from "../access";

// =============================================================================
// H1 — the allowlist the proxy enforces, and the proxy's own wiring.
// The per-handler checks are scanned in lib/firms/__tests__/route-auth.test.ts.
// =============================================================================

const ROOT = path.resolve(__dirname, "../../..");
const proxySrc = readFileSync(path.join(ROOT, "proxy.ts"), "utf8");

describe("routeKind", () => {
  it("every API path needs a caller except the public ones", () => {
    expect(routeKind("/api/health")).toBe("public");
    expect(routeKind("/api/health/")).toBe("public");
    for (const p of ["/api/render", "/api/projects/6b5fda9d-0000-0000-0000-000000000000/boq-pdf", "/api/firms", "/api/health/extra", "/api", "/api/debug/feedback-summary"]) {
      expect(routeKind(p), p).toBe("api");
    }
  });

  it("pages need a caller except the landing, sign-in and legal pages", () => {
    for (const p of ["/", "/rennovaite", "/auth", "/auth/", "/auth/callback", "/privacy", "/terms"]) expect(routeKind(p), p).toBe("public");
    for (const p of ["/project", "/project/new", "/project/abc/boq", "/dashboard", "/firms", "/auth/other", "/rennovaite/x", "/privacy-policy"]) {
      expect(routeKind(p), p).toBe("page");
    }
  });

  it("the public API paths are exactly the public API route files", () => {
    const fromFiles = Object.keys(PUBLIC_ROUTE_FILES)
      .filter((f) => f.startsWith("app/api/"))
      .map((f) => "/" + f.replace(/^app\//, "").replace(/\/route\.ts$/, ""));
    expect([...PUBLIC_API_PATHS].sort()).toEqual(fromFiles.sort());
    // The callback is a route handler outside /api: public as a PAGE path.
    expect(PUBLIC_PAGE_PATHS).toContain("/auth/callback");
  });
});

describe("safeNextPath / signInPath", () => {
  it("accepts same-site paths only", () => {
    for (const ok of ["/project", "/project/abc/boq?x=1", "/firms/1#top"]) expect(safeNextPath(ok), ok).toBe(true);
    for (const bad of [null, undefined, "", "project", "//evil.example", "/\\evil.example", "https://evil.example", "/x\ny", "/" + "a".repeat(2001)]) {
      expect(safeNextPath(bad as string | null | undefined), String(bad)).toBe(false);
    }
  });

  it("sends a signed-out page visit to /auth with where it was going", () => {
    expect(signInPath("/project/abc/boq", "?tab=2")).toBe(`/auth?next=${encodeURIComponent("/project/abc/boq?tab=2")}`);
    expect(signInPath("/")).toBe("/auth");
    expect(signInPath("//evil.example")).toBe("/auth");
  });
});

describe("the 401", () => {
  it("is one shape everywhere", async () => {
    const res = unauthenticated();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in required.", code: "unauthenticated" });
    expect(unauthenticatedBody("Sign in to read approvals.")).toEqual({ error: "Sign in to read approvals.", code: "unauthenticated" });
  });
});

describe("proxy.ts", () => {
  it("is the Next 16 proxy convention, reading the shared allowlist", () => {
    expect(proxySrc).toMatch(/export async function proxy\(request: NextRequest\)/);
    expect(proxySrc).toMatch(/from "@\/lib\/auth\/access"/);
    expect(proxySrc).toMatch(/routeKind\(request\.nextUrl\.pathname\)/);
    // No second allowlist hiding in the proxy.
    expect(proxySrc).not.toMatch(/"\/api\/health"/);
  });

  it("verifies both credentials the routes accept, and fails closed", () => {
    expect(proxySrc).toMatch(/getClaims\(bearer\)/);
    expect(proxySrc).toMatch(/getClaims\(\)/);
    expect(proxySrc).toMatch(/is_anonymous !== true/);
    expect(proxySrc).toMatch(/if \(!url \|\| !anonKey\) return kind === "public" \? NextResponse\.next\(\) : deny\(request, kind\)/);
  });

  // The matcher is compiled by Next (path-to-regexp); its page pattern is a
  // plain regex group, so it can be checked as one.
  const matchers = [...proxySrc.matchAll(/^\s*"(\/[^"]+)",?\s*$/gm)].map((m) => m[1]!);

  it("covers every API path and every page, and skips only static files", () => {
    expect(matchers).toContain("/api/:path*");
    const page = matchers.find((m) => m.startsWith("/(("));
    expect(page).toBeDefined();
    const re = new RegExp(`^${page!.replace(/\\\\/g, "\\")}$`);
    for (const p of ["/", "/project", "/project/abc/boq", "/dashboard", "/auth", "/firms/x/quotes/y"]) expect(re.test(p), p).toBe(true);
    for (const p of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/moodboards/modern-living.png", "/__nextjs_original-stack-frames"]) {
      expect(re.test(p), p).toBe(false);
    }
    // API paths are the other matcher's — including one whose segment has a dot.
    expect(re.test("/api/projects/a.b/boq-pdf")).toBe(false);
  });
});
