import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AUTH_ERROR_CODES, SIGNED_IN_HOME, authErrorMessage, codeLandingRedirect, linkErrorRedirect, supabaseLinkError } from "../link-error";

// =============================================================================
// A magic link Supabase could not verify — the landing it redirects to, and the
// sign-in page's words for it.
// =============================================================================

// The URL a user actually landed on (12 Oct): Site URL root, query + fragment.
const LANDED =
  "http://localhost:3000/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired#error=access_denied";

describe("supabaseLinkError", () => {
  it("reads an expired link", () => {
    expect(supabaseLinkError(new URL(LANDED).searchParams)).toBe("link_expired");
  });

  it("reads any other Supabase failure as invalid", () => {
    expect(supabaseLinkError(new URLSearchParams("error=access_denied&error_code=bad_jwt"))).toBe("link_invalid");
    expect(supabaseLinkError(new URLSearchParams("error=server_error&error_description=Unable+to+exchange"))).toBe("link_invalid");
  });

  it("ignores an ordinary URL and a bare `error` (our own /auth codes)", () => {
    expect(supabaseLinkError(new URLSearchParams(""))).toBeNull();
    expect(supabaseLinkError(new URLSearchParams("next=/project"))).toBeNull();
    expect(supabaseLinkError(new URLSearchParams("error=exchange_failed"))).toBeNull();
  });
});

describe("linkErrorRedirect", () => {
  it("sends a failed-link landing to the sign-in page, wherever it landed", () => {
    expect(linkErrorRedirect(new URL(LANDED))).toBe("/auth?error=link_expired");
    expect(linkErrorRedirect(new URL("https://rennovaite.vercel.app/auth/callback?error=access_denied&error_code=otp_expired"))).toBe("/auth?error=link_expired");
    expect(linkErrorRedirect(new URL("https://rennovaite.vercel.app/project?error_code=x"))).toBe("/auth?error=link_invalid");
  });

  it("never loops on /auth and leaves ordinary URLs alone", () => {
    expect(linkErrorRedirect(new URL("https://rennovaite.vercel.app/auth?error_code=otp_expired"))).toBeNull();
    expect(linkErrorRedirect(new URL("https://rennovaite.vercel.app/?utm_source=x"))).toBeNull();
    // An API call is answered, never redirected — /api/health is a PUBLIC route, not "api", to the proxy.
    expect(linkErrorRedirect(new URL("https://rennovaite.vercel.app/api/health?error_code=otp_expired"))).toBeNull();
    expect(linkErrorRedirect(new URL("https://rennovaite.vercel.app/api/projects/x?error_description=y"))).toBeNull();
  });
});

describe("codeLandingRedirect — a good link that fell back to the Site URL", () => {
  const CODE = "3f6c1a52-9b1e-4d1c-8a63-2b4f0e9d7c11";

  it("forwards the code to the callback, wherever it landed", () => {
    expect(codeLandingRedirect(new URL(`https://rennovaite.vercel.app/?code=${CODE}`))).toBe(`/auth/callback?code=${CODE}`);
    expect(codeLandingRedirect(new URL(`https://rennovaite.vercel.app/project?code=${CODE}&x=1`))).toBe(`/auth/callback?code=${CODE}`);
  });

  it("leaves the callback, API calls, failed links and odd codes alone", () => {
    expect(codeLandingRedirect(new URL(`https://rennovaite.vercel.app/auth/callback?code=${CODE}`))).toBeNull();
    expect(codeLandingRedirect(new URL(`https://rennovaite.vercel.app/api/health?code=${CODE}`))).toBeNull();
    expect(codeLandingRedirect(new URL(`https://rennovaite.vercel.app/?code=${CODE}&error_code=otp_expired`))).toBeNull();
    expect(codeLandingRedirect(new URL("https://rennovaite.vercel.app/?code=x"))).toBeNull();
    expect(codeLandingRedirect(new URL("https://rennovaite.vercel.app/?code=%3Cscript%3Ealert(1)%3C%2Fscript%3E"))).toBeNull();
    expect(codeLandingRedirect(new URL("https://rennovaite.vercel.app/"))).toBeNull();
  });
});

describe("a signed-in visitor is never asked to sign in again", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  it("`/` sends a signed-in caller to the portal, whatever the landing flag", () => {
    const src = read("app/page.tsx");
    const redirectAt = src.indexOf("if (await getPageCaller()) redirect(SIGNED_IN_HOME)");
    expect(redirectAt).toBeGreaterThan(0);
    // Before either landing renders.
    expect(redirectAt).toBeLessThan(src.indexOf("<HomeLanding />"));
    expect(redirectAt).toBeLessThan(src.indexOf("<PropertyOsLanding />"));
  });

  it("/auth sends a signed-in caller on, to `next` or the portal", () => {
    expect(read("app/auth/page.tsx")).toMatch(/if \(await getPageCaller\(\)\) redirect\(safeNextPath\(next\) \? next : SIGNED_IN_HOME\)/);
  });

  it("the proxy forwards both kinds of fallen-back link before anything else", () => {
    const src = read("proxy.ts");
    expect(src).toMatch(/linkErrorRedirect\(request\.nextUrl\) \?\? codeLandingRedirect\(request\.nextUrl\)/);
    expect(src.indexOf("codeLandingRedirect(request.nextUrl)")).toBeLessThan(src.indexOf("createServerClient(url, anonKey"));
  });

  it("one portal destination for the callback, `/` and /auth", () => {
    expect(SIGNED_IN_HOME).toBe("/project");
    expect(read("app/auth/callback/route.ts")).toMatch(/: SIGNED_IN_HOME;/);
  });
});

describe("authErrorMessage", () => {
  it("has words for every code the app issues", () => {
    for (const c of AUTH_ERROR_CODES) expect(authErrorMessage(c), c).toMatch(/\S/);
    expect(authErrorMessage("link_expired")).toMatch(/expired/);
  });

  it("says nothing for an unknown or missing code", () => {
    expect(authErrorMessage(undefined)).toBeNull();
    expect(authErrorMessage("<script>")).toBeNull();
  });

  it("covers every code the callback route can send", () => {
    const src = readFileSync(path.join(process.cwd(), "app/auth/callback/route.ts"), "utf8");
    const issued = [...src.matchAll(/\/auth\?error=([a-z_]+)/g)].map((m) => m[1]!);
    expect(issued.length).toBeGreaterThan(0);
    for (const c of issued) expect(AUTH_ERROR_CODES as readonly string[]).toContain(c);
  });
});
