#!/usr/bin/env node
// =============================================================================
// scripts/firm-member-add.mjs — make an account a member of a firm (U1).
//
//   node scripts/firm-member-add.mjs <firm-id> <email>
//
// The one operation the API deliberately does not offer yet (there are no
// invitations, teams or roles): membership is granted by an operator with the
// service role. Needed once for any firm that predates 043 — the Newspace firm
// 041 backfilled has no member and is unreachable through the API until its
// account exists and is added here. Refuses production unless ALLOW_PROD_WRITE=1.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

const [firmId, email] = process.argv.slice(2);
if (!firmId || !email) {
  console.error("usage: node scripts/firm-member-add.mjs <firm-id> <email>");
  process.exit(2);
}
const { url, key } = resolveTarget({ script: "firm-member-add", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: firm, error: firmErr } = await sb.from("firms").select("id, name").eq("id", firmId).maybeSingle();
if (firmErr) throw firmErr;
if (!firm) { console.error(`no firm ${firmId}`); process.exit(1); }

const { data: list, error: listErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw listErr;
const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) { console.error(`no account with email ${email} — they must sign in once first (magic link)`); process.exit(1); }

const { error } = await sb.from("firm_members").insert({ firm_id: firm.id, user_id: user.id });
if (error && error.code !== "23505") throw error;
console.log(`${error ? "already" : "now"} a member: ${email} → ${firm.name} (${firm.id})`);
