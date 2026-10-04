"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";

import { AUTH_NEXT_COOKIE, safeNextPath } from "@/lib/auth/access";
import { INVITE_ONLY_MESSAGE, SIGNUP_ALLOWLIST_ENV, isInvited, parseAllowlist } from "@/lib/auth/signup";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const EmailSchema = z.string().trim().email();

export type SignInResult =
  | { success: true; invited: true }
  | { success: true; invited: false; notice: string }
  | { success: false; error: string };

/**
 * Magic-link sign-in via Supabase Auth.
 *
 * Sends a one-time sign-in link to `email`. The link points at
 * /auth/callback, which exchanges the code for a session cookie.
 *
 * Requires (Supabase dashboard, not code): the Email auth provider enabled
 * and the {origin}/auth/callback URL on the redirect allowlist. If Auth
 * isn't configured the Supabase error is surfaced to the form verbatim.
 *
 * H1: `next` (a same-site path the proxy sent the visitor from) rides in a
 * short-lived cookie scoped to the callback, not in the e-mailed URL — the
 * link's redirect target stays exactly the one on the Supabase allowlist.
 *
 * H5: account creation is invite-only (lib/auth/signup.ts). An address the
 * AUTH_SIGNUP_ALLOWLIST names gets its account created HERE (admin API,
 * confirmed) if it has none; Supabase is never asked to create one
 * (`shouldCreateUser: false`). Anyone else is sent a link only if an account
 * already exists — and is shown the same invite-only notice either way, so the
 * form never says which addresses exist.
 */
export async function signInWithEmail(email: string, next?: string): Promise<SignInResult> {
  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) {
    return { success: false, error: "That doesn't look like a valid email." };
  }

  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (!host) {
    return {
      success: false,
      error: "Couldn't determine the site URL. Please try again.",
    };
  }
  const origin = `${proto}://${host}`;

  try {
    const invited = isInvited(parsed.data, parseAllowlist(process.env[SIGNUP_ALLOWLIST_ENV]));
    if (invited) {
      const { error: createErr } = await getSupabaseAdmin().auth.admin.createUser({ email: parsed.data, email_confirm: true });
      if (createErr && !/already|exists|registered/i.test(createErr.message)) {
        console.error("[signInWithEmail] invited account create failed", createErr.message);
        return { success: false, error: "We couldn't set up your account. Please try again." };
      }
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/project`,
        shouldCreateUser: false,
      },
    });

    if (!invited) {
      // Sent if the account exists, not otherwise — the answer is the same.
      if (error?.status === 429) return { success: false, error: "Too many requests. Wait a minute and try again." };
      if (!error && safeNextPath(next)) {
        (await cookies()).set(AUTH_NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", secure: proto === "https", path: "/auth/callback", maxAge: 60 * 60 });
      }
      return { success: true, invited: false, notice: INVITE_ONLY_MESSAGE };
    }

    if (!error && safeNextPath(next)) {
      (await cookies()).set(AUTH_NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", secure: proto === "https", path: "/auth/callback", maxAge: 60 * 60 });
    }

    if (error) {
      console.error("[signInWithEmail] supabase error", error.message);
      // Rate-limit is the common one with Supabase's built-in mailer.
      if (error.status === 429) {
        return {
          success: false,
          error: "Too many requests. Wait a minute and try again.",
        };
      }
      return {
        success: false,
        error:
          "We couldn't send the link. Email sign-in may not be enabled yet.",
      };
    }

    return { success: true, invited: true };
  } catch (err) {
    console.error("[signInWithEmail] error", err);
    const message =
      err instanceof Error ? err.message : "Sign-in failed. Please try again.";
    return { success: false, error: message };
  }
}
