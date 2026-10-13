// =============================================================================
// scripts/auth-callback-check.mjs — the magic link signs in, even when the
// browser holds a stale session (12 Oct prod bug). DEV ONLY.
//
//   node --env-file=.env.local scripts/auth-callback-check.mjs [port]
//
// 1. PKCE: a request to /auth/callback carrying a STALE session and a code
//    verifier must not get the verifier cleared (the proxy used to run its
//    session check there; the failed refresh made Supabase delete the session
//    AND the verifier, so every such sign-in failed "code verifier not found").
//    Asked WITHOUT a code, so the route never reaches Supabase and any cleared
//    cookie can only be the proxy's. (A real exchange then deletes the
//    single-use verifier itself — that is expected.)
// 2. Token hash: a real magic link for the dev pipeline account (admin
//    generateLink), opened with a stale session present, signs in and lands on
//    /project; the same link twice answers link_expired.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

const port = process.argv[2] ?? "3098";
const base = `http://localhost:${port}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !/askzyq/.test(url)) throw new Error("dev only — point NEXT_PUBLIC_SUPABASE_URL at the dev project");
const ref = new URL(url).hostname.split(".")[0];
const key = `sb-${ref}-auth-token`;
const b64url = (s) => Buffer.from(s).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const jwt = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", exp: now - 3600, aud: "authenticated" }))}.sig`;
const stale = `${key}=base64-${b64url(JSON.stringify({ access_token: jwt, refresh_token: "stale-refresh-token", expires_at: now - 3600, expires_in: 3600, token_type: "bearer", user: { id: "00000000-0000-4000-8000-000000000001" } }))}`;

let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

// No code: the route answers missing_code without touching Supabase, so any
// cookie the response clears was cleared by the proxy's session check.
const pkce = await fetch(`${base}/auth/callback`, {
  headers: { cookie: `${stale}; ${key}-code-verifier=base64-${b64url(JSON.stringify("verifier-value"))}` },
  redirect: "manual",
});
const cleared = pkce.headers.getSetCookie().some((c) => c.startsWith(`${key}-code-verifier=`) && /max-age=0/i.test(c));
check("PKCE: the proxy no longer clears the code verifier (or the session) on the callback", !cleared && pkce.headers.getSetCookie().length === 0, pkce.headers.getSetCookie().join(" | ").slice(0, 160));

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: "dev-scripts+pipeline@rennovaite.local" });
if (error) throw error;
const link = `${base}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`;
const first = await fetch(link, { headers: { cookie: stale }, redirect: "manual" });
const signedIn = first.headers.getSetCookie().some((c) => c.startsWith(key) && !c.includes("code-verifier") && !/max-age=0/i.test(c));
check("token hash: signs in with a stale session present and lands on /projects", first.status === 307 && first.headers.get("location") === `${base}/projects` && signedIn, `${first.status} → ${first.headers.get("location")}`);
const second = await fetch(link, { redirect: "manual" });
check("token hash: the same link twice answers link_expired", second.headers.get("location") === `${base}/auth?error=link_expired`, String(second.headers.get("location")));

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nMAGIC LINK CALLBACK PASSED");
process.exit(failures ? 1 : 0);
