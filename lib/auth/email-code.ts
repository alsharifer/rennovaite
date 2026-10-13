// =============================================================================
// lib/auth/email-code.ts — the e-mailed sign-in code (K10). Pure, client-safe.
//
// Supabase's email OTP length is a project setting (`otp_length` in config.toml;
// "Email OTP Length" in the hosted projects' Auth settings — 6 by the K10 brief,
// the hosted dev project issued 8 on 13 Oct). 6–10 digits are accepted and the
// screen never states the number, so either setting signs in. Spaces and
// dashes a person types or pastes are dropped.
// =============================================================================

export type CodeError = "code_malformed" | "code_invalid" | "rate_limited";

/** The answers — one for "no such account / wrong / expired", so the form never says which addresses exist. */
export const CODE_ERRORS: Record<CodeError, string> = {
  code_malformed: "Enter your email and the code from the email.",
  code_invalid: "That code didn't work — it may have expired or been replaced by a newer one. Send yourself a new email and use the newest code.",
  rate_limited: "Too many tries. Wait a minute, then send yourself a new email.",
};

/** The digits of a typed or pasted code, or null when it is not one. */
export function normaliseCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6,10}$/.test(digits) ? digits : null;
}
