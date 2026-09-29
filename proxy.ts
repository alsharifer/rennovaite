// =============================================================================
// proxy.ts — a session everywhere (H1).
//
// Runs before every route (Next 16's renamed middleware). Off the allowlist in
// lib/auth/access.ts, a request needs a signed-in caller:
//
//   - an API route answers 401 { error, code: "unauthenticated" } — before the
//     handler runs, so an anonymous call learns nothing about what exists;
//   - a page redirects to /auth?next=<where it was going>.
//
// The caller is the same one lib/auth/caller.ts resolves: `Authorization:
// Bearer <jwt>` (a script, minted by scripts/lib/dev-auth.mjs) or the magic-link
// cookie session (a browser). Verification is `getClaims`, which checks the JWT
// signature against the project's published keys (cached) — or asks the auth
// server when the project signs with a shared secret.
//
// This is the first gate, not the only one. A matcher change or an odd path
// can skip a proxy, so every handler checks the caller again with getCaller()
// (the route-auth scan test fails the suite on one that does not). Server
// actions check for themselves too — the proxy cannot see which action a POST
// carries.
//
// It also refreshes the cookie session on every page and API request (the
// @supabase/ssr pattern): a Server Component cannot write cookies, so without
// this an expired access token stayed expired until some route handler
// happened to refresh it.
// =============================================================================

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { routeKind, signInPath, unauthenticatedBody, type RouteKind } from "@/lib/auth/access";

export async function proxy(request: NextRequest) {
  const kind = routeKind(request.nextUrl.pathname);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Misconfigured auth fails closed off the allowlist.
  if (!url || !anonKey) return kind === "public" ? NextResponse.next() : deny(request, kind);

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        // A refreshed session: the route sees the new cookies on the request,
        // the browser gets them on the response.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  const bearer = bearerOf(request);
  let signedIn = false;
  try {
    const { data, error } = bearer ? await supabase.auth.getClaims(bearer) : await supabase.auth.getClaims();
    signedIn = !error && !!data?.claims?.sub && data.claims.is_anonymous !== true;
  } catch {
    signedIn = false;
  }

  if (signedIn || kind === "public") return response;
  return deny(request, kind, response);
}

function bearerOf(request: NextRequest): string | null {
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") ?? "").trim());
  return m ? m[1]!.trim() : null;
}

function deny(request: NextRequest, kind: Exclude<RouteKind, "public">, session?: NextResponse): NextResponse {
  const out =
    kind === "api"
      ? NextResponse.json(unauthenticatedBody(), { status: 401 })
      : NextResponse.redirect(new URL(signInPath(request.nextUrl.pathname, request.nextUrl.search), request.url), 307);
  // Carry any cookie the session check wrote (a cleared, revoked session).
  for (const c of session?.cookies.getAll() ?? []) out.cookies.set(c);
  return out;
}

export const config = {
  matcher: [
    // Every API route, whatever its path looks like — a dynamic segment may
    // carry a dot, and an API path must never be mistaken for a static file.
    "/api/:path*",
    // Pages, minus Next's own assets, the dev overlay and anything served from
    // public/ (a path ending in a file extension).
    "/((?!api/|_next/|__nextjs|.*\\.[A-Za-z0-9]+$).*)",
  ],
};
