"use server";

import { z } from "zod";

import { postSignInPath } from "@/lib/auth/link-error";
import { CODE_ERRORS, normaliseCode, type CodeError } from "@/lib/auth/email-code";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const EmailSchema = z.string().trim().email();

export type VerifyCodeResult = { success: true; to: string } | { success: false; code: CodeError; error: string };

/**
 * K10 — sign in with the code from the e-mail (Supabase email OTP).
 *
 * The magic-link e-mail carries the one-time `{{ .Token }}` under its button.
 * Typed on /auth it is verified HERE, server-side (`verifyOtp({ email, token,
 * type: "email" })`), and the session cookies are set on this response — so it
 * works on any device: a mail scanner that opened the link first does not use
 * it up, and the PKCE link's "open it in the browser that asked" rule does not
 * apply. Public (a signed-out visitor's way in — lib/auth/access.ts).
 *
 * No account enumeration: an address with no account, a wrong code and an
 * expired code are the same answer (Supabase answers `otp_expired` for all
 * three). Only a rate limit is told apart.
 */
export async function verifyEmailCode(email: string, code: string, next?: string): Promise<VerifyCodeResult> {
  const fail = (c: CodeError): VerifyCodeResult => ({ success: false, code: c, error: CODE_ERRORS[c] });
  const parsed = EmailSchema.safeParse(email);
  const token = normaliseCode(code);
  if (!parsed.success || !token) return fail("code_malformed");
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ email: parsed.data, token, type: "email" });
    if (error) {
      if (error.status === 429) return fail("rate_limited");
      return fail("code_invalid");
    }
    return { success: true, to: postSignInPath(next) };
  } catch (err) {
    console.error("[verifyEmailCode] error", err instanceof Error ? err.message : err);
    return fail("code_invalid");
  }
}
