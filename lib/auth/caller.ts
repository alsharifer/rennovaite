// =============================================================================
// lib/auth/caller.ts — who is asking (U1; required everywhere since H1).
//
// The app's only sign-in is Supabase's magic link, whose session lives in
// cookies that @supabase/ssr reads. Route handlers can read those cookies, so a
// browser call carries its user for free. Scripts and checks have no browser:
// they send the same Supabase user JWT as `Authorization: Bearer <jwt>` (minted
// through scripts/lib/dev-auth.mjs — a real account's real session, not a
// bypass). Both paths end in the same `Caller`; nothing downstream knows which.
//
// `getCaller` never throws for "not signed in" — it returns null and the route
// answers `unauthenticated()` (401). It throws only when Supabase itself is
// misconfigured. Since H1 every handler outside lib/auth/access.ts's allowlist
// does exactly that as its first await (lib/firms/__tests__/route-auth.test.ts).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export { unauthenticated } from "./access";

export interface Caller {
  id: string;
  email: string | null;
}

interface AuthUser {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
}

function bearerOf(request: Request | undefined): string | null {
  const h = request?.headers.get("authorization") ?? null;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

// Supabase anonymous sign-in (if it were ever enabled on the project) mints a
// real JWT for nobody in particular; it is not a caller.
function callerOf(user: AuthUser | null | undefined): Caller | null {
  if (!user || user.is_anonymous) return null;
  return { id: user.id, email: user.email ?? null };
}

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).");
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * The signed-in user for this request, or null. Bearer token first (a script),
 * then the cookie session (a browser). Called without a request (a server
 * action), it reads the cookie session.
 */
export async function getCaller(request?: Request): Promise<Caller | null> {
  const token = bearerOf(request);
  if (token) {
    // A throwaway anon client: getUser(jwt) asks the auth server to verify the
    // token, so a forged or expired one is null here, never a user.
    const { data, error } = await anonClient().auth.getUser(token);
    return error ? null : callerOf(data.user);
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return callerOf(data.user);
  } catch {
    // No request scope (a script importing a route module, say): nobody is signed in.
    return null;
  }
}

/**
 * H1: the credential to forward when the server calls its OWN routes on the
 * caller's behalf — the in-app pack export's after() job, which regenerates the
 * BoQ, renders and fetches its documents over HTTP. The job acts as the member
 * who started it, never as nobody.
 *
 * A Bearer request forwards its own token. A cookie session forwards its access
 * token, refreshed first when it would expire within `minValiditySec` (the
 * refreshed cookies go back to the browser on this response), so the job cannot
 * outlive the credential it carries. Null when nobody is signed in.
 */
export async function forwardableAuthorization(request: Request, minValiditySec = 600): Promise<string | null> {
  const token = bearerOf(request);
  if (token) return `Bearer ${token}`;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    let session = data.session;
    if (!session) return null;
    const expiresAt = session.expires_at ?? 0;
    if (expiresAt - Date.now() / 1000 < minValiditySec) {
      const refreshed = await supabase.auth.refreshSession();
      session = refreshed.data.session;
    }
    return session ? `Bearer ${session.access_token}` : null;
  } catch {
    return null;
  }
}

/**
 * The caller of a Server Component or layout (H5), which has no Request object:
 * the same two credentials as getCaller — the Authorization header (scripts
 * read pages with a Bearer; the proxy accepts it) and the cookie session.
 */
export async function getPageCaller(): Promise<Caller | null> {
  const { headers } = await import("next/headers");
  const authorization = (await headers()).get("authorization");
  return getCaller(authorization ? new Request("http://page.local/", { headers: { authorization } }) : undefined);
}
