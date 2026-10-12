import { NextResponse, type NextRequest } from "next/server";

import { AUTH_NEXT_COOKIE, safeNextPath } from "@/lib/auth/access";
import { SIGNED_IN_HOME, supabaseLinkError } from "@/lib/auth/link-error";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The magic link lands here and signs the visitor in, then forwards to `next`
// — the page the proxy turned the visitor away from (H1, a cookie the sign-in
// form set), else the link's own `next`. Public by necessity
// (lib/auth/access.ts), and the proxy runs no session check on it (a stale
// session's cleanup would delete the PKCE verifier — SESSION_CHECK_SKIP_PATHS).
//
// Two link shapes:
//   ?code=…                    the PKCE flow: exchanged with the code-verifier
//                              cookie the requesting browser holds;
//   ?token_hash=…&type=email   the e-mail template's token hash: verified
//                              server-side, so the link works in ANY browser or
//                              device (Supabase's recommended SSR template).
const OTP_TYPES = ["email", "magiclink"] as const;
type OtpType = (typeof OTP_TYPES)[number];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const wanted = request.cookies.get(AUTH_NEXT_COOKIE)?.value ?? searchParams.get("next");
  // Only same-site paths: `//host` would leave the site.
  const dest = safeNextPath(wanted) ? wanted : SIGNED_IN_HOME;

  const hashLink = !!tokenHash && OTP_TYPES.includes(type as OtpType);
  if (!code && !hashLink) {
    // The proxy normally turns a failed link around first; this is the backstop.
    return NextResponse.redirect(`${origin}/auth?error=${supabaseLinkError(searchParams) ?? "missing_code"}`);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = hashLink ? await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type as OtpType }) : await supabase.auth.exchangeCodeForSession(code!);
    if (error) {
      console.error(`[auth/callback] ${hashLink ? "verify" : "exchange"} error`, error.message);
      // An expired / used token hash reads like Supabase's own otp_expired landing.
      return NextResponse.redirect(`${origin}/auth?error=${hashLink ? (/expired|invalid/i.test(error.message) ? "link_expired" : "link_invalid") : "exchange_failed"}`);
    }
    const res = NextResponse.redirect(`${origin}${dest}`);
    res.cookies.set(AUTH_NEXT_COOKIE, "", { path: "/auth/callback", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("[auth/callback] error", err);
    return NextResponse.redirect(`${origin}/auth?error=callback_error`);
  }
}
