#!/usr/bin/env node
// =============================================================================
// scripts/project-member-add.mjs — make an account a member of projects (H5).
//
//   node scripts/project-member-add.mjs <email> --all
//   node scripts/project-member-add.mjs <email> <project-id> [<project-id>…]
//
// The one operation the API does not offer (like scripts/firm-member-add.mjs
// for firms): migration 050 backfilled every project to the pilot owner's
// account WHERE THAT ACCOUNT EXISTED. On a database where it did not (dev has
// only the script accounts), run this once the account has signed in:
//
//   node scripts/project-member-add.mjs alsharifer@gmail.com --all
//
// Service role; refuses production unless ALLOW_PROD_WRITE=1
// (scripts/_target-guard.mjs). Idempotent — existing memberships are kept.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

const [email, ...rest] = process.argv.slice(2);
if (!email || !email.includes("@") || rest.length === 0) {
  console.error("usage: project-member-add.mjs <email> --all | <project-id>…");
  process.exit(2);
}

const { url, key } = resolveTarget({ script: "project-member-add", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let user = null;
for (let page = 1; !user; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  if (data.users.length < 200) break;
}
if (!user) {
  console.error(`no account for ${email} on this database — it must sign in (or be invited) first`);
  process.exit(1);
}

const ids = rest.includes("--all") ? ((await sb.from("projects").select("id")).data ?? []).map((p) => p.id) : rest;
const { data: have } = await sb.from("project_members").select("project_id").eq("user_id", user.id);
const already = new Set((have ?? []).map((r) => r.project_id));
const add = ids.filter((id) => !already.has(id));
if (add.length) {
  const { error } = await sb.from("project_members").insert(add.map((project_id) => ({ project_id, user_id: user.id })));
  if (error) throw error;
}
console.log(`${email}: ${add.length} project(s) added, ${ids.length - add.length} already a member`);
