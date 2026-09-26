// =============================================================================
// scripts/lib/dev-auth.mjs — a real session for scripts and checks (U1).
//
// Firm routes answer 401 to anonymous calls, and a script has no browser to
// carry the magic-link cookie. This mints the SAME credential a browser would
// hold — a Supabase user JWT — for a dev account, through the auth server:
//
//   1. ensure the account exists (auth.admin.createUser, email confirmed)
//   2. auth.admin.generateLink({ type: "magiclink" }) → a one-time token hash
//   3. auth.verifyOtp(token_hash) with the ANON client → a session
//
// The access token goes on requests as `Authorization: Bearer <jwt>`, which
// lib/auth/caller.ts verifies with the auth server like any other user. Nothing
// in the routes knows a script is calling: there is no bypass, no shared secret,
// no "dev mode". Needs the service-role key (step 1–2) — so, like every writing
// script, it refuses production through scripts/_target-guard.mjs.
//
// Accounts are per script identity so the privacy checks can hold TWO users:
//   devSession("a")  →  dev-scripts+a@rennovaite.local
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { readEnvFile, resolveTarget } from "../_target-guard.mjs";

const DOMAIN = "rennovaite.local";

/** @param {string} [who] a short tag; the account is dev-scripts+<who>@rennovaite.local */
export async function devSession(who = "a", { script = "dev-auth" } = {}) {
  const { url, key } = resolveTarget({ script, writes: true });
  const env = readEnvFile();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required to mint a session");
  const email = `dev-scripts+${who.replace(/[^a-z0-9-]/gi, "").toLowerCase()}@${DOMAIN}`;

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // 1. the account
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true });
  let userId = created?.user?.id ?? null;
  if (createErr) {
    if (!/already|exists|registered/i.test(createErr.message)) throw createErr;
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;
    userId = list.users.find((u) => u.email === email)?.id ?? null;
    if (!userId) throw new Error(`dev account ${email} exists but was not found by listUsers`);
  }
  // 2. a one-time link, never sent — its token hash is all we need
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr) throw linkErr;
  const tokenHash = link.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed_token");
  // 3. redeem it as the user would
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: otpErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (otpErr) throw otpErr;
  const token = session.session?.access_token;
  if (!token) throw new Error("verifyOtp returned no session");
  return { email, userId, token, headers: { authorization: `Bearer ${token}` } };
}
