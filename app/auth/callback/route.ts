import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The magic link lands here. Exchange the PKCE code for a session (this
// sets the auth cookies via the SSR client) and forward to `next`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/project";
  // Only allow same-site relative redirects.
  const dest = next.startsWith("/") ? next : "/project";

  if (!code) {
    return NextResponse.redirect(`${origin}/auth?error=missing_code`);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchange error", error.message);
      return NextResponse.redirect(`${origin}/auth?error=exchange_failed`);
    }
    return NextResponse.redirect(`${origin}${dest}`);
  } catch (err) {
    console.error("[auth/callback] error", err);
    return NextResponse.redirect(`${origin}/auth?error=callback_error`);
  }
}
