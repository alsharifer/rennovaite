// =============================================================================
// lib/auth/access.ts — who may reach what without signing in (H1).
//
// ONE allowlist, read by both enforcement layers: `proxy.ts` (every request,
// before the route) and the route-auth scan test (every handler must check the
// caller unless its file is listed here). Everything not listed needs a
// signed-in caller — an API route answers 401, a page redirects to /auth.
//
// Pure: no Next or Supabase imports, so the proxy, the routes and the test can
// all load it.
// =============================================================================

/**
 * Route handler files that answer an anonymous caller, each with the reason.
 * The scan test holds this list equal to the handlers that skip the caller
 * check, so a public route cannot appear without being named here.
 */
export const PUBLIC_ROUTE_FILES: Readonly<Record<string, string>> = {
  // The magic link lands here before any session exists — its whole job is to create one.
  "app/auth/callback/route.ts": "auth callback: exchanges the magic-link code for the session",
  // Liveness for uptime checks. Anonymous callers get presence booleans only;
  // the key fingerprints are for a signed-in caller.
  "app/api/health/route.ts": "health: liveness + env presence, fingerprints only when signed in",
};

/**
 * Server actions (`"use server"` files) a signed-out visitor may call. Every
 * other exported action resolves `getCaller()` first — the proxy sees only a
 * POST to the page, not which action it carries.
 */
export const PUBLIC_SERVER_ACTION_FILES: Readonly<Record<string, string>> = {
  "app/_actions/sign-in-with-email.ts": "sign-in: how a visitor gets a session",
  "app/_actions/sign-out.ts": "sign-out: clearing a session needs none",
};

/**
 * H5: signed-in route files that are NOT project-scoped, each with the reason.
 * Every other guarded route resolves the project it touches and requires
 * membership (lib/projects/access.ts → authorizeProject); the route-auth scan
 * holds this list equal to the handlers that skip it.
 */
export const NON_PROJECT_ROUTE_FILES: Readonly<Record<string, string>> = {
  "app/api/firms/route.ts": "firm-scoped: the caller's firms (requireFirm in lib/firms/store.ts)",
  "app/api/firms/[firmId]/route.ts": "firm-scoped (requireFirm)",
  "app/api/firms/[firmId]/branding/route.ts": "firm-scoped (requireFirm)",
  "app/api/firms/[firmId]/promote/route.ts": "firm-scoped (requireFirm)",
  "app/api/firms/[firmId]/quotes/route.ts": "firm-scoped (requireFirm)",
  "app/api/firms/[firmId]/quotes/template/route.ts": "firm-scoped (requireFirm)",
  "app/api/firms/[firmId]/quotes/[quoteId]/route.ts": "firm-scoped (requireFirm)",
  "app/api/firms/[firmId]/quotes/[quoteId]/lines/[lineId]/route.ts": "firm-scoped (requireFirm)",
  "app/api/firms/[firmId]/rates/route.ts": "firm-scoped (requireFirm)",
  "app/api/firms/[firmId]/rates/[entryId]/route.ts": "firm-scoped (requireFirm)",
  "app/api/firms/[firmId]/rates/history/route.ts": "firm-scoped (requireFirm)",
  "app/api/rate-vocabulary/route.ts": "global: the take-off vocabulary and public reference figures, no project data",
};

/** URL paths of the public route handlers above (exact match). */
export const PUBLIC_API_PATHS: readonly string[] = ["/api/health"];

/**
 * Pages a visitor may see signed out: the landing surfaces, sign-in itself and
 * the legal pages the marketing footer links to. Exact match — `/auth` does not
 * open `/auth/anything`.
 */
export const PUBLIC_PAGE_PATHS: readonly string[] = ["/", "/rennovaite", "/auth", "/auth/callback", "/privacy", "/terms"];

export type RouteKind = "public" | "api" | "page";

function normalise(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** How the proxy treats a request path. Static assets never reach it (see the proxy matcher). */
export function routeKind(pathname: string): RouteKind {
  const p = normalise(pathname);
  if (p === "/api" || p.startsWith("/api/")) return PUBLIC_API_PATHS.includes(p) ? "public" : "api";
  return PUBLIC_PAGE_PATHS.includes(p) ? "public" : "page";
}

/**
 * Where a signed-out page visit goes: /auth, carrying the path it wanted when
 * that path is a safe same-site one.
 */
export function signInPath(pathname: string, search = ""): string {
  const wanted = `${pathname}${search}`;
  return safeNextPath(wanted) && wanted !== "/" ? `/auth?next=${encodeURIComponent(wanted)}` : "/auth";
}

/**
 * A `next` target we will redirect to after sign-in: a same-site absolute path
 * only. `//host`, `/\host` and anything with a scheme are refused — they would
 * turn the sign-in flow into an open redirect.
 */
export function safeNextPath(next: string | null | undefined): next is string {
  if (!next || next.length > 2000) return false;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return false;
  return !/[\u0000-\u001f]/.test(next);
}

/** Where the sign-in form keeps `next` until the magic link comes back (scoped to /auth/callback). */
export const AUTH_NEXT_COOKIE = "rv_auth_next";

/** The one 401 body: the proxy and every route answer an anonymous caller with it. */
export const UNAUTHENTICATED_CODE = "unauthenticated";

export function unauthenticatedBody(message = "Sign in required."): { error: string; code: typeof UNAUTHENTICATED_CODE } {
  return { error: message, code: UNAUTHENTICATED_CODE };
}

/** The 401 a route returns when `getCaller` finds nobody signed in. */
export function unauthenticated(message?: string): Response {
  return Response.json(unauthenticatedBody(message), { status: 401 });
}
