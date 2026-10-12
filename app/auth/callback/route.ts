import { NextResponse, type NextRequest } from "next/server";

import { AUTH_NEXT_COOKIE, safeNextPath } from "@/lib/auth/access";
import { SIGNED_IN_HOME, supabaseLinkError } from "@/lib/auth/link-error";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The magic link lands here. Exchange the PKCE code for a session (this
// sets the auth cookies via the SSR client) and forward to `next` — the page
// the proxy turned the visitor away from (H1, a cookie the sign-in form set),
// else the link's own `next`. Public by necessity (lib/auth/access.ts).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const wanted = request.cookies.get(AUTH_NEXT_COOKIE)?.value ?? searchParams.get("next");
  // Only same-site paths: `//host` would leave the site.
  const dest = safeNextPath(wanted) ? wanted : SIGNED_IN_HOME;

  if (!code) {
    // The proxy normally turns a failed link around first; this is the backstop.
    return NextResponse.redirect(`${origin}/auth?error=${supabaseLinkError(searchParams) ?? "missing_code"}`);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchange error", error.message);
      return NextResponse.redirect(`${origin}/auth?error=exchange_failed`);
    }
    const res = NextResponse.redirect(`${origin}${dest}`);
    res.cookies.set(AUTH_NEXT_COOKIE, "", { path: "/auth/callback", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("[auth/callback] error", err);
    return NextResponse.redirect(`${origin}/auth?error=callback_error`);
  }
}
