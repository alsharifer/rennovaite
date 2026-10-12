// =============================================================================
// lib/auth/link-error.ts — a magic link that failed, said in words.
//
// When Supabase cannot verify a sign-in link (expired, already used, or
// replaced by a newer one) it redirects with `error`, `error_code` and
// `error_description` in the query — to the link's own redirect target when
// that target is on the project's Redirect URLs list, otherwise to the
// project's Site URL (the root). Before this the root ignored them and the
// visitor saw a dead page. The proxy now sends any such landing to
// /auth?error=<code>, and the sign-in page says what happened.
//
// Detection keys on `error_code` / `error_description`, never on a bare
// `error`: /auth's own `?error=` codes must not be read as a Supabase landing.
//
// Pure and client-safe (the sign-in page and the proxy both read it).
// =============================================================================

export const AUTH_ERROR_CODES = ["link_expired", "link_invalid", "missing_code", "exchange_failed", "callback_error"] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** The Supabase failure a landing URL carries, as our code — or null for an ordinary URL. */
export function supabaseLinkError(params: URLSearchParams): "link_expired" | "link_invalid" | null {
  const code = params.get("error_code");
  if (!code && !params.get("error_description")) return null;
  return code === "otp_expired" ? "link_expired" : "link_invalid";
}

/** Where the proxy sends a failed-link landing; null when the URL is not one, is /auth already, or is an API call. */
export function linkErrorRedirect(url: URL): string | null {
  if (url.pathname === "/auth" || url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  const code = supabaseLinkError(url.searchParams);
  return code ? `/auth?error=${code}` : null;
}

// A PKCE auth code: Supabase issues a UUID; anything else is not ours to forward.
const AUTH_CODE = /^[A-Za-z0-9._-]{8,512}$/;

/**
 * A GOOD link that landed in the wrong place. When the link's redirect target
 * is not on the Supabase Redirect URLs list, Supabase sends the visitor to the
 * Site URL root with `?code=` — and only /auth/callback exchanges a code, so
 * the visitor arrived signed out and was asked to sign in again (the loop of
 * 12 Oct). The proxy forwards such a landing to the callback. Only the code is
 * carried; `next` rides in the callback's cookie as before.
 */
export function codeLandingRedirect(url: URL): string | null {
  const p = url.pathname;
  if (p === "/auth/callback" || p === "/api" || p.startsWith("/api/")) return null;
  const code = url.searchParams.get("code");
  if (!code || !AUTH_CODE.test(code) || supabaseLinkError(url.searchParams)) return null;
  return `/auth/callback?code=${encodeURIComponent(code)}`;
}

/** Where a signed-in visitor to `/` or `/auth` goes — the auth callback's default too. */
export const SIGNED_IN_HOME = "/project";

const MESSAGES: Record<AuthErrorCode, string> = {
  link_expired: "That sign-in link has expired or was already used. Send yourself a new one below — only the newest link works.",
  link_invalid: "That sign-in link didn't work. Send yourself a new one below.",
  missing_code: "That sign-in link was incomplete. Send yourself a new one below.",
  exchange_failed: "We couldn't finish signing you in. Send yourself a new link and open it in the same browser you requested it from.",
  callback_error: "Something went wrong signing you in. Please send yourself a new link.",
};

/** The sign-in page's message for `?error=`; null for anything we did not issue. */
export function authErrorMessage(code: string | null | undefined): string | null {
  return code && (AUTH_ERROR_CODES as readonly string[]).includes(code) ? MESSAGES[code as AuthErrorCode] : null;
}
