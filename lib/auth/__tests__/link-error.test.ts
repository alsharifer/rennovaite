import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { signInPath } from "../access";
import { AUTH_ERROR_CODES, SIGNED_IN_HOME, authErrorMessage, codeLandingRedirect, linkErrorRedirect, postSignInPath, supabaseLinkError } from "../link-error";

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

/** Source without its comments: a comment may name what the code must not use. */
const code = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");

describe("a signed-in visitor is never asked to sign in again", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  it("/auth sends a signed-in caller on, to `next` or the portal", () => {
    expect(read("app/auth/page.tsx")).toMatch(/if \(await getPageCaller\(\)\) redirect\(postSignInPath\(next\)\)/);
  });

  it("the proxy forwards both kinds of fallen-back link before anything else", () => {
    const src = read("proxy.ts");
    expect(src).toMatch(/linkErrorRedirect\(request\.nextUrl\) \?\? codeLandingRedirect\(request\.nextUrl\)/);
    expect(src.indexOf("codeLandingRedirect(request.nextUrl)")).toBeLessThan(src.indexOf("createServerClient(url, anonKey"));
  });

  it("one post-sign-in rule for the callback, /auth, `/` and /rennovaite", () => {
    expect(SIGNED_IN_HOME).toBe("/project");
    expect(postSignInPath()).toBe(SIGNED_IN_HOME);
    expect(postSignInPath(null)).toBe(SIGNED_IN_HOME);
    expect(postSignInPath("/project/abc/boq?x=1")).toBe("/project/abc/boq?x=1");
    for (const bad of ["//evil.example", "https://evil.example", "project"]) expect(postSignInPath(bad), bad).toBe(SIGNED_IN_HOME);
    expect(read("app/auth/callback/route.ts")).toMatch(/const dest = postSignInPath\(wanted\);/);
    expect(read("lib/auth/front-door.ts")).toMatch(/postSignInPath\(\)/);
    // No second rule: nothing else compares against SIGNED_IN_HOME.
    for (const f of ["app/auth/callback/route.ts", "app/auth/page.tsx", "app/page.tsx", "app/rennovaite/page.tsx", "lib/auth/front-door.ts"]) {
      expect(code(read(f)), f).not.toMatch(/SIGNED_IN_HOME/);
    }
  });
});

// Front door (13 Oct): no public landing while the pilot is invite-only.
describe("the sign-in page is the front door", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  it("`/` and /rennovaite only redirect — no landing is routed", () => {
    for (const f of ["app/page.tsx", "app/rennovaite/page.tsx"]) {
      const src = code(read(f));
      expect(src, f).toMatch(/return frontDoorRedirect\(\);/);
      expect(src, f).toMatch(/export const dynamic = "force-dynamic"/);
      expect(src, f).not.toMatch(/HomeLanding|PropertyOsLanding|PROPERTY_OS_LANDING|WatchDemo/);
    }
    // Parked, not deleted.
    for (const f of ["app/_components/property-os-landing.tsx", "components/marketing/home-landing.tsx", "app/_components/watch-demo.tsx"]) {
      expect(read(f).length, f).toBeGreaterThan(0);
    }
  });

  it("signed out → /auth, signed in → postSignInPath(), and never a permanent redirect", () => {
    const src = code(read("lib/auth/front-door.ts"));
    expect(src).toMatch(/redirect\(\(await getPageCaller\(\)\) \? postSignInPath\(\) : FRONT_DOOR\)/);
    expect(src).toMatch(/export const FRONT_DOOR = "\/auth";/);
    expect(src).not.toMatch(/permanentRedirect|RedirectType|308|301/);
  });

  it("cannot loop: /auth renders signed out, and signed in it never sends anyone back to `/`", () => {
    expect(postSignInPath()).not.toBe("/");
    expect(postSignInPath()).not.toBe("/rennovaite");
    expect(postSignInPath()).not.toBe("/auth");
    const auth = read("app/auth/page.tsx");
    expect(auth).not.toMatch(/redirect\("\/"\)|redirect\("\/rennovaite"\)/);
    // The proxy turns a signed-out page visit to /auth, never to `/`.
    expect(signInPath("/project")).toMatch(/^\/auth/);
    expect(signInPath("/")).toBe("/auth");
  });

  it("nothing public links into a redirect: the legal chrome points at /auth", () => {
    for (const f of ["components/marketing/TopNav.tsx", "components/marketing/Footer.tsx", "components/legal/LegalPage.tsx", "components/legal/LegalPlaceholders.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/href[=:]\s*["']\/(rennovaite[^"']*)?["']/);
      expect(src, f).not.toMatch(/href[=:]\s*["']\/project/);
    }
  });

  it("/auth and the legal pages are noindex and say RenovAIte", () => {
    const auth = read("app/auth/page.tsx");
    expect(auth).toMatch(/title: "Sign in · RenovAIte"/);
    expect(auth).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(auth).not.toMatch(/Property OS/);
    expect(read("components/legal/LegalPage.tsx")).toMatch(/robots: LEGAL_ROBOTS,/);
    expect(read("components/legal/LegalPlaceholders.tsx").match(/robots: LEGAL_ROBOTS,/g)?.length).toBe(2);
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
