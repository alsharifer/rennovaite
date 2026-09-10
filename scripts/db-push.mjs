#!/usr/bin/env node
// =============================================================================
// scripts/db-push.mjs — `supabase db push`, but only at the database the app is
// actually pointed at (I8).
//
// The Supabase CLI keeps its own link state in supabase/.temp/project-ref. That
// is a SEPARATE fact from NEXT_PUBLIC_SUPABASE_URL in .env.local, and nothing
// keeps the two in step. Pointing .env.local at dev does not move the CLI, so
// `supabase db push` can target production while every seed script targets dev
// — and the two are read minutes apart by the same person.
//
// That state existed on this machine: .env.local on dev, CLI still linked to
// production. It was a harmless no-op only because production happened to be up
// to date.
//
// So: compare the CLI's linked ref against the app's, and refuse when they
// disagree. Run this instead of `supabase db push` directly.
// =============================================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { PRODUCTION_REF, readEnvFile, refFromUrl } from "./_target-guard.mjs";

const LINK_FILE = "supabase/.temp/project-ref";

function linkedRef() {
  if (!fs.existsSync(LINK_FILE)) return null;
  const v = fs.readFileSync(LINK_FILE, "utf8").trim();
  return v || null;
}

const env = { ...readEnvFile(), ...process.env };
const appRef = refFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
const cliRef = linkedRef();

if (!appRef) {
  console.error(
    "\n[db-push] CANNOT IDENTIFY THE APP'S DATABASE.\n\n" +
      "  NEXT_PUBLIC_SUPABASE_URL is not a Supabase project URL.\n" +
      "  Fix .env.local before pushing a schema anywhere.\n",
  );
  process.exit(1);
}

if (!cliRef) {
  console.error(
    "\n[db-push] THE CLI IS NOT LINKED TO ANY PROJECT.\n\n" +
      `  Your app points at: ${appRef}\n\n` +
      `  Link the CLI to the SAME project first:\n\n` +
      `      npx supabase link --project-ref ${appRef}\n\n` +
      "  It will prompt for that project's database password.\n",
  );
  process.exit(1);
}

if (cliRef !== appRef) {
  console.error(
    "\n[db-push] REFUSING — THE CLI AND THE APP DISAGREE.\n\n" +
      `  CLI is linked to : ${cliRef}${cliRef === PRODUCTION_REF ? "   <-- PRODUCTION" : ""}\n` +
      `  App points at    : ${appRef}${appRef === PRODUCTION_REF ? "   <-- PRODUCTION" : ""}\n\n` +
      "  A push would change the schema of a database nothing else is talking\n" +
      "  to. Relink first:\n\n" +
      `      npx supabase unlink && npx supabase link --project-ref ${appRef}\n`,
  );
  process.exit(1);
}

const isProd = appRef === PRODUCTION_REF;
console.log(
  `[db-push] CLI and app agree: ${appRef}${isProd ? "   !! PRODUCTION !!" : "   (dev / non-production)"}`,
);

if (isProd && process.env.ALLOW_PROD_WRITE !== "1") {
  console.error(
    "\n[db-push] REFUSING TO PUSH A SCHEMA TO PRODUCTION.\n\n" +
      "  Re-run with ALLOW_PROD_WRITE=1 if that is genuinely what you mean.\n",
  );
  process.exit(1);
}

console.log("[db-push] running supabase db push…\n");
try {
  execFileSync("npx", ["supabase", "db", "push", ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
} catch {
  process.exit(1);
}
