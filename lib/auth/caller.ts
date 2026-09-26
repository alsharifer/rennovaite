// =============================================================================
// lib/auth/caller.ts — who is asking (U1).
//
// The app's only sign-in is Supabase's magic link, whose session lives in
// cookies that @supabase/ssr reads. Route handlers can read those cookies, so a
// browser call carries its user for free. Scripts and checks have no browser:
// they send the same Supabase user JWT as `Authorization: Bearer <jwt>` (minted
// through scripts/lib/dev-auth.mjs — a real account's real session, not a
// bypass). Both paths end in the same `Caller`; nothing downstream knows which.
//
// `getCaller` never throws for "not signed in" — it returns null and the store
// turns that into 401. It throws only when Supabase itself is misconfigured.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export interface Caller {
  id: string;
  email: string | null;
}

function bearerOf(request: Request | undefined): string | null {
  const h = request?.headers.get("authorization") ?? null;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * The signed-in user for this request, or null. Bearer token first (a script),
 * then the cookie session (a browser).
 */
export async function getCaller(request?: Request): Promise<Caller | null> {
  const token = bearerOf(request);
  if (token) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).");
    // A throwaway anon client: getUser(jwt) asks the auth server to verify the
    // token, so a forged or expired one is null here, never a user.
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  } catch {
    // No request scope (a script importing a route module, say): nobody is signed in.
    return null;
  }
}
