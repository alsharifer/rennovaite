"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase-server";

const EmailSchema = z.string().trim().email();

export type SignInResult =
  | { success: true }
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
 */
export async function signInWithEmail(email: string): Promise<SignInResult> {
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
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/project`,
      },
    });

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

    return { success: true };
  } catch (err) {
    console.error("[signInWithEmail] error", err);
    const message =
      err instanceof Error ? err.message : "Sign-in failed. Please try again.";
    return { success: false, error: message };
  }
}
