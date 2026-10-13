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
  // H9: Vercel Cron has no session; the route checks Authorization: Bearer <CRON_SECRET> and fails closed without it.
  "app/api/cron/uploads-sweep/route.ts": "cron: the daily orphan-upload sweep, authenticated by CRON_SECRET",
  // K10: the daily purge of projects deleted more than 30 days ago — the same CRON_SECRET bearer, fails closed.
  "app/api/cron/projects-purge/route.ts": "cron: the daily purge of soft-deleted projects, authenticated by CRON_SECRET",
};

/**
 * Server actions (`"use server"` files) a signed-out visitor may call. Every
 * other exported action resolves `getCaller()` first — the proxy sees only a
 * POST to the page, not which action it carries.
 */
export const PUBLIC_SERVER_ACTION_FILES: Readonly<Record<string, string>> = {
  "app/_actions/sign-in-with-email.ts": "sign-in: how a visitor gets a session",
  // K10: the e-mailed code — the second way a signed-out visitor gets a session (verifyOtp, server-side).
  "app/_actions/verify-email-code.ts": "sign-in: verifies the e-mailed 6-digit code for a session",
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
export const PUBLIC_API_PATHS: readonly string[] = ["/api/health", "/api/cron/uploads-sweep", "/api/cron/projects-purge"];

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
 * Paths the proxy must NOT run its session check on. The magic link's callback
 * exchanges a PKCE code using the code-verifier cookie the sign-in request set;
 * when the browser also holds a STALE session, the check's failed refresh makes
 * Supabase clear the session AND the verifier (auth-js `_removeSession`) — on
 * the request the callback then reads — so the exchange fails with "PKCE code
 * verifier not found" (12 Oct, prod). The callback is public and signs the
 * visitor in itself; it needs nothing from the proxy.
 */
export const SESSION_CHECK_SKIP_PATHS = ["/auth/callback"];

export function sessionCheckApplies(pathname: string): boolean {
  return !SESSION_CHECK_SKIP_PATHS.includes(normalise(pathname));
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
