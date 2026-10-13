#!/usr/bin/env node
// =============================================================================
// scripts/auth-url-probe.mjs — what a Supabase project's Site URL and Redirect
// URLs allow-list ARE, read through the admin API without changing either
// (K10 #2). Needs that project's service-role key (the guarded target).
//
//   node --env-file=.env.local scripts/auth-url-probe.mjs [candidate URL …]
//
// generateLink (magiclink, for a dev script account — nothing is e-mailed)
// returns the link Supabase WOULD send. Without redirectTo its redirect_to is
// the Site URL; with a candidate that is NOT on the allow-list Supabase falls
// back to the Site URL, so each candidate reads as allowed / not allowed. The
// allow-list itself cannot be listed this way — only probed.
//
// DEV ONLY: it mints a link for a dev script account (created if absent). On
// production that would be an account the invite-only rule never granted, so it
// refuses — production's URL settings are read in the dashboard (Auth → URL
// Configuration).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

const { url, key, ref, isProd } = resolveTarget({ script: "auth-url-probe", writes: false });
if (isProd) {
  console.error("[auth-url-probe] refuses production: read Auth → URL Configuration in the dashboard.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const EMAIL = "dev-scripts+auth-url-probe@rennovaite.local";
const DEFAULTS = [
  "http://localhost:3098/auth/callback",
  "http://localhost:3091/auth/callback",
  "http://localhost:3000/auth/callback",
  "https://rennovaite.fit/auth/callback",
  "https://www.rennovaite.fit/auth/callback",
];
const candidates = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a));

const { error: ce } = await sb.auth.admin.createUser({ email: EMAIL, email_confirm: true });
if (ce && !/already|exists|registered/i.test(ce.message)) throw ce;
const target = async (redirectTo) => {
  const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email: EMAIL, options: redirectTo ? { redirectTo } : {} });
  if (error) throw error;
  return new URL(data.properties.action_link).searchParams.get("redirect_to");
};

const site = await target(null);
console.log(`project: ${ref}${isProd ? " (PRODUCTION)" : " (dev)"}`);
console.log(`Site URL: ${site}`);
for (const c of candidates.length ? candidates : DEFAULTS) {
  const got = await target(c);
  console.log(`${got === c ? "ALLOWED    " : "not allowed"}  ${c}${got === c ? "" : `  (→ falls back to ${got})`}`);
}
